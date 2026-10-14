import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFile } from "@electron/asar";
import { patchApp, type PatchAppOptions } from "../src/api.ts";
import { parseDesktopEntry } from "../src/desktop.ts";
import { revampPaths } from "../src/paths.ts";
import { tarEntry } from "./helpers/archives.ts";
import { demoDeb, writeDemoBundle } from "./helpers/demo.ts";

async function setup(bundleOptions: { extra?: string; minEngine?: string } = {}, debExtra: Buffer[] = []) {
  const deb = await demoDeb(debExtra);
  const sha256 = createHash("sha256").update(deb).digest("hex");
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/example/demo/releases/download/v1.0.0/demo_1.0.0_amd64.deb") res.end(deb);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "revamp-api-"));
  const bundlePath = join(root, "demo.mjs");
  const writeBundle = (o = bundleOptions) => writeDemoBundle(bundlePath, { sha256, ...o });
  writeBundle();
  const paths = revampPaths({ HOME: join(root, "home") });
  const opts: PatchAppOptions = {
    appId: "demo",
    bundlePath,
    paths,
    releaseBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
  return { opts, paths, writeBundle, hits: () => hits, close: () => server.close() };
}
const appRoot = (s: { paths: { data: string } }) => join(s.paths.data, "apps/demo");

test("downloads, patches, repacks and installs; the second run reuses the download", async (t) => {
  const s = await setup();
  t.after(s.close);
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 0);
  assert.equal(r.installed, true);
  assert.deepEqual(r.results.map((x) => [x.name, x.status]), [["Say goodbye", "applied"]]);
  const dir = join(appRoot(s), "1.0.0");
  assert.equal(r.installDir, dir);
  assert.equal(extractFile(join(dir, "resources/app.asar"), "out/main.js").toString(), 'console.log("goodbye");\n');
  assert.equal(readFileSync(join(dir, "revamp-icon.png"), "utf8"), "big-png");
  assert.equal(statSync(join(dir, "demo")).mode & 0o111, 0o111);
  assert.equal(existsSync(join(dir, ".revamp-meta")), false);
  assert.equal(existsSync(join(dir, ".revamp-out")), false);
  const entry = parseDesktopEntry(readFileSync(join(s.paths.applications, "revamp-demo.desktop"), "utf8"));
  assert.equal(entry.Name, "Demo (Revamped)");
  assert.equal(entry.MimeType, "x-scheme-handler/demo;");
  const receipt = JSON.parse(readFileSync(join(dir, "revamp.json"), "utf8"));
  assert.equal(receipt.release.asset, "demo_1.0.0_amd64.deb");
  assert.equal(receipt.bundle.name, "Demo bundle");
  const before = s.hits();
  assert.equal((await patchApp(s.opts)).exitCode, 0);
  assert.equal(s.hits(), before);
});

test("symlinks planted in the .deb never redirect Revamp's own writes", async (t) => {
  const planted = [
    tarEntry("./opt/Demo/revamp-icon.png", "", { type: "2", linkname: "demo" }),
    tarEntry("./opt/Demo/resources/app.asar.new", "", { type: "2", linkname: "../demo" }),
  ];
  const s = await setup({}, planted);
  t.after(s.close);
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 0);
  const dir = join(appRoot(s), "1.0.0");
  assert.equal(readFileSync(join(dir, "demo"), "utf8"), "#!/bin/sh\necho demo\n");
  assert.equal(readFileSync(join(dir, "revamp-icon.png"), "utf8"), "big-png");
  assert.equal(extractFile(join(dir, "resources/app.asar"), "out/main.js").toString(), 'console.log("goodbye");\n');
});

test("an interrupted job's leftovers are swept, and a running job blocks a second one", async (t) => {
  const s = await setup();
  t.after(s.close);
  const root = appRoot(s);
  mkdirSync(join(root, ".staging-interrupted/resources"), { recursive: true });
  writeFileSync(join(root, ".staging-interrupted/resources/app.asar"), "700 MB in real life");
  writeFileSync(join(root, ".lock"), String(spawnSync(process.execPath, ["-e", ""]).pid)); // a pid that has exited
  assert.equal((await patchApp(s.opts)).exitCode, 0);
  assert.deepEqual(readdirSync(root).filter((n) => n.startsWith(".")), []);
  writeFileSync(join(root, ".lock"), String(process.pid));
  await assert.rejects(patchApp(s.opts), /another Revamp job for demo is running/);
});

test("a dry run reports results and installs nothing", async (t) => {
  const s = await setup();
  t.after(s.close);
  const r = await patchApp({ ...s.opts, dryRun: true });
  assert.equal(r.installed, false);
  assert.equal(r.results[0].status, "applied");
  assert.deepEqual(readdirSync(appRoot(s)), []);
});

test("unsupported requests fail before anything is downloaded", async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(patchApp({ ...s.opts, appId: "nope" }), /has no app "nope" \(it has: demo\)/);
  await assert.rejects(patchApp({ ...s.opts, version: "9.9.9" }), /not supported.*supported: 1\.0\.0, 2\.0\.0/);
  await assert.rejects(patchApp({ ...s.opts, version: "2.0.0" }), /experimental.*--force/);
  s.writeBundle({ minEngine: "99.0.0" });
  await assert.rejects(patchApp(s.opts), /needs Revamp 99\.0\.0 or newer/);
  s.writeBundle({ extra: 'app.release.asset = "../evil_{version}.deb";' });
  await assert.rejects(patchApp(s.opts), /unsafe asset/);
  assert.equal(s.hits(), 0);
});

test("a failed required patch installs nothing and keeps the previous install intact", async (t) => {
  const s = await setup();
  t.after(s.close);
  await patchApp(s.opts);
  s.writeBundle({
    extra: 'const must = { kind: "patch", name: "Must", execute() { throw new Error("boom"); } }; patches.push(must); app.required.push(must);',
  });
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 1);
  assert.equal(r.installed, false);
  assert.match(r.aborted!, /required patch "Must" failed: boom/);
  assert.equal(readlinkSync(join(appRoot(s), "current")), "1.0.0");
  assert.equal(extractFile(join(appRoot(s), "1.0.0/resources/app.asar"), "out/main.js").toString(), 'console.log("goodbye");\n');
  assert.deepEqual(readdirSync(appRoot(s)).filter((n) => n.startsWith(".")), []);
});

test("an optional patch failure still installs and exits 2", async (t) => {
  const s = await setup({
    extra: 'patches.push({ kind: "patch", name: "Broken", compatibleWith: [{ app }], execute() { throw new Error("nope"); } });',
  });
  t.after(s.close);
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 2);
  assert.equal(r.installed, true);
  assert.equal(r.results.find((x) => x.name === "Broken")!.message, "nope");
});
