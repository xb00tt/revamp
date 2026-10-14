import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface Paths {
  data: string;
  config: string;
  cache: string;
  state: string;
  /** XDG applications dir for .desktop files (not under revamp/). */
  applications: string;
}

export function revampPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.HOME || homedir();
  // XDG spec: relative values are invalid and must be ignored.
  const xdg = (name: string, fallback: string) => {
    const v = env[name];
    return v && isAbsolute(v) ? v : join(home, fallback);
  };
  const data = xdg("XDG_DATA_HOME", ".local/share");
  return {
    data: join(data, "revamp"),
    config: join(xdg("XDG_CONFIG_HOME", ".config"), "revamp"),
    cache: join(xdg("XDG_CACHE_HOME", ".cache"), "revamp"),
    state: join(xdg("XDG_STATE_HOME", ".local/state"), "revamp"),
    applications: join(data, "applications"),
  };
}

export const appDir = (p: Paths, appId: string) => join(p.data, "apps", assertSafeName("app id", appId));

export const releasePath = (p: Paths, appId: string, version: string, asset: string) =>
  join(p.cache, "releases", assertSafeName("app id", appId), assertSafeName("version", version), assertSafeName("asset", asset));

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** Guards names that come from bundles before they become path segments. */
export function assertSafeName(kind: string, value: string): string {
  if (!SAFE_NAME.test(value) || value.includes("..")) throw new Error(`unsafe ${kind} "${value}"`);
  return value;
}

/** Guards bundle-supplied relative paths, such as an app's executable: safe names joined by "/". */
export function assertSafeRelativePath(kind: string, value: string): string {
  if (!value.split("/").every((part) => SAFE_NAME.test(part) && !part.includes(".."))) throw new Error(`unsafe ${kind} "${value}"`);
  return value;
}
