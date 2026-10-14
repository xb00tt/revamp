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
    if (!res.ok || !res.body) throw new DownloadError(`GET ${o.url} failed: HTTP ${res.status}${res.status === 403 ? " (GitHub allows 60 API requests an hour without a token; try again later)" : ""}`);
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

export interface DigestOptions {
  /** "owner/repo" */
  repo: string;
  tag: string;
  asset: string;
  /** Tests point this at a local server; defaults to https://api.github.com. */
  apiBaseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * The SHA-256 GitHub publishes for a release asset (its `digest` field). Only versions a bundle doesn't list
 * are verified this way, because the bundle has no hash for them.
 */
export async function releaseDigest(o: DigestOptions): Promise<string> {
  const parts = o.repo.split("/");
  if (parts.length !== 2 || !parts.every((p) => /^[\w.-]+$/.test(p) && p !== "." && p !== "..")) throw new DownloadError(`invalid GitHub repository "${o.repo}"`);
  const url = `${o.apiBaseUrl ?? "https://api.github.com"}/repos/${o.repo}/releases/tags/${encodeURIComponent(o.tag)}`;
  const res = await (o.fetch ?? fetch)(url, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } });
  if (res.status === 404) throw new DownloadError(`${o.repo} has no release ${o.tag} on GitHub`);
  if (!res.ok) throw new DownloadError(`GET ${url} failed: HTTP ${res.status}${res.status === 403 ? " (GitHub allows 60 API requests an hour without a token; try again later)" : ""}`);
  const release = (await res.json().catch(() => undefined)) as { assets?: Array<{ name?: unknown; digest?: unknown }> } | undefined;
  if (!Array.isArray(release?.assets)) throw new DownloadError(`GET ${url} returned an unexpected response`);
  const asset = release.assets.find((a) => a.name === o.asset);
  if (!asset) throw new DownloadError(`release ${o.tag} of ${o.repo} has no asset ${o.asset}`);
  const sha256 = typeof asset.digest === "string" ? /^sha256:([0-9a-f]{64})$/.exec(asset.digest)?.[1] : undefined;
  if (!sha256) throw new DownloadError(`GitHub publishes no SHA-256 for ${o.asset} of ${o.repo} ${o.tag}, so it can't be verified`);
  return sha256;
}
