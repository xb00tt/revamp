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
    // 1.0.0 is listed in the bundle; 3.0.0 is not, so only GitHub's API knows its SHA-256.
    if (/^\/example\/demo\/releases\/download\/v([13])\.0\.0\/demo_\1\.0\.0_amd64\.deb$/.test(req.url!)) res.end(deb);
    else if (req.url === "/repos/example/demo/releases/tags/v3.0.0") {
      res.end(JSON.stringify({ assets: [{ name: "demo_3.0.0_amd64.deb", digest: `sha256:${sha256}` }] }));
    } else {
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
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const opts: PatchAppOptions = { appId: "demo", bundlePath, paths, releaseBaseUrl: base, apiBaseUrl: base };
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


const SHOUT =
  'patches.push({ kind: "patch", name: "Shout", compatibleWith: [{ app }], default: false, ' +
  'options: { times: { kind: "option", type: "number", title: "Times", default: 1 } }, ' +
  "execute(ctx) { ctx.log(`shouting ${ctx.options.times}x`); } });";

test("bad patch names and options fail before anything is downloaded", async (t) => {
  const s = await setup({ extra: SHOUT });
  t.after(s.close);
  await assert.rejects(patchApp({ ...s.opts, enable: ["Nope"] }), /Demo has no patch "Nope" \(see: revamp patches demo\)/);
  await assert.rejects(patchApp({ ...s.opts, options: ["Shout:times=lots"] }), /value must be a number/);
  await assert.rejects(patchApp({ ...s.opts, options: ["Shout:loud=true"] }), /"Shout" has no option "loud" \(it has: times\)/);
  await assert.rejects(patchApp({ ...s.opts, options: ["nonsense"] }), /must look like "<patch>:<key>=<value>"/);
  assert.equal(s.hits(), 0);
});

test("--option values reach the patch, and the cleaned-up selection is saved", async (t) => {
  const s = await setup({ extra: SHOUT });
  t.after(s.close);
  const file = join(s.paths.config, "apps/demo.json");
  mkdirSync(join(s.paths.config, "apps"), { recursive: true });
  writeFileSync(file, JSON.stringify({ enable: ["Removed long ago"], disable: [], options: {} }));
  const r = await patchApp({ ...s.opts, enable: ["Shout"], options: ["Shout:times=3"] });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.logs, ["[Shout] shouting 3x"]);
  assert.match(r.warnings[0], /Dropped "Removed long ago" from your saved choices for Demo: this bundle no longer has that patch\./);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enable: ["Shout"], disable: [], options: { Shout: { times: 3 } } });
});

test("the app's executable must be a safe relative path and a file in the .deb", async (t) => {
  const s = await setup({ extra: 'app.executable = "../../bin/sh";' });
  t.after(s.close);
  await assert.rejects(patchApp(s.opts), /unsafe executable "\.\.\/\.\.\/bin\/sh"/);
  assert.equal(s.hits(), 0);
  s.writeBundle({ extra: 'app.executable = "resources";' });
  await assert.rejects(patchApp(s.opts), /the \.deb has no executable file opt\/Demo\/resources/);
  assert.equal(existsSync(join(appRoot(s), "1.0.0")), false);
  assert.deepEqual(readdirSync(appRoot(s)), []);
});

test("desktop file and icon links are never moved into .revamp-meta", async (t) => {
  // Valid where the .deb puts it (it climbs to the archive root), but 6 levels up from .revamp-meta/icons/512/ is outside.
  const deep = tarEntry("./usr/share/icons/hicolor/512x512/apps/demo.png", "", { type: "2", linkname: "../../../../../../opt/Demo/demo" });
  // Three levels up from .revamp-meta/icons/1024/ is the staging root, so moved there it would make the executable the icon.
  const shallow = tarEntry("./usr/share/icons/hicolor/1024x1024/apps/demo.png", "", { type: "2", linkname: "../../../demo" });
  const s = await setup({}, [deep, shallow]);
  t.after(s.close);
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 0);
  assert.equal(readFileSync(join(appRoot(s), "1.0.0/revamp-icon.png"), "utf8"), "big-png");
});

test("an unlisted version needs --force and is verified against GitHub's published SHA-256", async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(patchApp({ ...s.opts, version: "3.0.0" }), /not supported.*add --force/);
  assert.equal(s.hits(), 0);
  const r = await patchApp({ ...s.opts, version: "3.0.0", force: true });
  assert.equal(r.exitCode, 0);
  assert.equal(r.untested, true);
  assert.match(r.warnings[0], /Demo 3\.0\.0 is untested: bundle "Demo bundle" doesn't list it/);
  const receipt = JSON.parse(readFileSync(join(appRoot(s), "3.0.0/revamp.json"), "utf8"));
  assert.equal(receipt.release.untested, true);
  assert.equal(receipt.release.sha256, createHash("sha256").update(readFileSync(join(s.paths.cache, "releases/demo/3.0.0/demo_3.0.0_amd64.deb"))).digest("hex"));
  await assert.rejects(patchApp({ ...s.opts, version: "4.0.0", force: true }), /example\/demo has no release v4\.0\.0 on GitHub/);
  assert.equal((await patchApp(s.opts)).untested, false);
});
