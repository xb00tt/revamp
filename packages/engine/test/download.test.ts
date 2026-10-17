import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVerified, releaseDigest } from "../src/download.ts";

const body = Buffer.from("pretend this is a .deb\n".repeat(1000));
const sha = createHash("sha256").update(body).digest("hex");

async function serve() {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/file.deb") res.end(body);
    else if (req.url === "/slow.deb") {
      res.write(body.subarray(0, 100));
      setTimeout(() => res.end(body.subarray(100)), 50);
    } else {
      res.statusCode = 404;
      res.end("nope");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, hits: () => hits, close: () => new Promise((r) => server.close(r)) };
}
const tmp = () => mkdtempSync(join(tmpdir(), "revamp-dl-"));

test("downloads, verifies, and leaves no .part file", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "a", "file.deb");
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "downloaded");
  assert.deepEqual(readFileSync(dest), body);
  assert.deepEqual(readdirSync(join(dest, "..")), ["file.deb"]);
});

test("the .part file in flight is per process, so two first runs at once never share one", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  const seen = new Set<string>();
  // /slow sends the body in two parts, so the second progress event comes well after the file was opened
  await downloadVerified({ url: `${s.base}/slow.deb`, dest, sha256: sha, onProgress: () => readdirSync(join(dest, "..")).forEach((f) => seen.add(f)) });
  assert.deepEqual([...seen], [`file.deb.${process.pid}.part`]);
});

test("a cached file with the right hash is reused without a request", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha });
  const before = s.hits();
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "cached");
  assert.equal(s.hits(), before);
});

test("a corrupted cached file is replaced", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  writeFileSync(dest, "truncated");
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "replaced");
  assert.deepEqual(readFileSync(dest), body);
});

test("a stale .part from a crashed run is overwritten", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  writeFileSync(`${dest}.${process.pid}.part`, "garbage from an earlier crash");
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "downloaded");
  assert.deepEqual(readFileSync(dest), body);
});

test("a hash mismatch rejects and keeps nothing", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await assert.rejects(downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: "0".repeat(64) }), /SHA-256 mismatch/);
  assert.equal(existsSync(dest), false);
  assert.equal(existsSync(`${dest}.${process.pid}.part`), false);
});

test("HTTP errors reject with the status", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await assert.rejects(downloadVerified({ url: `${s.base}/missing.deb`, dest, sha256: sha }), /HTTP 404/);
  assert.equal(existsSync(dest), false);
});

test("a 403 from the download server gives the plain status, without the GitHub API hint", async () => {
  const forbidden: typeof fetch = async () => new Response("denied", { status: 403 });
  await assert.rejects(downloadVerified({ url: "https://example.test/file.deb", dest: join(tmp(), "f"), sha256: sha, fetch: forbidden }), {
    message: "GET https://example.test/file.deb failed: HTTP 403",
  });
});

test("an invalid expected hash rejects before any request", async (t) => {
  const s = await serve();
  t.after(s.close);
  await assert.rejects(downloadVerified({ url: `${s.base}/file.deb`, dest: join(tmp(), "f"), sha256: "abc" }), /invalid expected sha256/);
  assert.equal(s.hits(), 0);
});

test("releaseDigest reads GitHub's SHA-256 for one release asset, and says why when it can't", async () => {
  const urls: string[] = [];
  const github =
    (status: number, json: unknown): typeof fetch =>
    async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(json), { status });
    };
  const o = { repo: "hydralauncher/hydra", tag: "v4.1.7", asset: "hydralauncher_4.1.7_amd64.deb" };
  const release = { assets: [{ name: "Hydra-4.1.7.AppImage", digest: `sha256:${"b".repeat(64)}` }, { name: o.asset, digest: `sha256:${sha}` }] };
  assert.equal(await releaseDigest({ ...o, fetch: github(200, release) }), sha);
  assert.equal(urls[0], "https://api.github.com/repos/hydralauncher/hydra/releases/tags/v4.1.7");
  await assert.rejects(releaseDigest({ ...o, fetch: github(404, {}) }), /hydralauncher\/hydra has no release v4\.1\.7 on GitHub/);
  await assert.rejects(releaseDigest({ ...o, fetch: github(403, {}) }), /HTTP 403 \(GitHub allows 60 API requests an hour/);
  await assert.rejects(releaseDigest({ ...o, fetch: github(200, { assets: [] }) }), /has no asset hydralauncher_4\.1\.7_amd64\.deb/);
  await assert.rejects(releaseDigest({ ...o, fetch: github(200, { assets: [null] }) }), /has no asset hydralauncher_4\.1\.7_amd64\.deb/);
  for (const digest of [null, "sha512:abc", `sha256:${"Z".repeat(64)}`]) {
    await assert.rejects(releaseDigest({ ...o, fetch: github(200, { assets: [{ name: o.asset, digest }] }) }), /publishes no SHA-256/);
  }
  for (const repo of ["x/../../evil", "../..", "./x", "a/b/c"]) {
    await assert.rejects(releaseDigest({ ...o, repo, fetch: github(200, release) }), /invalid GitHub repository/);
  }
  const text: typeof fetch = async () => new Response("<html>rate limited</html>");
  await assert.rejects(releaseDigest({ ...o, fetch: text }), /returned an unexpected response/);
  await assert.rejects(releaseDigest({ ...o, fetch: github(200, { assets: "x" }) }), /returned an unexpected response/);
});
