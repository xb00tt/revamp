// The one install path (spec §4.5, §9): `npm run install:cli`, `npm run gui:install` and `revamp self-install` all call these.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Paths } from "@revamp-app/engine";

/** Desktop Entry spec: inside a quoted Exec argument, escape \ " ` $ with a backslash and double every %. */
export const execArg = (p: string) => `"${p.replace(/[\\"`$]/g, "\\$&").replace(/%/g, "%%")}"`;

// Each file is written beside its target and renamed over it, so a running revamp or window keeps its old binary.
const replace = (target: string, write: (tmp: string) => void) => {
  rmSync(`${target}.new`, { force: true });
  write(`${target}.new`);
  renameSync(`${target}.new`, target);
};

/** Copies `source` to <paths.data>/bin/revamp (0755) and points <home>/.local/bin/revamp at it. */
export function installCli(paths: Paths, source: string, home: string): { bin: string; link: string } {
  const bin = join(paths.data, "bin", "revamp");
  const link = join(home, ".local/bin/revamp");
  mkdirSync(dirname(bin), { recursive: true });
  // Installing the installed copy onto itself (self-install from ~/.local/share/revamp/bin) must not delete its own source.
  if (source !== bin) replace(bin, (tmp) => (copyFileSync(source, tmp), chmodSync(tmp, 0o755)));
  mkdirSync(dirname(link), { recursive: true });
  replace(link, (tmp) => symlinkSync(bin, tmp));
  return { bin, link };
}

/** Installs the window: its binary, a `revamp` sidecar link to the installed CLI, the icon and the menu entry. */
export function installWindow(paths: Paths, files: { gui: string; icon: string }): string {
  const cli = join(paths.data, "bin", "revamp");
  if (!existsSync(cli)) throw new Error(`${cli} is missing: install the CLI first (npm run install:cli)`);
  if (!existsSync(files.gui)) throw new Error(`${files.gui} is missing: build it first (npm run tauri:build -w @revamp-app/gui)`);
  if (!existsSync(files.icon)) throw new Error(`${files.icon} is missing`); // checked before anything is written: no half install
  const dir = join(paths.data, "gui");
  const gui = join(dir, "revamp-gui");
  mkdirSync(dir, { recursive: true });
  if (files.gui !== gui) replace(gui, (tmp) => (copyFileSync(files.gui, tmp), chmodSync(tmp, 0o755)));
  // The window starts its sidecar from beside itself. A link to the installed CLI keeps one revamp: the one the timer runs.
  replace(join(dir, "revamp"), (tmp) => symlinkSync(cli, tmp));
  replace(join(dir, "revamp.png"), (tmp) => copyFileSync(files.icon, tmp));
  mkdirSync(paths.applications, { recursive: true });
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Revamp",
    "Comment=Patch, update and roll back Revamped apps",
    `Exec=${execArg(gui)}`,
    `Icon=${join(dir, "revamp.png")}`,
    "Categories=Utility;",
    "Terminal=false",
    "",
  ].join("\n");
  replace(join(paths.applications, "revamp.desktop"), (tmp) => writeFileSync(tmp, entry));
  spawnSync("update-desktop-database", [paths.applications], { stdio: "ignore" }); // optional tool
  return gui;
}

/** Whether `dir` is one of the PATH entries, ignoring trailing slashes. */
export const onPath = (entries: string[], dir: string) => entries.some((e) => e.replace(/\/+$/, "") === dir.replace(/\/+$/, ""));
