import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundleJson, changelogFor } from "../scripts/metadata.ts";
import { manifest } from "../src/index.ts";

const md = "# Changelog\n\n## 0.4.0\n\n- New: thing.\n- Fixed: other.\n\n## 0.3.0\n\nOlder.\n";

test("changelogFor returns one version's notes, or nothing", () => {
  assert.equal(changelogFor(md, "0.4.0"), "- New: thing.\n- Fixed: other.");
  assert.equal(changelogFor(md, "0.3.0"), "Older.");
  assert.equal(changelogFor(md, "0.3"), "");
  assert.equal(changelogFor("# Changelog\n", "0.4.0"), "");
});

test("bundleJson points at the release asset of the manifest's GitHub source", () => {
  const sha = "a".repeat(64);
  assert.deepEqual(bundleJson(manifest, sha, "Notes.", new Date("2026-10-15T08:00:00Z")), {
    name: "Revamp official",
    version: manifest.version,
    minEngine: manifest.minEngine,
    created_at: "2026-10-15T08:00:00.000Z",
    changelog: "Notes.",
    download_url: `https://github.com/xb00tt/revamp/releases/download/bundle-v${manifest.version}/official.mjs`,
    sha256: sha,
  });
  assert.throws(() => bundleJson({ ...manifest, source: "https://example.com/x" }, sha, ""), /manifest\.source must be "github:<owner>\/<repo>"/);
});

test("CHANGELOG.md has notes for the bundle's version", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.notEqual(changelogFor(changelog, manifest.version), "", `add a "## ${manifest.version}" section to bundles/official/CHANGELOG.md`);
});
