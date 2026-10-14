import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore, runJob, type Selection } from "@revamp/engine";
import * as bundle from "../src/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/hydra-4.1.6/${name}`, import.meta.url), "utf8");
const RENDERER = "out/renderer/assets/index-Cpo9haoY.js";
const LOCALES = "out/renderer/assets/locales-excerpt.js"; // in the real release this is part of RENDERER
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
    [LOCALES]: fixture("locales-excerpt.js"),
    [UPDATERS[0]]: fixture("AppUpdater-excerpt.js"),
    [UPDATERS[1]]: fixture("AppImageUpdater-excerpt.js"),
    ...overrides,
  };
}

const NONE: Selection = { enable: [], disable: [], options: {} };
const job = (selection = NONE, files = hydraFiles()) =>
  runJob(bundle, { appId: "hydra", version: "4.1.6", selection, force: false, stockDesktop: STOCK }, memoryStore(files));

test("every Hydra patch applies to the Hydra 4.1.6 excerpts", () => {
  const out = job();
  assert.equal(out.aborted, undefined);
  assert.deepEqual(out.results.map((r) => [r.name, r.status, r.internal]), [
    ["Disable self-update", "applied", false],
    ["Side-by-side identity", "applied", false],
    ["Use the bundled UI", "applied", false],
    ["Recently downloaded sort", "applied", false],
    ["(internal patch #4: Hydra locales)", "applied", true],
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
  assert.equal(out.outputs.get("out/main/index.js")!.toString().match(/setAsDefaultProtocolClient\(/g)?.length, 2);
});

test("claimLinks=false stops protocol registration and drops MimeType", () => {
  const out = job({ ...NONE, options: { "Side-by-side identity": { claimLinks: false } } });
  assert.equal(out.outputs.get("out/main/index.js")!.toString().includes("setAsDefaultProtocolClient"), false);
  assert.equal("MimeType" in out.desktopEntry, false);
});

test("Use the bundled UI loads the release's own UI instead of Hydra's website", () => {
  const main = job().outputs.get("out/main/index.js")!.toString();
  assert.equal(main.includes("hydra-eqi.pages.dev"), false);
  assert.match(main, /\} else \{\s*window\.loadFile\(path\.join\(__dirname, "\.\.\/renderer\/index\.html"\), \{\s*hash\s*\}\);\s*\}/);
});

test("renderer patches are skipped, not silently dead, when the bundled UI can't be forced", () => {
  const remoteOnly = fixture("main-excerpt.js").replace(/try \{[\s\S]*?\n      \}\n/, "await window.loadURL(remote);\n");
  const out = job(NONE, hydraFiles({ "out/main/index.js": remoteOnly }));
  const status = (name: string) => out.results.find((r) => r.name === name)!;
  assert.equal(status("Use the bundled UI").status, "failed");
  assert.equal(status("Recently downloaded sort").status, "skipped");
  assert.match(status("Recently downloaded sort").message!, /dependency "Use the bundled UI" failed/);
});

test("Recently downloaded sort edits the five places and leaves the decoys alone", () => {
  const code = job().outputs.get(RENDERER)!.toString();
  assert.match(code, /case "recently_downloaded": \{\s*const difference = \(b2\.download\?\.timestamp \?\? 0\) - \(a2\.download\?\.timestamp \?\? 0\);/);
  assert.ok(
    code.includes(
      '{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { ns: "library" }), icon: jsxRuntimeExports.jsx(DownloadIcon, { size: 14 }) }',
    ),
  );
  assert.ok(code.includes('{ value: "recently_downloaded", label: t2("sort_recently_downloaded") }'));
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

test("Hydra locales adds the fork's strings to en, bg and pt-BR only, found through resources", () => {
  const code = job().outputs.get(LOCALES)!.toString();
  const line = (name: string) => code.split("\n").find((l) => l.startsWith(`const ${name} = `))!;
  assert.ok(line("library$y").endsWith(`"sort_recently_downloaded": "Recently downloaded", "sort_recently_added": "Recently added" };`));
  assert.ok(line("library$7").endsWith(`"sort_recently_downloaded": "Наскоро изтеглени", "sort_recently_added": "Наскоро добавени" };`));
  assert.ok(line("library$w").endsWith(`"sort_recently_downloaded": "Baixados recentemente", "sort_recently_added": "Adicionados recentemente" };`));
  // German has the same English "Most played" as en, so text can't tell locales apart; resources can.
  assert.equal(line("library$q"), fixture("locales-excerpt.js").split("\n").find((l) => l.startsWith("const library$q = ")));
  assert.ok(code.includes('const LANGUAGE_FLAG_MAP = {\n  "pt-BR": "BR",\n  "pt-PT": "PT",\n  en: "US",\n  de: "DE",\n  bg: "BG"\n};'));
});

test("Hydra locales leaves the main process's own copy of the translations alone", () => {
  const out = job(NONE, hydraFiles({ "out/main/locales.js": fixture("locales-excerpt.js") }));
  assert.equal(out.results.find((r) => r.internal)!.status, "applied");
  assert.equal(out.outputs.has("out/main/locales.js"), false);
  assert.ok(out.outputs.has(LOCALES));
});

test("Hydra locales keeps keys a release already has", () => {
  const locales = fixture("locales-excerpt.js").replace('"sort_most_played": "Mais jogados"', '"sort_most_played": "Mais jogados", "sort_recently_added": "Upstream"');
  const code = job(NONE, hydraFiles({ [LOCALES]: locales })).outputs.get(LOCALES)!.toString();
  const ptBR = code.split("\n").find((l) => l.startsWith("const library$w = "))!;
  assert.ok(ptBR.endsWith(`"sort_recently_added": "Upstream", "sort_recently_downloaded": "Baixados recentemente" };`));
});

test("the sorts are skipped, naming the internal patch, when the locales can't be found", () => {
  const out = job(NONE, hydraFiles({ [LOCALES]: fixture("locales-excerpt.js").replace("  bg\n};", "  bg: \"bg\"\n};") }));
  const locales = out.results.find((r) => r.internal)!;
  assert.equal(locales.status, "failed");
  assert.match(locales.message!, /fingerprint "i18n resources" failed at step "where:values are locale objects": 2 match\(es\) before this check, 0 after/);
  for (const name of ["Recently downloaded sort"]) {
    const r = out.results.find((x) => x.name === name)!;
    assert.equal(r.status, "skipped");
    assert.equal(r.message, 'dependency "(internal patch #4: Hydra locales)" failed');
  }
});
