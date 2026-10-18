import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { addSource, prepareSource, removeSource, revampPaths } from "@revamp-app/engine";
import { demoDeb, writeDemoBundle } from "../../engine/test/helpers/demo.ts";
import { createHandler } from "../src/serve.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
/** A home with an empty sources.json: serve seeds the default source only while the file doesn't exist, and tests stay offline. */
function freshHome(prefix: string): string {
  const home = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(home, ".config/revamp"), { recursive: true });
  writeFileSync(join(home, ".config/revamp/sources.json"), '{"sources":[]}\n');
  return home;
}

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
  return { root, sha256, bundle, paths, handle, call, notes, logs, close: () => server.close() };
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

/** A fresh home and a fake raw.githubusercontent.com that serves xb00tt/revamp-patches' bundle.json for the demo bundle while `state.online`. */
async function defaultSourceSetup(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "revamp-serve-seed-"));
  const bundle = join(root, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const bytes = readFileSync(bundle);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const state = { online: true };
  const server = createServer((req, res) => {
    if (req.url === "/raw/xb00tt/revamp-patches/HEAD/bundle.json" && state.online) res.end(JSON.stringify({ name: "Demo bundle", version: "1.0.0", sha256, download_url: `${base}/dl/demo.mjs` }));
    else if (req.url === "/dl/demo.mjs") res.end(bytes);
    else {
      res.statusCode = 500;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const paths = revampPaths({ HOME: join(root, "home") });
  const logs: string[] = [];
  const handle = createHandler({ paths, rawBaseUrl: `${base}/raw`, apiBaseUrl: `${base}/api`, log: (l) => logs.push(l) });
  let next = 1;
  const call = async (method: string, params?: unknown) => (await handle(JSON.stringify({ jsonrpc: "2.0", id: next++, method, params }), () => {})) as { result?: any; error?: { code: number; message: string } };
  const locations = async () => ((await call("sources.list")).result as Array<{ location: string }>).map((s) => s.location);
  return { state, sha256, paths, logs, call, locations, added: `Added the default source xb00tt/revamp-patches: "Demo bundle" 1.0.0 (sha256 ${sha256})` };
}

test("the first request that reads the sources adds the default source; after a failure the next one tries again", async (t) => {
  const s = await defaultSourceSetup(t);
  s.state.online = false;
  assert.deepEqual(await s.locations(), []);
  assert.match(s.logs[0], /^Warning: couldn't add the default source xb00tt\/revamp-patches: couldn't fetch bundle\.json from xb00tt\/revamp-patches/);
  assert.equal(existsSync(join(s.paths.config, "sources.json")), false, "an offline first run saves nothing");

  s.state.online = true;
  const [a, b] = await Promise.all([s.locations(), s.locations()]); // the same session retries, and both wait for the one seeding
  assert.deepEqual([a, b], [["xb00tt/revamp-patches"], ["xb00tt/revamp-patches"]]);
  assert.deepEqual(s.logs.slice(1), [s.added]);
  assert.deepEqual(await s.locations(), ["xb00tt/revamp-patches"]);
  assert.equal(s.logs.length, 2, "once seeded, nothing seeds again");
});

test("adding the default source by hand on a fresh home is the seed: one fetch, one source, no seeding line", async (t) => {
  const s = await defaultSourceSetup(t);
  const preview = (await s.call("sources.prepare", { location: "xb00tt/revamp-patches" })).result;
  assert.equal(preview.source.location, "xb00tt/revamp-patches");
  const added = await s.call("sources.add", { token: preview.token });
  assert.ifError(added.error);
  assert.equal(added.result.location, "xb00tt/revamp-patches");
  assert.deepEqual(await s.locations(), ["xb00tt/revamp-patches"]);
  assert.deepEqual(s.logs, []);
});

/** Runs `work` with these process env variables set (undefined removes one), then puts them back. */
async function withEnv(vars: Record<string, string | undefined>, work: () => Promise<void>) {
  const put = (v: Record<string, string | undefined>) => Object.entries(v).forEach(([k, x]) => (x === undefined ? delete process.env[k] : (process.env[k] = x)));
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  put(vars);
  try {
    await work();
  } finally {
    put(saved);
  }
}

/** The demo app installed, an empty profile dir standing in for /etc/apparmor.d, and a fake pkexec that logs its arguments and input. */
async function sandboxSetup(t: { after(fn: () => void): void }) {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.call("job.patch", { appId: "demo", enable: ["Say goodbye"] })).result.result.installed, true);
  const profiles = mkdtempSync(join(tmpdir(), "revamp-serve-profiles-"));
  const log = join(s.root, "pkexec.log");
  const pkexec = join(s.root, "pkexec");
  writeFileSync(pkexec, `#!/bin/sh\necho "$@" >> '${log}'\ncat >> '${log}'\nexit 0\n`);
  chmodSync(pkexec, 0o755);
  return { ...s, profiles, log, pkexec, helper: join(s.paths.state, "sandbox/revamp-demo.sh") };
}

test("doctor.run answers with the checks and the exit code", async (t) => {
  const s = await setup();
  t.after(s.close);
  const r = (await s.call("doctor.run")).result;
  assert.ok(r.checks.some((c: { id: string }) => c.id === "platform"));
  assert.ok([0, 1, 2].includes(r.exitCode));
});

test("sandbox.status lists each installed app with its profile name and whether the profile is there", async (t) => {
  const s = await sandboxSetup(t);
  await withEnv({ REVAMP_PROFILE_DIR: s.profiles, REVAMP_PKEXEC: "/nonexistent/pkexec" }, async () => {
    const status = (await s.call("sandbox.status")).result;
    assert.equal(typeof status.restricted, "boolean");
    assert.equal(status.canPrompt, false, "no pkexec");
    assert.deepEqual(status.apps, [{ appId: "demo", profile: "revamp-demo", installed: false }]);
    writeFileSync(join(s.profiles, "revamp-demo"), `"${s.paths.data}/apps/demo/*/demo" {}\n`); // a profile with this user's path in it
    assert.equal((await s.call("sandbox.status")).result.apps[0].installed, true);
  });
});

test("sandbox.status skips an app directory it can't name instead of failing for every app", async (t) => {
  const s = await sandboxSetup(t);
  const odd = join(s.paths.data, "apps/my app");
  mkdirSync(join(odd, "1.0.0"), { recursive: true });
  writeFileSync(join(odd, "1.0.0/revamp.json"), '{"installedAt":"2026-01-01T00:00:00.000Z"}');
  symlinkSync("1.0.0", join(odd, "current"));
  await withEnv({ REVAMP_PROFILE_DIR: s.profiles, REVAMP_PKEXEC: "/nonexistent/pkexec" }, async () => {
    const status = (await s.call("sandbox.status")).result;
    assert.deepEqual(status.apps, [{ appId: "demo", profile: "revamp-demo", installed: false }]);
    assert.match(s.logs.join("\n"), /my app.*unsafe|unsafe.*my app/);
  });
});

test("sandbox.fix needs an installed app", async (t) => {
  const s = await setup();
  t.after(s.close);
  await withEnv({ REVAMP_PROFILE_DIR: mkdtempSync(join(tmpdir(), "revamp-serve-profiles-")), REVAMP_PKEXEC: "/nonexistent/pkexec" }, async () => {
    const r = await s.call("sandbox.fix", { appId: "ghost" });
    assert.equal(r.error?.code, -32000);
    assert.match(r.error!.message, /is not installed/);
    assert.equal((await s.call("sandbox.fix", {})).error?.code, -32602);
  });
});

test("sandbox.fix without a prompt writes the helper for sudo and throws its instructions", async (t) => {
  const s = await sandboxSetup(t);
  await withEnv({ REVAMP_PROFILE_DIR: s.profiles, REVAMP_PKEXEC: "/nonexistent/pkexec", DISPLAY: ":0" }, async () => {
    const r = await s.call("sandbox.fix", { appId: "demo" });
    assert.equal(r.error?.code, -32000);
    assert.equal(r.error!.message, `Run it with sudo instead:\n  sudo sh ${s.helper}`);
    assert.match(readFileSync(s.helper, "utf8"), /apparmor_parser -r/);
  });
});

test("sandbox.fix pipes the script to pkexec's shell; a dismissed prompt and other failures are errors", async (t) => {
  const s = await sandboxSetup(t);
  await withEnv({ REVAMP_PROFILE_DIR: s.profiles, REVAMP_PKEXEC: s.pkexec, DISPLAY: ":0" }, async () => {
    assert.equal((await s.call("sandbox.status")).result.canPrompt, true);
    const ok = await s.call("sandbox.fix", { appId: "demo" });
    assert.deepEqual(ok.result, { ok: true, profile: "revamp-demo" });
    const logged = readFileSync(s.log, "utf8");
    assert.match(logged, /^\/bin\/sh -s\n/);
    assert.match(logged, /apparmor_parser -r '\/etc\/apparmor\.d\/revamp-demo'/);
    assert.equal(existsSync(s.helper), false, "nothing the user can change is left for root to run");
    for (const [exit, message] of [[126, /^The administrator prompt was cancelled; nothing changed\.$/], [3, /^pkexec failed \(exit 3\)\nRun it with sudo instead:/]] as const) {
      writeFileSync(s.pkexec, `#!/bin/sh\ncat > /dev/null\nexit ${exit}\n`);
      const r = await s.call("sandbox.fix", { appId: "demo" });
      assert.equal(r.error?.code, -32000);
      assert.match(r.error!.message, message);
    }
  });
});

test("revamp serve speaks over stdin and stdout and exits when stdin closes", async () => {
  const home = freshHome("revamp-serve-cli-");
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
  const home = freshHome("revamp-serve-epipe-");
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
