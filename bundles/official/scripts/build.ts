// npm run build -w @revamp/bundle-official: the extensions first, then the bundle with each one embedded as a string.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildExtension } from "./extension.ts";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const hydraExtension = await buildExtension(here("src/hydra/extension/index.tsx"));
await build({
  entryPoints: [here("src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2024",
  outfile: here("dist/official.mjs"),
  define: { __REVAMP_HYDRA_EXTENSION__: JSON.stringify(hydraExtension) },
});
console.log(`dist/official.mjs written (Hydra extension: ${(hydraExtension.length / 1024).toFixed(1)} kB)`);
