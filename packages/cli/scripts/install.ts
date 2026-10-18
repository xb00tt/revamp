// npm run install:cli: installs dist/revamp as ~/.local/share/revamp/bin/revamp and points ~/.local/bin/revamp at it (spec §4.5).
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { revampPaths } from "@revamp-app/engine";
import { installCli } from "../src/install.ts";

const { bin, link } = installCli(revampPaths(), fileURLToPath(new URL("../dist/revamp", import.meta.url)), process.env.HOME || homedir());
console.log(`Installed ${bin}; ${link} points to it.`);
