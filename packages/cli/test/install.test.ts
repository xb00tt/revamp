import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { onPath, revampPaths } from "@revamp-app/engine";
import { installCli, installWindow } from "../src/install.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
function setup() {
  const home = mkdtempSync(join(tmpdir(), "revamp-install-"));
  const src = join(home, "src");
  return { home, paths: revampPaths({ HOME: home }), src };
}

test("installCli copies the bytes as 0755, links ~/.local/bin/revamp, and a second run replaces cleanly", () => {
  const { home, paths, src } = setup();
  mkdirSync(src, { recursive: true });
  const one = join(src, "one");
  writeFileSync(one, "v1");
  const { bin, link } = installCli(paths, one, home);
  assert.equal(bin, join(paths.data, "bin", "revamp"));
  assert.equal(link, join(home, ".local/bin/revamp"));
  assert.equal(readFileSync(bin, "utf8"), "v1");
  assert.equal(statSync(bin).mode & 0o777, 0o755);
  assert.equal(readlinkSync(link), bin);
  writeFileSync(one, "v2");
  installCli(paths, one, home);
  assert.equal(readFileSync(bin, "utf8"), "v2");
  assert.equal(readlinkSync(link), bin);
  assert.equal(existsSync(`${bin}.new`) || existsSync(`${link}.new`), false);
  installCli(paths, bin, home); // from the installed copy: source == destination
  assert.equal(readFileSync(bin, "utf8"), "v2");
});

test("installWindow copies the window, links the sidecar, copies the icon and writes the desktop entry", () => {
  const { home, paths, src } = setup();
  mkdirSync(src, { recursive: true });
  const cli = join(src, "cli");
  writeFileSync(cli, "cli");
  const { bin } = installCli(paths, cli, home);
  const gui = join(src, "gui");
  const icon = join(src, "icon.png");
  writeFileSync(gui, "gui");
  writeFileSync(icon, "png");
  const installed = installWindow(paths, { gui, icon });
  const dir = join(paths.data, "gui");
  assert.equal(installed, join(dir, "revamp-gui"));
  assert.equal(readFileSync(installed, "utf8"), "gui");
  assert.equal(statSync(installed).mode & 0o777, 0o755);
  assert.equal(readlinkSync(join(dir, "revamp")), bin);
  assert.equal(readFileSync(join(dir, "revamp.png"), "utf8"), "png");
  assert.equal(
    readFileSync(join(paths.applications, "revamp.desktop"), "utf8"),
    `[Desktop Entry]\nType=Application\nName=Revamp\nComment=Patch, update and roll back Revamped apps\nExec="${installed}"\nIcon=${join(dir, "revamp.png")}\nCategories=Utility;\nTerminal=false\n`,
  );
});

test("installWindow throws before writing anything when the CLI isn't installed", () => {
  const { paths, src } = setup();
  mkdirSync(src, { recursive: true });
  const gui = join(src, "gui");
  const icon = join(src, "icon.png");
  writeFileSync(gui, "gui");
  writeFileSync(icon, "png");
  assert.throws(() => installWindow(paths, { gui, icon }), /install the CLI first/);
  assert.equal(existsSync(join(paths.data, "gui")), false);
  assert.equal(existsSync(paths.applications), false);
});

test("revamp self-install from source refuses", () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-install-"));
  const r = spawnSync(process.execPath, [MAIN, "self-install"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "" },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /self-install runs from the release's revamp binary; from the repo use npm run install:cli or npm run gui:install/);
  assert.equal(existsSync(join(home, ".local")), false);
});

test("onPath ignores trailing slashes", () => {
  assert.equal(onPath(["/usr/bin", "/h/.local/bin/"], "/h/.local/bin"), true);
  assert.equal(onPath(["/usr/bin"], "/h/.local/bin"), false);
});
