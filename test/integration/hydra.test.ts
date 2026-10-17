import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, getRawHeader, listPackage } from "@electron/asar";
import { patchApp, revampPaths } from "@revamp-app/engine";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "patch the real Hydra 4.1.6 release into a throwaway home",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    // The real cache is shared, so the 149 MB .deb downloads once; installs go to a temp home (≈700 MB, removed after).
    const home = mkdtempSync(join(tmpdir(), "revamp-it-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const paths = { ...revampPaths({ HOME: home }), cache: revampPaths().cache };
    const cached = existsSync(join(paths.cache, "releases/hydra/4.1.6/hydralauncher_4.1.6_amd64.deb"));
    const started = performance.now();
    const r = await patchApp({ appId: "hydra", bundlePath: BUNDLE, paths, log: (l) => console.log(l) });
    const seconds = (performance.now() - started) / 1000;
    console.log(`patch job took ${seconds.toFixed(1)} s (download ${cached ? "cached" : "included"})`);

    assert.equal(r.exitCode, 0, JSON.stringify(r.results, null, 2));
    assert.deepEqual(
      r.results.filter((x) => !x.internal).map((x) => [x.name, x.status]),
      [
        ["Disable self-update", "applied"],
        ["Side-by-side identity", "applied"],
        ["Use the bundled UI", "applied"],
        ["Recently added sort", "applied"],
        ["Recently downloaded sort", "applied"],
        ["More like this (Revamped)", "applied"],
        ["More like this (Steam)", "applied"],
      ],
    );
    assert.deepEqual(
      r.results.filter((x) => x.internal).map((x) => [x.name, x.status]),
      [
        ["(internal patch #4: Hydra locales)", "applied"],
        ["(internal patch #7: Hydra extension loader)", "applied"],
        ["(internal patch #8: Steam bridge)", "applied"],
        ["(internal patch #9: registry: game page)", "applied"],
        ["(internal patch #10: registry: game data)", "applied"],
        ["(internal patch #11: registry: library)", "applied"],
        ["(internal patch #12: registry: Steam tags)", "applied"],
        ["(internal patch #13: Similar games rows)", "applied"],
        ["(internal patch #14: registry: settings)", "applied"],
        ["(internal patch #15: Similar games settings)", "applied"],
      ],
    );
    if (cached) assert.ok(seconds < 60, `patching took ${seconds.toFixed(1)} s; expected seconds, not minutes`);

    const apps = join(paths.data, "apps/hydra");
    assert.equal(readlinkSync(join(apps, "current")), "4.1.6");
    const dir = join(apps, "4.1.6");
    const asar = join(dir, "resources/app.asar");
    assert.equal(statSync(join(dir, "hydralauncher")).mode & 0o111, 0o111);
    assert.ok(existsSync(join(dir, "resources/app.asar.unpacked")));

    assert.equal(JSON.parse(extractFile(asar, "package.json").toString()).desktopName, "revamp-hydra.desktop");
    // Release builds load their UI from Hydra's website unless patched; the renderer edits live in the bundled copy.
    const main = extractFile(asar, "out/main/index.js").toString();
    assert.equal(main.includes("hydra-eqi.pages.dev"), false);
    assert.ok(main.includes('loadFile(path.join(__dirname, "../renderer/index.html")'));
    for (const f of ["node_modules/electron-updater/out/AppUpdater.js", "node_modules/electron-updater/out/AppImageUpdater.js"]) {
      assert.match(extractFile(asar, f).toString(), /isUpdaterActive\(\) \{\s*return false;\s*\}/, f);
    }
    const rendererFiles = listPackage(asar, { isPack: false })
      .map((p) => p.replace(/^[/\\]/, ""))
      .filter((p) => /^out\/renderer\/assets\/[^/]+\.js$/.test(p));
    const patched = rendererFiles.map((p) => extractFile(asar, p).toString()).filter((code) => code.includes('case "recently_downloaded"'));
    assert.equal(patched.length, 1);
    assert.equal(patched[0].match(/"recently_downloaded"/g)?.length, 5);
    assert.equal(patched[0].match(/"recently_added"/g)?.length, 5);
    for (const strings of [
      '"sort_recently_downloaded": "Recently downloaded", "sort_recently_added": "Recently added" };',
      '"sort_recently_downloaded": "Наскоро изтеглени", "sort_recently_added": "Наскоро добавени" };',
      '"sort_recently_downloaded": "Baixados recentemente", "sort_recently_added": "Adicionados recentemente" };',
    ]) {
      assert.equal(patched[0].split(strings).length, 2, strings);
    }

    // More like this: the extension ships next to the renderer and loads first; the renderer registers its
    // internals once, just before the root render, and routes the stock section through mount().
    assert.ok(extractFile(asar, "out/renderer/assets/revamp-hydra.js").toString().includes('mounts["hydra.similarGames"]'));
    const html = extractFile(asar, "out/renderer/index.html").toString();
    assert.ok(html.includes('<script type="module" crossorigin src="./assets/revamp-hydra.js"></script>'));
    assert.ok(html.indexOf("./assets/revamp-hydra.js") < html.indexOf('<script type="module" crossorigin src="./assets/index-'));
    assert.equal(patched[0].split("Object.assign((globalThis.__revamp ??= { registry: {}, mounts: {} }).registry, {").length, 6);
    assert.ok(/registry, \{ [^\n]* \}\);\nconst __revampSimilarGamesSettings [^\n]*\n(\(globalThis[^\n]*registry\.similarGames\w+ = true;\n){2}ReactDOM\$1\.createRoot\(document\.getElementById\("root"\)\)/.test(patched[0]));
    assert.equal(patched[0].split('SimilarGames = globalThis.__revamp?.mount?.("hydra.similarGames", SimilarGames) ?? SimilarGames;').length, 2);

    // The Steam bridge runs in the main process and the preload; the settings slot is mounted once.
    assert.equal(main.split("__revampSteamBridge.registerSteamBridge(registerEvent, logger);").length, 2);
    assert.ok(
      extractFile(asar, "out/preload/index.mjs").toString().includes('revampGetSteamRecommendations: (objectId) => ipcRenderer.invoke("revamp:getSteamRecommendations", objectId)'),
    );
    assert.equal(patched[0].split("jsxRuntimeExports.jsx(__revampSimilarGamesSettings, {})").length, 2);
    assert.ok(patched[0].includes("similarGamesSteam = true") && patched[0].includes("similarGamesRevamped = true"));

    // Big Picture's copies of the stock code are untouched.
    const slice = (from: string, to: string) => {
      const i = patched[0].indexOf(from);
      assert.ok(i >= 0, from);
      const j = patched[0].indexOf(to, i);
      assert.ok(j >= 0, to);
      return createHash("sha256").update(patched[0].slice(i, j + to.length)).digest("hex");
    };
    assert.equal(
      slice("const useSimilarGames = /* @__PURE__ */ __name((query) => {", '}, "useSimilarGames");'),
      "d086a5148f741eef8a3bde65ec1521bcd632206267dc5e4b00200d32510b7e09",
    );
    assert.equal(slice("function ContentSettingsSection(", "\n}\n"), "102baec72c8ac3e56136f52aa74d6470d909ce0f1a2530f6172f9a2b1e042c07");

    // Files the patches didn't touch must be byte-identical: their bytes still match the header's original hashes.
    const sample: Array<[string, string]> = [];
    const walk = (node: any, prefix: string) => {
      for (const [name, e] of Object.entries<any>(node.files ?? {})) {
        const p = prefix ? `${prefix}/${name}` : name;
        if (e.files) walk(e, p);
        else if (!e.unpacked && e.integrity && !p.startsWith("out/") && !p.includes("electron-updater") && p !== "package.json") sample.push([p, e.integrity.hash]);
      }
    };
    walk(getRawHeader(asar).header, "");
    for (const [p, hash] of sample.filter((_, i) => i % 500 === 0)) {
      assert.equal(createHash("sha256").update(extractFile(asar, p)).digest("hex"), hash, p);
    }

    const desktop = readFileSync(join(paths.applications, "revamp-hydra.desktop"), "utf8");
    assert.match(desktop, /^Name=Hydra \(Revamped\)$/m);
    assert.match(desktop, /^StartupWMClass=revamp-hydra$/m);
    assert.match(desktop, /^Exec=".*\/apps\/hydra\/current\/hydralauncher" %U$/m);
    const icon = /^Icon=(.*)$/m.exec(desktop)![1];
    assert.ok(existsSync(icon), icon);
  },
);

test(
  "each More like this patch applies without the other",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), "revamp-it-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const paths = { ...revampPaths({ HOME: home }), cache: revampPaths().cache };
    for (const [off, on] of [["More like this (Steam)", "More like this (Revamped)"], ["More like this (Revamped)", "More like this (Steam)"]]) {
      const r = await patchApp({ appId: "hydra", bundlePath: BUNDLE, paths, dryRun: true, disable: [off] });
      assert.equal(r.exitCode, 0, JSON.stringify(r.results, null, 2));
      assert.equal(r.results.find((x) => x.name === on)?.status, "applied", on);
    }
  },
);
