// npm run gui:install (spec §9): installs the Revamp window for this user, without root: the binary in
// ~/.local/share/revamp/gui/, its `revamp` sidecar as a link to the installed CLI, the icon, and the menu entry.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { revampPaths } from "@revamp/engine";

const paths = revampPaths();
const cli = join(paths.data, "bin", "revamp");
if (!existsSync(cli)) throw new Error(`${cli} is missing: install the CLI first (npm run install:cli)`);
const built = fileURLToPath(new URL("../src-tauri/target/release/revamp-gui", import.meta.url));
if (!existsSync(built)) throw new Error(`${built} is missing: build it first (npm run tauri:build -w @revamp/gui)`);

const dir = join(paths.data, "gui");
const gui = join(dir, "revamp-gui");
const replace = (target: string, write: (tmp: string) => void) => {
  rmSync(`${target}.new`, { force: true });
  write(`${target}.new`);
  renameSync(`${target}.new`, target); // a running window keeps its old binary
};
mkdirSync(dir, { recursive: true });
replace(gui, (tmp) => (copyFileSync(built, tmp), chmodSync(tmp, 0o755)));
// The window starts its sidecar from beside itself. A link to the installed CLI keeps one revamp: the one the timer runs.
replace(join(dir, "revamp"), (tmp) => symlinkSync(cli, tmp));
replace(join(dir, "revamp.png"), (tmp) => copyFileSync(fileURLToPath(new URL("../src-tauri/icons/icon.png", import.meta.url)), tmp));

mkdirSync(paths.applications, { recursive: true });
const entry = [
  "[Desktop Entry]",
  "Type=Application",
  "Name=Revamp",
  "Comment=Patch, update and roll back Revamped apps",
  `Exec="${gui}"`,
  `Icon=${join(dir, "revamp.png")}`,
  "Categories=Utility;",
  "Terminal=false",
  "",
].join("\n");
replace(join(paths.applications, "revamp.desktop"), (tmp) => writeFileSync(tmp, entry));
spawnSync("update-desktop-database", [paths.applications], { stdio: "ignore" }); // optional tool
console.log(`Installed ${gui}; "Revamp" is in your applications menu.`);
