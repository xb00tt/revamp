import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

const shim = (name: string) => fileURLToPath(new URL(`../../../packages/sdk/src/shims/${name}.ts`, import.meta.url));

/** The app's React: extension imports of react and its JSX runtime go to the registry shims. */
const revampExtension: Plugin = {
  name: "revamp-extension",
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: shim("react") }));
    b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: shim("jsx-runtime") }));
    // A stylesheet becomes a <style> element added when the extension loads, so it is one file.
    b.onLoad({ filter: /\.css$/ }, async (args) => ({
      loader: "js",
      contents:
        `const style = document.createElement("style");\n` +
        `style.textContent = ${JSON.stringify(await readFile(args.path, "utf8"))};\n` +
        `document.head.append(style);\n`,
    }));
  },
};

/** Compiles an extension entry (e.g. src/hydra/extension/index.tsx) to one ES module, returned as a string. */
export async function buildExtension(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: false,
    legalComments: "none",
    write: false,
    plugins: [revampExtension],
  });
  return result.outputFiles[0].text;
}

/** Compiles the Steam bridge (runs in Hydra's main process) to one plain script that defines `__revampSteamBridge`. */
export async function buildSteamBridge(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    globalName: "__revampSteamBridge",
    platform: "node",
    target: "es2022",
    minify: false,
    legalComments: "none",
    write: false,
  });
  // esbuild opens with a "use strict" directive; mid-file in Hydra's main it would be a stray statement.
  return result.outputFiles[0].text.replace(/^"use strict";\n/, "");
}
