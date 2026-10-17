import { addDefaultSource, bundleForApp, DEFAULT_SOURCE, type Paths, type SourceFetchOptions } from "@revamp-app/engine";

/** --bundle, else the first bundle source with the app (spec §7.2). */
export async function bundleFor(paths: Paths, appId: string, flag: string | undefined, warn: (line: string) => void, o: SourceFetchOptions = {}): Promise<string> {
  if (flag) return flag;
  const choice = await bundleForApp(paths, appId, o);
  if (!choice) throw new Error(`no bundle source has "${appId}"; add one, e.g. revamp sources add ${DEFAULT_SOURCE}`);
  for (const w of choice.warnings) warn(`Warning: ${w}`);
  return choice.bundlePath;
}

/** Adds the default source on the first run that needs the sources, and says so; a failure is a warning, not an error. */
export async function seedDefaultSource(paths: Paths, warn: (line: string) => void, o: SourceFetchOptions = {}): Promise<void> {
  try {
    const source = await addDefaultSource(paths, o);
    if (source) warn(`Added the default source ${DEFAULT_SOURCE}: "${source.name}" ${source.version} (sha256 ${source.sha256})`);
  } catch (e) {
    warn(`Warning: couldn't add the default source ${DEFAULT_SOURCE}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
