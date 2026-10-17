import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile } from "@electron/asar";
import { patchApp, revampPaths } from "@revamp-app/engine";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "patch the real Heroic 2.22.3 release into a throwaway home",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), "revamp-it-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const paths = { ...revampPaths({ HOME: home }), cache: revampPaths().cache };
    const r = await patchApp({ appId: "heroic", bundlePath: BUNDLE, paths, log: (l) => console.log(l) });

    assert.equal(r.exitCode, 0, JSON.stringify(r.results, null, 2));
    assert.deepEqual(
      r.results.map((x) => [x.name, x.status]),
      [
        ["Disable self-update", "applied"],
        ["Side-by-side identity", "applied"],
        ["Hide Deals link", "applied"],
      ],
    );
    const apps = join(paths.data, "apps/heroic");
    assert.equal(readlinkSync(join(apps, "current")), "2.22.3");
    const dir = join(apps, "2.22.3");
    const asar = join(dir, "resources/app.asar");
    assert.equal(statSync(join(dir, "heroic")).mode & 0o111, 0o111);
    assert.ok(existsSync(join(dir, "resources/app.asar.unpacked")));

    assert.equal(JSON.parse(extractFile(asar, "package.json").toString()).desktopName, "revamp-heroic.desktop");
    const sidebar = extractFile(asar, "build/assets/App.js").toString();
    assert.equal(sidebar.includes('"discounts.sidebar"'), false);
    assert.ok(sidebar.includes(']}),null,d.jsx("div",{className:"divider"})'));
    const main = extractFile(asar, "build/main/main.js").toString();
    assert.equal(main.match(/isUpdaterActive\(\) \{\s*return false;\s*\}/g)?.length, 2);

    const desktop = readFileSync(join(paths.applications, "revamp-heroic.desktop"), "utf8");
    assert.match(desktop, /^Name=Heroic Games Launcher \(Revamped\)$/m);
    assert.match(desktop, /^StartupWMClass=revamp-heroic$/m);
    assert.match(desktop, /^Exec=".*\/apps\/heroic\/current\/heroic" %U$/m);
    assert.match(desktop, /^MimeType=x-scheme-handler\/heroic;$/m);
    const icon = /^Icon=(.*)$/m.exec(desktop)![1];
    assert.equal(statSync(icon).size, 260747); // the 1024x1024 PNG, the largest in the .deb
  },
);
