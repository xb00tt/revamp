// What Revamp keeps on disk, and what can go: release downloads, cached bundles and installed versions.
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSources } from "./bundle-sources.ts";
import { listInstalls, lockApp } from "./install.ts";
import { appDir, type Paths } from "./paths.ts";

export interface StorageItem {
  /** "release:<app>/<version>", "bundle:<sha256>" or "install:<app>/<version>". */
  id: string;
  kind: "release" | "bundle" | "install";
  label: string;
  bytes: number;
  /**
   * Why Revamp keeps it; absent when it can be removed. Downloads of installed versions are kept to re-patch them,
   * pinned bundles are what the sources point at, and each app's current install is the one that runs.
   */
  keep?: "installed" | "pinned" | "current";
}

/** Bytes on disk under `path`, without following symlinks. */
function size(path: string): number {
  const s = lstatSync(path);
  return s.isDirectory() ? readdirSync(path).reduce((total, name) => total + size(join(path, name)), 0) : s.size;
}

const dirs = (path: string) => (existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name) : []);

export function storageUsage(paths: Paths): StorageItem[] {
  const installs = listInstalls(paths);
  const installed = (app: string, version: string) => installs.some((a) => a.appId === app && a.versions.some((v) => v.version === version));
  const items: StorageItem[] = [];
  const releases = join(paths.cache, "releases");
  for (const app of dirs(releases)) {
    for (const version of dirs(join(releases, app))) {
      items.push({ id: `release:${app}/${version}`, kind: "release", label: `${app} ${version}`, bytes: size(join(releases, app, version)), ...(installed(app, version) && { keep: "installed" as const }) });
    }
  }
  const sources = loadSources(paths);
  const bundles = join(paths.cache, "bundles");
  for (const file of existsSync(bundles) ? readdirSync(bundles).filter((f) => /^[0-9a-f]{64}\.mjs$/.test(f)) : []) {
    const sha = file.slice(0, 64);
    const source = sources.find((s) => s.sha256 === sha);
    items.push({ id: `bundle:${sha}`, kind: "bundle", label: source ? `${source.name} ${source.version}` : `bundle ${sha.slice(0, 12)}`, bytes: size(join(bundles, file)), ...(source && { keep: "pinned" as const }) });
  }
  for (const app of installs) {
    for (const { version } of app.versions) {
      items.push({ id: `install:${app.appId}/${version}`, kind: "install", label: `${app.appId} ${version}`, bytes: size(join(appDir(paths, app.appId), version)), ...(version === app.current && { keep: "current" as const }) });
    }
  }
  return items;
}

/** Removes one item `storageUsage` lists without a `keep` reason; anything else is refused. */
export function removeStorageItem(paths: Paths, id: string): void {
  const item = storageUsage(paths).find((i) => i.id === id);
  if (!item) throw new Error(`nothing called "${id}" in Revamp's storage`);
  if (item.keep) throw new Error(`${item.label} is in use (${item.keep}), so it stays`);
  const [kind, rest] = [item.kind, id.slice(item.kind.length + 1)];
  if (kind === "release") rmSync(join(paths.cache, "releases", ...rest.split("/")), { recursive: true, force: true });
  else if (kind === "bundle") rmSync(join(paths.cache, "bundles", `${rest}.mjs`), { force: true });
  else {
    const [app, version] = rest.split("/");
    const unlock = lockApp(paths, app); // never under a running job for the same app
    try {
      rmSync(join(appDir(paths, app), version), { recursive: true, force: true });
    } finally {
      unlock();
    }
  }
}
