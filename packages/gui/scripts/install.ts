// npm run gui:install (spec §9): installs the Revamp window for this user, without root: the binary in
// ~/.local/share/revamp/gui/, its `revamp` sidecar as a link to the installed CLI, the icon, and the menu entry.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revampPaths } from "@revamp-app/engine";
import { installWindow } from "../../cli/src/install.ts";

const gui = fileURLToPath(new URL("../src-tauri/target/release/revamp-gui", import.meta.url));
if (!existsSync(gui)) throw new Error(`${gui} is missing: build it first (npm run tauri:build -w @revamp-app/gui)`);
const icon = fileURLToPath(new URL("../src-tauri/icons/icon.png", import.meta.url));
console.log(`Installed ${installWindow(revampPaths(), { gui, icon })}; "Revamp" is in your applications menu.`);
