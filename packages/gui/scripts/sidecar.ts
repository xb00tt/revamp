// Links src-tauri/binaries/revamp-<target> to the SEA that `npm run build -w @revamp/cli` writes, as Tauri's externalBin needs.
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Revamp's GUI is built for x86_64 Linux only");
const sea = fileURLToPath(new URL("../../cli/dist/revamp", import.meta.url));
if (!existsSync(sea)) throw new Error(`${sea} is missing: run npm run build -w @revamp/cli first`);
const dir = fileURLToPath(new URL("../src-tauri/binaries/", import.meta.url));
const link = `${dir}revamp-x86_64-unknown-linux-gnu`;
mkdirSync(dir, { recursive: true });
rmSync(link, { force: true });
symlinkSync(sea, link);
console.log(`${link} -> ${sea}`);
