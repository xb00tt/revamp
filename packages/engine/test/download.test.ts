import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVerified } from "../src/download.ts";

const body = Buffer.from("pretend this is a .deb\n".repeat(1000));
const sha = createHash("sha256").update(body).digest("hex");

async function serve() {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/file.deb") res.end(body);
    else {
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
  assert.equal(existsSync(`${dest}.part`), false);
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
  writeFileSync(`${dest}.part`, "garbage from an earlier crash");
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "downloaded");
  assert.deepEqual(readFileSync(dest), body);
});

test("a hash mismatch rejects and keeps nothing", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await assert.rejects(downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: "0".repeat(64) }), /SHA-256 mismatch/);
  assert.equal(existsSync(dest), false);
  assert.equal(existsSync(`${dest}.part`), false);
});

test("HTTP errors reject with the status", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await assert.rejects(downloadVerified({ url: `${s.base}/missing.deb`, dest, sha256: sha }), /HTTP 404/);
  assert.equal(existsSync(dest), false);
});

test("an invalid expected hash rejects before any request", async (t) => {
  const s = await serve();
  t.after(s.close);
  await assert.rejects(downloadVerified({ url: `${s.base}/file.deb`, dest: join(tmp(), "f"), sha256: "abc" }), /invalid expected sha256/);
  assert.equal(s.hits(), 0);
});
