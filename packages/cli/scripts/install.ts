// npm run install:cli: installs dist/revamp as ~/.local/share/revamp/bin/revamp and points ~/.local/bin/revamp at it (spec §4.5).
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { revampPaths } from "@revamp/engine";

const bin = join(revampPaths().data, "bin", "revamp");
const link = join(process.env.HOME || homedir(), ".local/bin/revamp");

// Each file is written beside its target and renamed over it, so a running `revamp check` keeps its old binary.
mkdirSync(dirname(bin), { recursive: true });
copyFileSync(fileURLToPath(new URL("../dist/revamp", import.meta.url)), `${bin}.new`);
chmodSync(`${bin}.new`, 0o755);
renameSync(`${bin}.new`, bin);
mkdirSync(dirname(link), { recursive: true });
rmSync(`${link}.new`, { force: true });
symlinkSync(bin, `${link}.new`);
renameSync(`${link}.new`, link);
console.log(`Installed ${bin}; ${link} points to it.`);
