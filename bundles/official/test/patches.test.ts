import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore, runJob, type Selection } from "@revamp/engine";
import * as bundle from "../src/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/hydra-4.1.6/${name}`, import.meta.url), "utf8");
const RENDERER = "out/renderer/assets/index-Cpo9haoY.js";
const UPDATERS = ["node_modules/electron-updater/out/AppUpdater.js", "node_modules/electron-updater/out/AppImageUpdater.js"];
const STOCK = {
  Name: "Hydra",
  Exec: "/opt/Hydra/hydralauncher %U",
  Icon: "hydralauncher",
  StartupWMClass: "Hydra",
  MimeType: "x-scheme-handler/hydralauncher;",
  Categories: "Game;",
};

function hydraFiles(overrides: Record<string, string> = {}) {
  return {
    "package.json": '{\n  "name": "hydralauncher",\n  "version": "4.1.6",\n  "main": "./out/main/index.js",\n  "type": "module"\n}\n',
    "out/main/index.js": fixture("main-excerpt.js"),
    [RENDERER]: fixture("renderer-excerpt.js"),
    [UPDATERS[0]]: fixture("AppUpdater-excerpt.js"),
    [UPDATERS[1]]: fixture("AppImageUpdater-excerpt.js"),
    ...overrides,
  };
}

const NONE: Selection = { enable: [], disable: [], options: {} };
const job = (selection = NONE, files = hydraFiles()) =>
  runJob(bundle, { appId: "hydra", version: "4.1.6", selection, force: false, stockDesktop: STOCK }, memoryStore(files));

test("all M1 patches apply to the Hydra 4.1.6 excerpts", () => {
  const out = job();
  assert.equal(out.aborted, undefined);
  assert.deepEqual(out.results.map((r) => [r.name, r.status]), [
    ["Disable self-update", "applied"],
    ["Side-by-side identity", "applied"],
    ["Recently downloaded sort", "applied"],
  ]);
});

test("Disable self-update makes every isUpdaterActive() return false", () => {
  const out = job();
  for (const file of UPDATERS) assert.match(out.outputs.get(file)!.toString(), /isUpdaterActive\(\) \{\s*return false;\s*\}/, file);
});

test("Side-by-side identity sets desktopName, menu name and window class, and keeps links by default", () => {
  const out = job();
  assert.equal(JSON.parse(out.outputs.get("package.json")!.toString()).desktopName, "revamp-hydra.desktop");
  assert.deepEqual(out.desktopEntry, { ...STOCK, Name: "Hydra (Revamped)", StartupWMClass: "revamp-hydra" });
  assert.equal(out.outputs.has("out/main/index.js"), false);
});

test("claimLinks=false stops protocol registration and drops MimeType", () => {
  const out = job({ ...NONE, options: { "Side-by-side identity": { claimLinks: false } } });
  assert.equal(out.outputs.get("out/main/index.js")!.toString().includes("setAsDefaultProtocolClient"), false);
  assert.equal("MimeType" in out.desktopEntry, false);
});

test("Recently downloaded sort edits the five places and leaves the decoys alone", () => {
  const code = job().outputs.get(RENDERER)!.toString();
  assert.match(code, /case "recently_downloaded": \{\s*const difference = \(b2\.download\?\.timestamp \?\? 0\) - \(a2\.download\?\.timestamp \?\? 0\);/);
  assert.ok(
    code.includes(
      '{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { ns: "library", defaultValue: "Recently downloaded" }), icon: jsxRuntimeExports.jsx(DownloadIcon, { size: 14 }) }',
    ),
  );
  assert.ok(code.includes('{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { defaultValue: "Recently downloaded" }) }'));
  assert.equal(code.match(/"recently_downloaded"/g)?.length, 5);
  const original = fixture("renderer-excerpt.js");
  const decoys = (s: string) => s.slice(s.indexOf("function sortLibraryGames("));
  assert.equal(decoys(code), decoys(original));
});

test("a renderer without the sort case fails only that patch, naming the fingerprint and step", () => {
  const changed = fixture("renderer-excerpt.js").replace('case "recently_played": {', 'case "recently_played_v2": {');
  const out = job(NONE, hydraFiles({ [RENDERER]: changed }));
  const r = out.results.find((x) => x.name === "Recently downloaded sort")!;
  assert.equal(r.status, "failed");
  assert.match(r.message!, /fingerprint "library sort switch" failed at step "pattern"/);
  assert.equal(out.aborted, undefined);
});
