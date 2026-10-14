import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, getRawHeader, listPackage } from "@electron/asar";
import { patchApp, revampPaths } from "@revamp/engine";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "M1: patch the real Hydra 4.1.6 release into a throwaway home",
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
        ["Recently downloaded sort", "applied"],
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
