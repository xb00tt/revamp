// npm run build -w @revamp-app/bundle-official: the extensions first, then the bundle with each one embedded as a string,
// then patches.json and bundle.json (spec §7.1).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe } from "@revamp-app/engine";
import { buildExtension, buildSteamBridge } from "./extension.ts";
import { bundleJson, changelogFor } from "./metadata.ts";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const hydraExtension = await buildExtension(here("src/hydra/extension/index.tsx"));
const steamBridge = await buildSteamBridge(here("src/hydra/steam-bridge/main.ts"));
const out = here("dist/official.mjs");
await build({
  entryPoints: [here("src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2024",
  outfile: out,
  define: {
    __REVAMP_HYDRA_EXTENSION__: JSON.stringify(hydraExtension),
    __REVAMP_HYDRA_STEAM_BRIDGE__: JSON.stringify(steamBridge),
  },
});
// describe runs the built bundle in the sandbox, like every engine read of a bundle.
const description = await describe(out);
writeFileSync(here("dist/patches.json"), json(description));
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
const changelog = changelogFor(readFileSync(here("CHANGELOG.md"), "utf8"), description.manifest.version);
writeFileSync(here("dist/bundle.json"), json(bundleJson(description.manifest, sha256, changelog)));
console.log(`dist/official.mjs, patches.json and bundle.json written (bundle ${description.manifest.version}, Hydra extension: ${(hydraExtension.length / 1024).toFixed(1)} kB)`);
