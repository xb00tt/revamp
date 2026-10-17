import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchApp, revampPaths } from "@revamp-app/engine";
import { formatPatchResult } from "../../packages/cli/src/format.ts";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "an older real Hydra release, forced, reports which patches miss and where (spec §5.6)",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    // 4.0.6 is not in the bundle: --force verifies it against GitHub's published SHA-256 (154 MB, cached once).
    const home = mkdtempSync(join(tmpdir(), "revamp-it-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const paths = { ...revampPaths({ HOME: home }), cache: revampPaths().cache };
    const r = await patchApp({ appId: "hydra", bundlePath: BUNDLE, paths, version: "4.0.6", force: true, dryRun: true, log: (l) => console.log(l) });
    const report = formatPatchResult(r);
    console.log(report);

    assert.equal(r.untested, true);
    assert.equal(r.installed, false);
    assert.equal(r.exitCode, 2);
    assert.match(report, /^Hydra 4\.0\.6 \(untested\): 3\/7 patches apply \(dry run, nothing installed\)$/m);
    const status = Object.fromEntries(r.results.filter((x) => !x.internal).map((x) => [x.name, x.status]));
    assert.deepEqual(status, {
      "Disable self-update": "applied",
      "Side-by-side identity": "applied",
      "Use the bundled UI": "applied",
      "Recently added sort": "failed",
      "Recently downloaded sort": "failed",
      "More like this (Revamped)": "skipped", "More like this (Steam)": "skipped", // 4.0.6 has no stock "More like this" section to mount over
    });
    for (const x of r.results.filter((y) => y.status === "failed")) {
      assert.match(x.message!, /^fingerprint "[^"]+" failed at step "(strings|pattern|regex|where:[^"]+|count)": \S/, x.name);
    }
    assert.deepEqual(readdirSync(join(paths.data, "apps/hydra")), []);
  },
);
