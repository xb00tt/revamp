import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BundleDescription, SandboxPatchOutput } from "../src/job.ts";
import { EVENT_PREFIX, nodeOptions, runSandboxed, SandboxError } from "../src/sandbox.ts";
import { writeDemoApp, writeDemoBundle } from "./helpers/demo.ts";

const PROBE = fileURLToPath(new URL("./fixtures/sandbox-probe.mjs", import.meta.url));
const SHA = "a".repeat(64);
const tmp = () => mkdtempSync(join(tmpdir(), "revamp-sb-"));

test("the sandbox allows its own dirs and blocks other files, processes and the network", async (t) => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.end("hi");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const root = tmp();
  const allowed = join(root, "in");
  const out = join(root, "out");
  mkdirSync(allowed);
  mkdirSync(out);
  writeFileSync(join(allowed, "f.txt"), "x");
  writeFileSync(join(root, "secret.txt"), "s");
  const report = await runSandboxed<Record<string, string>>(
    {
      allowedFile: join(allowed, "f.txt"),
      outsideFile: join(root, "secret.txt"),
      allowedWrite: join(out, "w.txt"),
      outsideWrite: join(root, "w.txt"),
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    },
    { read: [allowed], write: [out] },
    { entry: PROBE },
  );
  assert.equal(report.readAllowed, "allowed");
  assert.equal(report.writeAllowed, "allowed");
  assert.equal(report.readOutside, "ERR_ACCESS_DENIED");
  assert.equal(report.writeOutside, "ERR_ACCESS_DENIED");
  assert.equal(report.spawn, "ERR_ACCESS_DENIED");
  assert.notEqual(report.fetch, "allowed"); // needs Node ≥ 25: earlier versions don't restrict the network
  assert.equal(hits, 0);
});

test("a run over its time limit is killed", async () => {
  await assert.rejects(runSandboxed({ mode: "hang" }, { read: [], write: [] }, { entry: PROBE, timeoutMs: 500 }), /timed out/);
});

test("describe loads a bundle and returns plain JSON", async () => {
  const bundle = join(tmp(), "demo.mjs");
  writeDemoBundle(bundle, { sha256: SHA });
  const d = await runSandboxed<BundleDescription>({ mode: "describe", bundle }, { read: [bundle], write: [] });
  assert.equal(d.manifest.name, "Demo bundle");
  assert.equal(d.apps[0].id, "demo");
  assert.deepEqual(d.patches.map((p) => p.name), ["Say goodbye"]);
});

async function patchDemo(extra?: string) {
  const root = tmp();
  const staging = join(root, "staging");
  const outDir = join(staging, ".revamp-out");
  const bundle = join(root, "demo.mjs");
  writeDemoBundle(bundle, { sha256: SHA, extra });
  await writeDemoApp(staging);
  mkdirSync(outDir);
  const job = {
    mode: "patch",
    bundle,
    staging,
    outDir,
    appId: "demo",
    version: "1.0.0",
    selection: { enable: [], disable: [], options: {} },
    force: false,
    stockDesktop: { Name: "Demo" },
  };
  const result = await runSandboxed<SandboxPatchOutput>(job, { read: [staging, bundle], write: [outDir] });
  return { result, outDir };
}

test("a patch job writes changed files into the out dir and reports results", async () => {
  const { result, outDir } = await patchDemo();
  assert.equal(result.aborted, null);
  assert.deepEqual(result.files, ["out/main.js"]);
  assert.equal(readFileSync(join(outDir, "files/out/main.js"), "utf8"), 'console.log("goodbye");\n');
  assert.equal(result.desktopEntry.Name, "Demo (Revamped)");
});

test("bundle code can't read files outside the job", async () => {
  const snoop = `patches.push({ kind: "patch", name: "Snoop", compatibleWith: [{ app }],
    execute() { process.getBuiltinModule("node:fs").readFileSync("/etc/hostname"); } });`;
  const { result } = await patchDemo(snoop);
  const r = result.results.find((x) => x.name === "Snoop")!;
  assert.equal(r.status, "failed");
  assert.match(r.message!, /restricted|ERR_ACCESS_DENIED/);
});

test("a file that isn't a bundle is reported", async () => {
  const bad = join(tmp(), "bad.mjs");
  writeFileSync(bad, "export const x = 1;\n");
  await assert.rejects(
    runSandboxed({ mode: "describe", bundle: bad }, { read: [bad], write: [] }),
    (e) => e instanceof SandboxError && /not a Revamp bundle/.test(e.message),
  );
});

test("nodeOptions quotes values so Node reads them back unchanged", () => {
  const value = 'C:\\a b/"c"';
  assert.equal(nodeOptions(["--permission", `--title=${value}`]), '--permission --title="C:\\\\a b/\\"c\\""');
  const r = spawnSync(process.execPath, ["-p", "process.title"], { encoding: "utf8", env: { NODE_OPTIONS: nodeOptions([`--title=${value}`]) } });
  assert.equal(r.stdout.trim(), value, r.stderr);
});

test("the runner refuses to run outside the permission model", () => {
  const runner = fileURLToPath(new URL("../src/runner.ts", import.meta.url));
  const r = spawnSync(process.execPath, [runner], { input: "{}", encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "the sandbox runner only runs under Node's permission model");
});

test("event lines on the child's stderr reach onEvent and stay out of the error text", async () => {
  const dir = tmp();
  const entry = join(dir, "events.mjs");
  writeFileSync(entry, `process.stderr.write(${JSON.stringify(EVENT_PREFIX)} + '{"patch":"A","index":1,"total":2}\\nreal problem\\n');\nprocess.stderr.write(${JSON.stringify(EVENT_PREFIX)} + "not json");\nprocess.exitCode = 1;\n`);
  const events: unknown[] = [];
  await assert.rejects(
    runSandboxed({}, { read: [dir], write: [] }, { entry, onEvent: (e) => events.push(e) }),
    (e: Error) => e instanceof SandboxError && e.message === `real problem\n${EVENT_PREFIX}not json`,
  );
  assert.deepEqual(events, [{ patch: "A", index: 1, total: 2 }]);
});
