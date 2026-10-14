import { definePatch } from "@revamp/sdk";
import { useBundledUi } from "./bundled-ui.ts";

// scripts/build.ts replaces this name with the compiled extension (src/hydra/extension). Unit tests import the
// source directly, where it is undefined and a placeholder stands in.
declare const __REVAMP_HYDRA_EXTENSION__: string | undefined;

export const HYDRA_EXTENSION =
  typeof __REVAMP_HYDRA_EXTENSION__ === "string" ? __REVAMP_HYDRA_EXTENSION__ : "/* Revamp Hydra extension (not built) */\n";
export const EXTENSION_FILE = "out/renderer/assets/revamp-hydra.js";
const SCRIPT = '<script type="module" crossorigin src="./assets/revamp-hydra.js"></script>';

/**
 * Internal "Hydra extension loader": ships the extension next to the renderer and loads it before Hydra's own
 * module script. Module scripts run in document order, so mount() exists before Hydra's code calls it.
 */
export const hydraExtensionLoader = definePatch({
  description: "Hydra extension loader",
  dependsOn: [useBundledUi], // Hydra loads the bundled index.html only with this patch
  execute(ctx) {
    ctx.addFile(EXTENSION_FILE, HYDRA_EXTENSION);
    const html = ctx.file("out/renderer/index.html");
    const appScript = html.text.indexOf('<script type="module"');
    if (appScript === -1) throw new Error("out/renderer/index.html has no module script to load the extension before");
    const indent = /[ \t]*$/.exec(html.text.slice(0, appScript))![0];
    html.setText(`${html.text.slice(0, appScript)}${SCRIPT}\n${indent}${html.text.slice(appScript)}`);
  },
});
