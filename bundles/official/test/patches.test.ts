import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { definePatch } from "@revamp/sdk";
import { memoryStore, runJob, type Selection } from "@revamp/engine";
import { formatPatchResult } from "../../../packages/cli/src/format.ts";
import { EXTENSION_FILE, HYDRA_EXTENSION } from "../src/hydra/extension-loader.ts";
import { hydra } from "../src/apps.ts";
import { STEAM_BRIDGE, steamBridge } from "../src/hydra/steam-bridge.ts";
import * as bundle from "../src/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/hydra-4.1.6/${name}`, import.meta.url), "utf8");
const RENDERER = "out/renderer/assets/index-Cpo9haoY.js";
const LOCALES = "out/renderer/assets/locales-excerpt.js"; // in the real release this is part of RENDERER
const MORE_LIKE_THIS = "out/renderer/assets/more-like-this-excerpt.js"; // likewise
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
    [MORE_LIKE_THIS]: fixture("more-like-this-excerpt.js"),
    "out/renderer/index.html": fixture("index.html"),
    "out/preload/index.mjs": fixture("preload-excerpt.mjs"),
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
    ["Recently added sort", "applied", false],
    ["Recently downloaded sort", "applied", false],
    ["More like this ranking", "applied", false],
    ["(internal patch #4: Hydra locales)", "applied", true],
    ["(internal patch #7: Hydra extension loader)", "applied", true],
    ["(internal patch #8: registry: game page)", "applied", true],
    ["(internal patch #9: registry: game data)", "applied", true],
    ["(internal patch #10: registry: library)", "applied", true],
    ["(internal patch #11: registry: Steam tags)", "applied", true],
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
  assert.equal(status("Recently added sort").status, "skipped");
  assert.equal(status("More like this ranking").status, "skipped");
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

test("Hydra locales ignores nested objects inside a library namespace", () => {
  const locales = fixture("locales-excerpt.js").replace(`"{{collectionName}}"?' };`, `"{{collectionName}}"?', "nested": { "x": "X" } };`);
  const code = job(NONE, hydraFiles({ [LOCALES]: locales })).outputs.get(LOCALES)!.toString();
  const en = code.split("\n").find((l) => l.startsWith("const library$y = "))!;
  assert.ok(en.endsWith(`"nested": { "x": "X" }, "sort_recently_downloaded": "Recently downloaded", "sort_recently_added": "Recently added" };`));
});

test("Hydra locales names a library namespace that isn't an object literal", () => {
  const locales = fixture("locales-excerpt.js").replace(/^const library\$y = (\{.*\});$/m, "const library$y = Object.freeze($1);");
  const r = job(NONE, hydraFiles({ [LOCALES]: locales })).results.find((x) => x.internal)!;
  assert.equal(r.status, "failed");
  assert.equal(r.message, `the en library namespace (${LOCALES}:11) is not an object literal`);
});

test("the sorts are skipped, naming the internal patch, when the locales can't be found", () => {
  const out = job(NONE, hydraFiles({ [LOCALES]: fixture("locales-excerpt.js").replace("  bg\n};", "  bg: \"bg\"\n};") }));
  const locales = out.results.find((r) => r.internal)!;
  assert.equal(locales.status, "failed");
  assert.match(locales.message!, /fingerprint "i18n resources" failed at step "where:values are locale objects": 2 match\(es\) before this check, 0 after/);
  for (const name of ["Recently added sort", "Recently downloaded sort"]) {
    const r = out.results.find((x) => x.name === name)!;
    assert.equal(r.status, "skipped");
    assert.equal(r.message, 'dependency "(internal patch #4: Hydra locales)" failed');
  }
});

test("Recently added sort edits the same five places; menus read played, added, downloaded", () => {
  const code = job().outputs.get(RENDERER)!.toString();
  assert.equal(code.match(/"recently_added"/g)?.length, 5);
  assert.ok(code.includes('{ value: "recently_added", label: t2("sort_recently_added", { ns: "library" }), icon: jsxRuntimeExports.jsx(CalendarIcon$revamp, { size: 14 }) }'));
  assert.ok(code.includes('{ value: "recently_added", label: t2("sort_recently_added") }'));
  assert.match(code, /var CalendarIcon\$revamp = createIconComponent\("CalendarIcon", "octicon octicon-calendar", function\(\) \{\n  return \{ "16": \{ "width": 16, "path": jsxRuntimeExports\.jsx\("path", \{ d: "M4\.75 0a/);
  for (const list of [/"recently_played",\s*"recently_added",\s*"recently_downloaded",\s*"most_played"/g, /value: "recently_played"[^]*?value: "recently_added"[^]*?value: "recently_downloaded"[^]*?value: "most_played"/g]) {
    assert.equal(code.match(list)?.length, 2, String(list));
  }
});

test("Recently added sort orders newest first, then games without a date, each group by title", () => {
  const code = job().outputs.get(RENDERER)!.toString();
  const source = code.slice(code.indexOf("const sortLibraryGames$1"), code.indexOf('}, "sortLibraryGames$1");') + 25);
  const sortLibraryGames = new Function(
    "__name",
    "compareLibraryGamesByTitle",
    "getPlayTimeDifference",
    "getMostPlayedDifference",
    `${source}\nreturn sortLibraryGames$1;`,
  )((f: unknown) => f, (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title), () => 0, () => 0);
  const games = [
    { title: "No date B" },
    { title: "Old", addedToLibraryAt: "2024-01-01T00:00:00.000Z" },
    { title: "Bad date", addedToLibraryAt: "not a date" },
    { title: "New", addedToLibraryAt: new Date("2026-10-01").getTime() },
    { title: "No date A", addedToLibraryAt: null },
  ];
  assert.deepEqual(sortLibraryGames(games, "recently_added").map((g: { title: string }) => g.title), ["New", "Old", "Bad date", "No date A", "No date B"]);
});

test("a release the patches don't fit gives the spec's report: what applies, and where each miss failed", () => {
  const changed = fixture("renderer-excerpt.js").replace('case "recently_played": {', 'case "recently_played_v2": {');
  const input = { appId: "hydra", version: "4.1.7", selection: NONE, force: true, stockDesktop: STOCK };
  const out = runJob(bundle, input, memoryStore(hydraFiles({ [RENDERER]: changed })));
  const report = formatPatchResult({
    appId: "hydra",
    appName: "Hydra",
    version: "4.1.7",
    untested: true,
    results: out.results,
    installed: false,
    dryRun: true,
    exitCode: 2,
    warnings: [],
    logs: out.logs,
  });
  const miss =
    'fingerprint "library sort switch" failed at step "pattern": strings matched 1 file(s): out/renderer/assets/index-Cpo9haoY.js; ' +
    'pattern [...$GAMES].sort(($A, $B) => { switch ($BY) { case "recently_played": { $$$ } } $$$ }) matched 0 nodes';
  assert.equal(
    report,
    [
      "Hydra 4.1.7 (untested): 4/6 patches apply (dry run, nothing installed)",
      "  ✓ Disable self-update (required)",
      "  ✓ Side-by-side identity (required)",
      "  ✓ Use the bundled UI",
      "  ✗ Recently added sort",
      `      ${miss}`,
      "  ✗ Recently downloaded sort",
      `      ${miss}`,
      "  ✓ More like this ranking",
    ].join("\n"),
  );
});

const REGISTRY = (entries: string) => `Object.assign((globalThis.__revamp ??= { registry: {}, mounts: {} }).registry, { ${entries} });`;

test("the extension loader ships the extension and loads it before Hydra's own module script", () => {
  const out = job();
  assert.equal(out.outputs.get(EXTENSION_FILE)!.toString(), HYDRA_EXTENSION);
  const html = out.outputs.get("out/renderer/index.html")!.toString();
  assert.ok(
    html.includes(
      '    <script type="module" crossorigin src="./assets/revamp-hydra.js"></script>\n' +
        '    <script type="module" crossorigin src="./assets/index-Cpo9haoY.js"></script>',
    ),
  );
});

test("the registry patches name Hydra's internals just before the root render, and More like this mounts the stock section", () => {
  const code = job().outputs.get(MORE_LIKE_THIS)!.toString();
  const registry = [
    REGISTRY(
      "React: reactExports$1, jsxRuntime: jsxRuntimeExports, useNavigate: useNavigate, useTranslation: useTranslation, " +
        "useEmblaCarousel: useEmblaCarousel, VerticalCoverCard: VerticalCoverCard, buildGameDetailsPath: buildGameDetailsPath, " +
        "ChevronLeftIcon: ChevronLeftIcon, ChevronRightIcon: ChevronRightIcon, Skeleton: Skeleton$1",
    ),
    REGISTRY("levelDBService: levelDBService, orderBy: orderBy$1, logger: logger"),
    REGISTRY("useLibrary: useLibrary$1, useAppDispatch: useAppDispatch$1, useAppSelector: useAppSelector$1"),
    REGISTRY("setTags: catalogueSearchSlice.actions.setTags, getLocalizedSteamMetadata: getLocalizedSteamMetadata"),
  ];
  assert.ok(code.includes(`${registry.join("\n")}\nReactDOM$1.createRoot(document.getElementById("root"))`));
  assert.ok(
    code.includes(
      '}\nSimilarGames = globalThis.__revamp?.mount?.("hydra.similarGames", SimilarGames) ?? SimilarGames;\n__name(SimilarGames, "SimilarGames");',
    ),
  );
});

test("a changed stock section skips only More like this, so Hydra keeps its stock section", () => {
  const changed = fixture("more-like-this-excerpt.js").replace("similar-games__control--previous", "similar-games__control--back");
  const out = job(NONE, hydraFiles({ [MORE_LIKE_THIS]: changed }));
  const r = (name: string) => out.results.find((x) => x.name === name)!;
  assert.equal(r("(internal patch #8: registry: game page)").status, "failed");
  assert.match(r("(internal patch #8: registry: game page)").message!, /expected 1 match, found 0/);
  assert.equal(r("More like this ranking").status, "skipped");
  assert.equal(r("Recently added sort").status, "applied");
  assert.equal(out.outputs.get(MORE_LIKE_THIS)!.toString().includes("__revamp?.mount"), false);
});

test("with More like this disabled, the renderer, index.html and the extension file are untouched", () => {
  const out = job({ ...NONE, disable: ["More like this ranking"] });
  for (const file of [MORE_LIKE_THIS, "out/renderer/index.html", EXTENSION_FILE]) assert.equal(out.outputs.has(file), false, file);
});

test("a captured name that isn't declared at the top level fails its registry patch instead of breaking Hydra's startup", () => {
  // Registry lines run while Hydra's module loads: a name out of scope there would throw and blank the whole UI.
  const changed = fixture("more-like-this-excerpt.js").replace("const logger = log$2.scope(\"renderer\");\n", "");
  const out = job(NONE, hydraFiles({ [MORE_LIKE_THIS]: changed }));
  const data = out.results.find((x) => x.name === "(internal patch #9: registry: game data)")!;
  assert.equal(data.status, "failed");
  assert.match(data.message!, /resolve\(\): logger .* has no top-level declaration/);
  assert.equal(out.results.find((x) => x.name === "More like this ranking")!.status, "skipped");
  assert.equal(out.outputs.get(MORE_LIKE_THIS)!.toString().includes("logger: logger"), false);
});

test("a captured name declared after the root render fails its registry patch instead of breaking Hydra's startup", () => {
  // A const declared after the render isn't initialized yet when the registry line runs (temporal dead zone).
  const declaration = 'const logger = log$2.scope("renderer");\n';
  const changed = fixture("more-like-this-excerpt.js").replace(declaration, "") + declaration;
  const out = job(NONE, hydraFiles({ [MORE_LIKE_THIS]: changed }));
  const data = out.results.find((x) => x.name === "(internal patch #9: registry: game data)")!;
  assert.equal(data.status, "failed");
  assert.match(data.message!, /registry entry logger \(logger\) is declared after the root render/);
  assert.equal(out.results.find((x) => x.name === "More like this ranking")!.status, "skipped");
});

test("the Steam bridge registers its handlers after registerEvent and exposes them in the preload", () => {
  const probe = definePatch({ name: "Probe", compatibleWith: [{ app: hydra, versions: ["4.1.6"] }], dependsOn: [steamBridge], execute() {} });
  const out = runJob(
    { ...bundle, patches: [...bundle.patches, probe] },
    { appId: "hydra", version: "4.1.6", selection: { enable: ["Probe"], disable: [], options: {} }, force: false, stockDesktop: STOCK },
    memoryStore(hydraFiles()),
  );
  assert.equal(out.results.find((r) => r.name === "Probe")!.status, "applied");
  assert.ok(
    out.outputs.get("out/main/index.js")!.toString().includes(
      "return JSON.parse(JSON.stringify(result));\n        });\n    });\n};\n" + STEAM_BRIDGE + "\n__revampSteamBridge.registerSteamBridge(registerEvent, logger);",
    ),
  );
  assert.ok(
    out.outputs.get("out/preload/index.mjs")!.toString().includes(
      'getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"), revampGetSteamAppTags: (objectId) => ipcRenderer.invoke("revamp:getSteamAppTags", objectId), revampGetSteamRecommendations: (objectId) => ipcRenderer.invoke("revamp:getSteamRecommendations", objectId),',
    ),
  );
});
