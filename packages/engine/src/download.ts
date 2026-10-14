import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export class DownloadError extends Error {}

export interface DownloadOptions {
  url: string;
  dest: string;
  sha256: string;
  fetch?: typeof fetch;
  onProgress?: (received: number, total: number | undefined) => void;
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Makes `dest` hold exactly the bytes with the expected SHA-256.
 * Bytes are written to `dest.part` and renamed only after the hash matches, so `dest` is never unverified.
 */
export async function downloadVerified(o: DownloadOptions): Promise<"cached" | "downloaded" | "replaced"> {
  if (!/^[0-9a-f]{64}$/.test(o.sha256)) throw new DownloadError(`invalid expected sha256 "${o.sha256}"`);
  let replaced = false;
  if (existsSync(o.dest)) {
    if ((await fileSha256(o.dest)) === o.sha256) return "cached";
    rmSync(o.dest);
    replaced = true;
  }
  mkdirSync(dirname(o.dest), { recursive: true });
  const part = `${o.dest}.part`;
  try {
    const res = await (o.fetch ?? fetch)(o.url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new DownloadError(`GET ${o.url} failed: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || undefined;
    const hash = createHash("sha256");
    let received = 0;
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          hash.update(chunk);
          received += chunk.length;
          o.onProgress?.(received, total);
          yield chunk;
        }
      },
      createWriteStream(part),
    );
    const actual = hash.digest("hex");
    if (actual !== o.sha256) {
      throw new DownloadError(`SHA-256 mismatch for ${o.url}: expected ${o.sha256}, got ${actual}`);
    }
    renameSync(part, o.dest);
    return replaced ? "replaced" : "downloaded";
  } finally {
    rmSync(part, { force: true });
  }
}
