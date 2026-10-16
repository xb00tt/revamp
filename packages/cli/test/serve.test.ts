import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { addSource, prepareSource, removeSource, revampPaths } from "@revamp/engine";
import { demoDeb, writeDemoBundle } from "../../engine/test/helpers/demo.ts";
import { createHandler } from "../src/serve.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/** A file source with the demo bundle, a fake GitHub serving demo 1.0.0, and a handler that records notifications. */
async function setup() {
  const deb = await demoDeb();
  const sha256 = createHash("sha256").update(deb).digest("hex");
  const server = createServer((req, res) => {
    if (req.url === "/example/demo/releases/download/v1.0.0/demo_1.0.0_amd64.deb") res.end(deb);
    else if (req.url === "/repos/example/demo/releases/latest") res.end(JSON.stringify({ tag_name: "v1.0.0" }));
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "revamp-serve-"));
  const paths = revampPaths({ HOME: join(root, "home") });
  const bundle = join(root, "demo.mjs");
  writeDemoBundle(bundle, { sha256 });
  addSource(paths, (await prepareSource(paths, bundle)).source);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const logs: string[] = [];
  const handle = createHandler({ paths, apiBaseUrl: base, releaseBaseUrl: base, log: (l) => logs.push(l) });
  const notes: unknown[] = [];
  let next = 1;
  const call = async (method: string, params?: unknown) => (await handle(JSON.stringify({ jsonrpc: "2.0", id: next++, method, params }), (m, p) => notes.push({ m, p }))) as { id: number; result?: any; error?: { code: number; message: string } };
  return { root, sha256, bundle, paths, handle, call, notes, close: () => server.close() };
}

test("apps, patches, a patch job with progress, and the installed result", async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.deepEqual((await s.call("apps.list")).result, { apps: [{ appId: "demo", name: "Demo", current: null, versions: [] }], lastCheck: null, skipped: {} });
  const listing = (await s.call("patches.list", { appId: "demo" })).result;
  assert.deepEqual(listing.ask, []);
  assert.deepEqual([listing.app.name, listing.version, listing.patches.map((p: { name: string }) => p.name), listing.selection], ["Demo", "1.0.0", ["Say goodbye"], { enable: [], disable: [], options: {} }]);

  const job = await s.call("job.patch", { appId: "demo", enable: ["Say goodbye"] });
  assert.equal(job.result.result.installed, true);
  assert.match(job.result.report, /^Demo 1\.0\.0: 1\/1 patches apply \(installed to /);
  const notes = s.notes.map((n) => n as { m: string; p: { id: number; step?: string; patch?: string; line?: string } });
  assert.ok(notes.every((n) => (n.m === "job.progress" || n.m === "job.log") && n.p.id === job.id));
  const progress = notes.filter((n) => n.m === "job.progress");
  assert.deepEqual([...new Set(progress.map((n) => n.p.step))], ["download", "extract", "patch", "repack", "install"]);
  assert.ok(progress.some((n) => n.p.patch === "Say goodbye"));
  assert.deepEqual(notes.filter((n) => n.m === "job.log").map((n) => n.p.line), ["Downloading demo_1.0.0_amd64.deb…", "Extracting…", "Patching…", "Repacking…", "Installing…"]);

  const apps = (await s.call("apps.list")).result.apps;
  assert.deepEqual([apps[0].current, apps[0].versions[0].bundle, apps[0].versions[0].untested], ["1.0.0", { name: "Demo bundle", version: "1.0.0" }, false]);
  assert.deepEqual((await s.call("selection.get", { appId: "demo" })).result, { enable: ["Say goodbye"], disable: [], options: {} });
  s.notes.length = 0;
  const check = await s.call("check.run");
  assert.deepEqual(check.result.apps.map((a: { status: string }) => a.status), ["up to date"]);
  assert.deepEqual(s.notes, [{ m: "job.log", p: { id: check.id, line: "Checking demo 1.0.0…" } }]);
  assert.equal((await s.call("check.last")).result.apps[0].appId, "demo");
  assert.equal((await s.call("job.update", { appId: "demo" })).error?.code, -32601);
  writeDemoBundle(s.bundle, { sha256: s.sha256, version: "1.1.0", extra: 'patches.push({ kind: "patch", name: "Extra", compatibleWith: [{ app }], execute() {} });' });
  removeSource(s.paths, s.bundle);
  addSource(s.paths, (await prepareSource(s.paths, s.bundle)).source);
  assert.deepEqual((await s.call("patches.list", { appId: "demo" })).result.ask, ["Extra"]);
});

test("sources are added only from a preview this session made", async (t) => {
  const s = await setup();
  t.after(s.close);
  const other = join(s.root, "other.mjs");
  writeDemoBundle(other, { sha256: s.sha256, version: "2.0.0" });
  const preview = (await s.call("sources.prepare", { location: other })).result;
  assert.deepEqual([preview.manifest.version, preview.apps, preview.source.location], ["2.0.0", [{ id: "demo", name: "Demo", versions: ["1.0.0", "2.0.0"] }], other]);
  assert.equal((await s.call("sources.list")).result.length, 1, "nothing is added by a preview");
  assert.equal((await s.call("sources.add", { token: preview.token })).result.version, "2.0.0");
  assert.deepEqual((await s.call("sources.add", { token: preview.token })).error, { code: -32602, message: "that source preview is gone; fetch the source again" });
  assert.equal((await s.call("sources.remove", { location: other })).result.location, other);
  assert.deepEqual((await s.call("sources.refresh")).result, []);
  assert.deepEqual((await s.call("check.skip", { appId: "demo", version: "3.0.0" })).result, {});
  assert.deepEqual((await s.call("apps.list")).result.skipped, { demo: "3.0.0" });
  assert.ok((await s.call("storage.list")).result.some((i: { kind: string; keep?: string }) => i.kind === "bundle" && i.keep === "pinned"));
});

test("protocol errors follow JSON-RPC 2.0, and notifications get no reply", async (t) => {
  const s = await setup();
  t.after(s.close);
  const raw = (line: string) => s.handle(line, () => {});
  assert.deepEqual(await raw("{"), { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  assert.deepEqual(await raw('{"id":1,"method":"apps.list"}'), { jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid Request" } });
  assert.deepEqual((await s.call("nope")).error, { code: -32601, message: "Method not found: nope" });
  assert.deepEqual((await s.call("patches.list", {})).error, { code: -32602, message: '"appId" must be a string' });
  assert.deepEqual((await s.call("patches.list", [1])).error, { code: -32602, message: "params must be an object" });
  assert.deepEqual((await s.call("job.patch", { appId: "demo", dryRun: "yes" })).error, { code: -32602, message: '"dryRun" must be true or false' });
  assert.deepEqual((await s.call("install.rollback", { appId: "demo" })).error, { code: -32000, message: "no previous version of demo to roll back to" });
  assert.equal(await raw('{"jsonrpc":"2.0","method":"sources.list"}'), undefined);
});

test("revamp serve speaks over stdin and stdout and exits when stdin closes", async () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-serve-cli-"));
  const child = spawn(process.execPath, [MAIN, "serve"], { env: { ...process.env, HOME: home, XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "" } });
  let out = "";
  child.stdout.on("data", (c: Buffer) => (out += c));
  child.stdin.end('{"jsonrpc":"2.0","id":1,"method":"sources.list"}\n{"jsonrpc":"2.0","id":2,"method":"storage.list"}\n');
  const code = await new Promise((r) => child.on("close", r));
  assert.equal(code, 0);
  assert.deepEqual(out.trim().split("\n").map((l) => JSON.parse(l)).sort((a, b) => a.id - b.id), [
    { jsonrpc: "2.0", id: 1, result: [] },
    { jsonrpc: "2.0", id: 2, result: [] },
  ]);
});

test("revamp serve finishes its work when the window closes its end of stdout", async () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-serve-epipe-"));
  const child = spawn(process.execPath, [MAIN, "serve"], { env: { ...process.env, HOME: home, XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "" } });
  const exited = new Promise((r) => child.on("exit", r));
  let err = "";
  child.stderr.on("data", (c: Buffer) => (err += c));
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"storage.list"}\n');
  child.stdout.destroy();
  await new Promise((r) => setTimeout(r, 500)); // let the reply hit the closed pipe
  child.stdin.end();
  const code = await exited;
  assert.doesNotMatch(err, /Unhandled 'error' event/);
  assert.equal(code, 0);
});
