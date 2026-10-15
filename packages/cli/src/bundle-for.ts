import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import { bundleForApp, type Paths, type SourceFetchOptions } from "@revamp/engine";

/** --bundle, else the first bundle source with the app (spec §7.2), else, running from the repo, the repo build. */
export async function bundleFor(paths: Paths, appId: string, flag: string | undefined, warn: (line: string) => void, o: SourceFetchOptions = {}): Promise<string> {
  if (flag) return flag;
  const choice = await bundleForApp(paths, appId, o);
  if (choice) {
    for (const w of choice.warnings) warn(`Warning: ${w}`);
    return choice.bundlePath;
  }
  if (!isSea()) return fileURLToPath(new URL("../../../bundles/official/dist/official.mjs", import.meta.url));
  throw new Error(`no bundle source has "${appId}"; add one, e.g. revamp sources add xb00tt/revamp`);
}
