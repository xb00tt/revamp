import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions } from "../src/version.ts";
import { assertSafeName, revampPaths } from "../src/paths.ts";
import { parseDesktopEntry, serializeDesktopEntry } from "../src/desktop.ts";
import { loadSelection, mergeSelection, saveSelection } from "../src/config.ts";

test("revampPaths follows absolute XDG variables and ignores relative ones", () => {
  assert.deepEqual(revampPaths({ HOME: "/home/u", XDG_DATA_HOME: "/d", XDG_CONFIG_HOME: "rel/ignored" }), {
    data: "/d/revamp",
    config: "/home/u/.config/revamp",
    cache: "/home/u/.cache/revamp",
    state: "/home/u/.local/state/revamp",
    applications: "/d/applications",
  });
});

test("assertSafeName rejects path tricks", () => {
  assert.equal(assertSafeName("version", "4.1.6"), "4.1.6");
  for (const bad of ["..", "../x", "a/b", ".hidden", "", "a..b", "x\0"]) {
    assert.throws(() => assertSafeName("version", bad), /unsafe version/);
  }
});

test("compareVersions orders dotted numbers", () => {
  assert.equal(compareVersions("4.1.10", "4.1.9"), 1);
  assert.equal(compareVersions("4.1.6", "4.1.6"), 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
});

test("desktop entries round-trip the [Desktop Entry] group only", () => {
  const text = "[Desktop Entry]\nName=Hydra\nExec=/opt/Hydra/hydralauncher %U\n# comment\nMimeType=x-scheme-handler/hydralauncher;\n\n[Desktop Action new]\nName=Other\n";
  const entry = parseDesktopEntry(text);
  assert.deepEqual(entry, { Name: "Hydra", Exec: "/opt/Hydra/hydralauncher %U", MimeType: "x-scheme-handler/hydralauncher;" });
  assert.equal(serializeDesktopEntry({ Name: "A\nExec=evil", Type: "Application" }), "[Desktop Entry]\nName=A Exec=evil\nType=Application\n");
  assert.throws(() => serializeDesktopEntry({ "Bad\nKey": "x" }), /invalid desktop entry key/);
});

test("selections load empty, save, and merge flags", () => {
  const paths = revampPaths({ HOME: mkdtempSync(join(tmpdir(), "revamp-")) });
  assert.deepEqual(loadSelection(paths, "hydra"), { enable: [], disable: [], options: {} });
  const merged = mergeSelection({ enable: ["A"], disable: ["B"], options: { A: { x: 1 } } }, { enable: ["B"], disable: ["A"] });
  assert.deepEqual(merged, { enable: ["B"], disable: ["A"], options: { A: { x: 1 } } });
  saveSelection(paths, "hydra", merged);
  assert.deepEqual(loadSelection(paths, "hydra"), merged);
});
