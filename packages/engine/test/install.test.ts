import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDesktopEntry } from "../src/desktop.ts";
import {
  environmentWarnings,
  ICON_FILE,
  installStaged,
  listInstalls,
  newStaging,
  rollback,
  uninstall,
  type Receipt,
} from "../src/install.ts";
import { revampPaths, type Paths } from "../src/paths.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "revamp-inst-"));
const newPaths = (home = join(tmp(), "home")) => revampPaths({ HOME: home });
const receipt = (version: string, installedAt: string): Receipt => ({
  app: "demo",
  version,
  release: { asset: "demo.deb", sha256: "a".repeat(64) },
  bundle: { name: "b", version: "1", sha256: "b".repeat(64) },
  patches: [],
  selection: { enable: [], disable: [], options: {} },
  installedAt,
});

function install(p: Paths, version: string, installedAt: string, marker = version) {
  const staging = newStaging(p, "demo");
  writeFileSync(join(staging, "demo"), marker);
  writeFileSync(join(staging, ICON_FILE), "png");
  return installStaged({
    paths: p,
    appId: "demo",
    version,
    executable: "demo",
    staging,
    receipt: receipt(version, installedAt),
    desktopEntry: { Name: "Demo (Revamped)", Exec: "/opt/Demo/demo %U", Icon: "demo", StartupWMClass: "revamp-demo" },
  });
}
const root = (p: Paths) => join(p.data, "apps/demo");

test("installs the version, points current at it and writes the menu entry", () => {
  const p = newPaths();
  const dir = install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  assert.equal(dir, join(root(p), "1.0.0"));
  assert.equal(readlinkSync(join(root(p), "current")), "1.0.0");
  assert.deepEqual(readdirSync(root(p)).sort(), ["1.0.0", "current"]);
  assert.equal(JSON.parse(readFileSync(join(dir, "revamp.json"), "utf8")).version, "1.0.0");
  const entry = parseDesktopEntry(readFileSync(join(p.applications, "revamp-demo.desktop"), "utf8"));
  const current = join(root(p), "current");
  assert.equal(entry.Exec, `"${join(current, "demo")}" %U`);
  assert.equal(entry.Icon, join(current, ICON_FILE));
  assert.equal(entry.Name, "Demo (Revamped)");
  assert.equal(entry.StartupWMClass, "revamp-demo");
});

test("keeps only current plus the previous version", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  install(p, "1.1.0", "2026-10-14T11:00:00.000Z");
  install(p, "1.2.0", "2026-10-14T12:00:00.000Z");
  assert.deepEqual(readdirSync(root(p)).sort(), ["1.1.0", "1.2.0", "current"]);
  assert.equal(readlinkSync(join(root(p), "current")), "1.2.0");
});

test("re-patching the current version replaces it in place", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  install(p, "1.1.0", "2026-10-14T11:00:00.000Z", "old build");
  install(p, "1.1.0", "2026-10-14T12:00:00.000Z", "new build");
  assert.deepEqual(readdirSync(root(p)).sort(), ["1.0.0", "1.1.0", "current"]);
  assert.equal(readFileSync(join(root(p), "current/demo"), "utf8"), "new build");
});

test("rollback switches current to the other kept version", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  assert.throws(() => rollback(p, "demo"), /no previous version/);
  install(p, "1.1.0", "2026-10-14T11:00:00.000Z");
  assert.equal(rollback(p, "demo"), "1.0.0");
  assert.equal(readlinkSync(join(root(p), "current")), "1.0.0");
  assert.equal(rollback(p, "demo"), "1.1.0");
});

test("listInstalls and uninstall", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  const [demo] = listInstalls(p);
  assert.equal(demo.appId, "demo");
  assert.equal(demo.current, "1.0.0");
  assert.deepEqual(demo.versions.map((v) => v.version), ["1.0.0"]);
  uninstall(p, "demo");
  assert.equal(existsSync(root(p)), false);
  assert.equal(existsSync(join(p.applications, "revamp-demo.desktop")), false);
  assert.deepEqual(listInstalls(p), []);
  assert.throws(() => uninstall(p, "demo"), /not installed/);
});

test("the receipt write never follows a symlink planted in the app tree", () => {
  const p = newPaths();
  const staging = newStaging(p, "demo");
  writeFileSync(join(staging, "demo"), "binary");
  symlinkSync("demo", join(staging, "revamp.json"));
  installStaged({ paths: p, appId: "demo", version: "1.0.0", executable: "demo", staging, receipt: receipt("1.0.0", "2026-10-14T10:00:00.000Z"), desktopEntry: { Name: "Demo" } });
  assert.equal(readFileSync(join(root(p), "1.0.0/demo"), "utf8"), "binary");
  assert.equal(lstatSync(join(root(p), "1.0.0/revamp.json")).isFile(), true);
});

test("refuses install paths a desktop Exec line can't hold", () => {
  const p = newPaths(join(tmp(), "we$ird"));
  assert.throws(() => install(p, "1.0.0", "2026-10-14T10:00:00.000Z"), /can't hold/);
  assert.equal(existsSync(join(root(p), "1.0.0")), false);
});

test("the userns warning appears only when the sysctl is 1", () => {
  const f = join(tmp(), "sysctl");
  writeFileSync(f, "1\n");
  assert.equal(environmentWarnings("Demo", f).length, 2);
  writeFileSync(f, "0\n");
  assert.equal(environmentWarnings("Demo", f).length, 1);
  assert.match(environmentWarnings("Demo", join(tmp(), "missing"))[0], /only one of them can run at a time/);
});
