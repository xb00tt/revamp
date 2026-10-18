import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION } from "../packages/engine/src/version.ts";
import { changelogSection, releaseAssetName, releaseDirName, releaseReadme, sha256sumsLine } from "../scripts/release-app-files.ts";

test("asset and directory names", () => {
  assert.equal(releaseAssetName("1.0.0"), "revamp-1.0.0-linux-x86_64.tar.gz");
  assert.equal(releaseDirName("1.0.0"), "revamp-1.0.0-linux-x86_64");
});

test("changelogSection picks its section, stops at the next heading, and names a missing one", () => {
  const log = "# Changelog\n\nintro\n\n## 1.1.0\n\nNewer.\n\n- b\n\n## 1.0.0\n\nFirst.\n\n- a\n\n## 0.9.0\n\nOld.\n";
  assert.equal(changelogSection(log, "1.0.0"), "First.\n\n- a");
  assert.equal(changelogSection(log, "1.1.0"), "Newer.\n\n- b");
  assert.throws(() => changelogSection(log, "2.0.0"), { message: 'add a "## 2.0.0" section to CHANGELOG.md' });
});

test("sha256sumsLine is sha256sum -c format", () => {
  assert.equal(sha256sumsLine("ab12", "x.tar.gz"), "ab12  x.tar.gz\n");
});

test("releaseReadme names the install command and the version", () => {
  const text = releaseReadme("1.0.0");
  assert.match(text, /^Revamp 1\.0\.0 for Linux x86_64\n/);
  assert.match(text, /\.\/revamp self-install/);
});

test("the real CHANGELOG.md has a section for ENGINE_VERSION", () => {
  const log = readFileSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)), "utf8");
  assert.ok(changelogSection(log, ENGINE_VERSION).length > 0);
});
