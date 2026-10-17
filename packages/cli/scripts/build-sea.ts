// npm run build -w @revamp-app/cli: esbuild packs the CLI and the sandbox runner into one CommonJS file, and
// `node --build-sea` turns that into the single executable dist/revamp (spec §3.3, §4.4).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

await build({
  entryPoints: [here("src/sea.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node26",
  outfile: here("dist/revamp.cjs"),
  // import.meta.url only feeds the dev-mode paths (the repo's runner.ts and bundle build), which a SEA never takes.
  logOverride: { "empty-import-meta": "silent" },
});
const config = { main: here("dist/revamp.cjs"), output: here("dist/revamp"), disableExperimentalSEAWarning: true, execArgvExtension: "cli" };
writeFileSync(here("dist/sea.json"), JSON.stringify(config, null, 2));
execFileSync(process.execPath, ["--build-sea", here("dist/sea.json")], { stdio: ["ignore", "ignore", "inherit"] });
console.log("dist/revamp written");
