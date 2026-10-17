import { definePatch, fingerprint } from "@revamp-app/sdk";
import { hydra } from "../apps.ts";

/**
 * Release builds load their UI from https://release-v<version>.hydra-eqi.pages.dev and fall back to the
 * bundled out/renderer/index.html only when that fails. Every renderer patch edits the bundled copy.
 */
export const remoteUi = fingerprint({
  name: "remote UI with local fallback",
  strings: ["../renderer/index.html", "loadURL("],
  pattern: "try { await $W.loadURL($URL); } catch ($E) { $$$; $W.loadFile($$$ARGS); }",
});

export const useBundledUi = definePatch({
  name: "Use the bundled UI",
  description:
    "Loads the UI that ships inside the release (the one Revamp patches) instead of the copy on Hydra's website, which can change without a release.",
  compatibleWith: [{ app: hydra, versions: ["4.1.6"] }],
  execute(ctx) {
    const m = ctx.match(remoteUi);
    m.replace(`${m.$W}.loadFile(${m.$ARGS});`);
  },
});
