import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchApp } from "../src/api.ts";
import { addSource, prepareSource, removeSource } from "../src/bundle-sources.ts";
import { revampPaths } from "../src/paths.ts";
import { checkMessage, checkUpdates, loadSkipped, skipVersion, updateApp, type AppCheck, type UpdateOptions } from "../src/updates.ts";
import { demoDeb, writeDemoBundle } from "./helpers/demo.ts";

/** Demo 1.0.0 installed from a file source; the fake GitHub's latest release is `state.latest`. */
async function setup(list3 = false) {
  const deb = await demoDeb();
  const sha256 = createHash("sha256").update(deb).digest("hex");
  const state = { latest: "v1.0.0" };
  const server = createServer((req, res) => {
    if (/^\/example\/demo\/releases\/download\/v([13])\.0\.0\/demo_\1\.0\.0_amd64\.deb$/.test(req.url!)) res.end(deb);
    else if (req.url === "/repos/example/demo/releases/latest") res.end(JSON.stringify({ tag_name: state.latest }));
    else if (req.url === "/repos/example/demo/releases/tags/v3.0.0") res.end(JSON.stringify({ assets: [{ name: "demo_3.0.0_amd64.deb", digest: `sha256:${sha256}` }] }));
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "revamp-updates-"));
  const paths = revampPaths({ HOME: join(root, "home") });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const o: UpdateOptions = { paths, apiBaseUrl: base, releaseBaseUrl: base };
  const bundle = join(root, "demo.mjs");
  // list3: the bundle lists 3.0.0 as stable, with a patch that exists only for 1.0.0 and would fail on 3.0.0.
  const extra = `app.versions["3.0.0"] = { sha256: "${sha256}" };
patches.push({ kind: "patch", name: "Old only", compatibleWith: [{ app, versions: ["1.0.0"] }], execute() { throw new Error("only for 1.0.0"); } });`;
  writeDemoBundle(bundle, { sha256, extra: list3 ? extra : undefined });
  addSource(paths, (await prepareSource(paths, bundle)).source);
  assert.equal((await patchApp({ ...o, appId: "demo", bundlePath: bundle, version: "1.0.0" })).installed, true);
  /** Swaps the file source for a newer bundle 1.1.0 that adds the default patch "Say hi". */
  const newerBundle = async () => {
    const next = join(root, "demo-1.1.0.mjs");
    writeDemoBundle(next, { sha256, version: "1.1.0", extra: 'patches.push({ kind: "patch", name: "Say hi", compatibleWith: [{ app }], execute() {} });' });
    removeSource(paths, bundle);
    addSource(paths, (await prepareSource(paths, next)).source);
  };
  return { paths, o, state, newerBundle, close: () => server.close() };
}

test("check finds nothing new, then dry-runs a newer release and records the result", async (t) => {
  const s = await setup();
  t.after(s.close);
  const upToDate = await checkUpdates(s.o);
  assert.deepEqual(upToDate.apps, [{ appId: "demo", appName: "Demo", current: "1.0.0", latest: "1.0.0", listed: true, status: "up to date" }]);
  assert.deepEqual(upToDate.sources, []);

  s.state.latest = "v3.0.0"; // not listed in the bundle: verified by GitHub's digest and dry-run anyway
  const r = await checkUpdates(s.o);
  assert.deepEqual(r.apps, [
    { appId: "demo", appName: "Demo", current: "1.0.0", latest: "3.0.0", listed: false, status: "update", applied: 1, total: 1, failing: [], aborted: undefined },
  ]);
  assert.equal(checkMessage(r.apps[0]), "Demo 3.0.0 out, not yet in your bundles (untested: 1/1 patches apply)");
  assert.deepEqual(JSON.parse(readFileSync(join(s.paths.state, "last-check.json"), "utf8")), JSON.parse(JSON.stringify(r)));
  assert.equal(readlinkSync(join(s.paths.data, "apps/demo/current")), "1.0.0", "a check installs nothing");

  s.state.latest = "release-3";
  assert.deepEqual((await checkUpdates(s.o)).apps.map((a) => [a.status, a.error]), [
    ["failed", 'the latest Demo release on GitHub has tag "release-3", which doesn\'t fit "v{version}"'],
  ]);
});

test("a check of a listed release is not forced: version-limited patches are skipped as incompatible, like update", async (t) => {
  const s = await setup(true);
  t.after(s.close);
  s.state.latest = "v3.0.0";
  const [a] = (await checkUpdates(s.o)).apps;
  assert.deepEqual([a.status, a.listed, a.applied, a.total, a.failing, a.aborted, a.error], ["update", true, 1, 1, [], undefined, undefined]);
});

test("update installs the newest release with the saved selection; an unlisted one needs force", async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.deepEqual(await updateApp("demo", s.o), { appId: "demo", appName: "Demo", current: "1.0.0", latest: "1.0.0" });
  s.state.latest = "v3.0.0";
  await assert.rejects(updateApp("demo", s.o), /Demo 3\.0\.0 is not supported by bundle "Demo bundle" .*add --force/);
  const u = await updateApp("demo", { ...s.o, force: true });
  assert.equal(u.result?.installed, true);
  assert.equal(readlinkSync(join(s.paths.data, "apps/demo/current")), "3.0.0");
  await assert.rejects(updateApp("other", s.o), /^Error: other is not installed; install it with revamp patch other$/);
});

test("checkMessage words each outcome the way the notification shows it", () => {
  const c: AppCheck = { appId: "hydra", appName: "Hydra", current: "4.1.6", latest: "4.1.7", status: "update", listed: true, applied: 5, total: 5, failing: [] };
  assert.equal(checkMessage(c), "Hydra 4.1.7 out, 5/5 patches apply");
  assert.equal(checkMessage({ ...c, applied: 4, failing: ["Recently downloaded sort"] }), "Hydra 4.1.7 out, 4/5 apply: Recently downloaded sort fails");
  assert.equal(checkMessage({ ...c, applied: 3, failing: ["A", "B"] }), "Hydra 4.1.7 out, 3/5 apply: A, B fail");
  assert.equal(checkMessage({ ...c, listed: false, experimental: true }), "Hydra 4.1.7 out, experimental in your bundles (5/5 patches apply)");
  assert.equal(checkMessage({ ...c, aborted: "required patch failed" }), "Hydra 4.1.7 out, but its patch job fails: required patch failed");
  assert.equal(checkMessage({ ...c, status: "up to date", latest: "4.1.6" }), "Hydra 4.1.6 is up to date");
  assert.equal(checkMessage({ appId: "hydra", appName: "hydra", current: "4.1.6", status: "failed", error: "offline" }), "Couldn't check hydra: offline");
});

test("a newer bundle for the installed version is reported as new patches, and update re-patches with it", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.newerBundle();
  const [c] = (await checkUpdates(s.o)).apps;
  assert.deepEqual(c, {
    appId: "demo",
    appName: "Demo",
    current: "1.0.0",
    latest: "1.0.0",
    listed: true,
    status: "patches",
    bundle: { name: "Demo bundle", version: "1.1.0" },
    newPatches: ["Say hi"],
  });
  assert.equal(checkMessage(c), "Demo 1.0.0: Demo bundle 1.1.0 has new patches for it (Say hi); re-patch to apply them");
  assert.equal(checkMessage({ ...c, newPatches: [] }), "Demo 1.0.0: Demo bundle 1.1.0 is out; re-patch to use it");

  const u = await updateApp("demo", s.o);
  assert.deepEqual(u.result?.results.map((r) => [r.name, r.status]), [["Say goodbye", "applied"], ["Say hi", "applied"]]);
  const receipt = JSON.parse(readFileSync(join(s.paths.data, "apps/demo/1.0.0/revamp.json"), "utf8"));
  assert.equal(receipt.bundle.version, "1.1.0");
  assert.equal((await checkUpdates(s.o)).apps[0].status, "up to date");
  assert.equal((await updateApp("demo", s.o)).result, undefined);
});

test("a skipped release stays quiet until a newer one is out", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.state.latest = "v3.0.0";
  skipVersion(s.paths, "demo", "3.0.0");
  assert.deepEqual(loadSkipped(s.paths), { demo: "3.0.0" });
  const [c] = (await checkUpdates(s.o)).apps;
  assert.deepEqual([c.status, c.latest, c.applied], ["skipped", "3.0.0", undefined]);
  assert.equal(checkMessage(c), "Demo 3.0.0 out (skipped)");
  skipVersion(s.paths, "demo", "2.9.0"); // an older skip doesn't hide 3.0.0
  assert.equal((await checkUpdates(s.o)).apps[0].status, "update");
  skipVersion(s.paths, "demo", null);
  assert.deepEqual(loadSkipped(s.paths), {});
});
