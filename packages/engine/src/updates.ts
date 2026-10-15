// revamp check and revamp update (spec §7.3): the newest GitHub release of each installed app, dry-run or installed.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, findApp, fitsVersion, patchApp, patchCounts, type PatchAppOptions, type PatchAppResult } from "./api.ts";
import { bundleForApp, refreshSources, type BundleSource, type SourceFetchOptions } from "./bundle-sources.ts";
import { loadSelection } from "./config.ts";
import { listInstalls, type InstalledApp } from "./install.ts";
import { patchesForApp, type AppInfo, type BundleDescription } from "./job.ts";
import type { Paths } from "./paths.ts";
import { compareVersions, ENGINE_VERSION } from "./version.ts";

export interface UpdateOptions extends SourceFetchOptions {
  paths: Paths;
  /** Tests point this at a local server; defaults to https://github.com. */
  releaseBaseUrl?: string;
  log?: (line: string) => void;
  /** Structured progress of the patch jobs a check or update runs (the GUI draws it). */
  progress?: PatchAppOptions["progress"];
}

export interface AppCheck {
  appId: string;
  /** The bundle's name for the app, or its id when the check failed before reading the bundle. */
  appName: string;
  current: string;
  /** The newest GitHub release, when the check got that far. */
  latest?: string;
  /**
   * update: a newer release is out. patches: no newer release, but the app's source now has a different bundle than
   * the one `current` was patched with (re-patch to use it). skipped: the newer release is the one the user skipped.
   */
  status: "up to date" | "update" | "patches" | "skipped" | "failed";
  /** For "patches": the source's bundle now, and the patches it adds that the saved selection would turn on. */
  bundle?: { name: string; version: string; changelog?: string };
  newPatches?: string[];
  /** The bundle lists the newest release as a stable version. */
  listed?: boolean;
  /** The bundle lists the newest release, but as experimental. */
  experimental?: boolean;
  /** The dry run of the newest release with the saved selection. */
  applied?: number;
  total?: number;
  failing?: string[];
  aborted?: string;
  error?: string;
  /** What the dry run depended on; the next check reuses its result while this stays the same. */
  basis?: string;
}

export interface CheckResult {
  checkedAt: string;
  /** What refreshing the sources changed or couldn't do. */
  sources: string[];
  apps: AppCheck[];
}

/** The version in a release tag, by the app's tag template ("v{version}"). */
function versionFromTag(template: string, tag: string): string | undefined {
  const [before, after = ""] = template.split("{version}");
  const fits = tag.length > before.length + after.length && tag.startsWith(before) && tag.endsWith(after);
  return fits ? tag.slice(before.length, tag.length - after.length) : undefined;
}

export interface LatestRelease {
  version: string;
  /** Each asset's name and the digest GitHub publishes for it, so a check notices a download swapped on GitHub. */
  assets: string[];
}

export async function latestRelease(app: AppInfo, o: Pick<UpdateOptions, "apiBaseUrl" | "fetch"> = {}): Promise<LatestRelease> {
  const url = `${o.apiBaseUrl ?? "https://api.github.com"}/repos/${app.release.github}/releases/latest`;
  const res = await (o.fetch ?? fetch)(url, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  const release = (await res.json().catch(() => undefined)) as { tag_name?: unknown; assets?: unknown } | undefined;
  const tag = release?.tag_name;
  const version = typeof tag === "string" ? versionFromTag(app.release.tag, tag) : undefined;
  if (!version) throw new Error(`the latest ${app.name} release on GitHub has tag ${JSON.stringify(tag)}, which doesn't fit "${app.release.tag}"`);
  const assets = Array.isArray(release?.assets) ? (release.assets as Array<{ name?: unknown; digest?: unknown } | null>).map((a) => `${a?.name} ${a?.digest}`).sort() : [];
  return { version, assets };
}

/** An installed app's bundle (from the sources) and its newest release. */
async function newest(appId: string, o: UpdateOptions) {
  const choice = await bundleForApp(o.paths, appId, o);
  if (!choice) throw new Error(`no bundle source has "${appId}"; add one, e.g. revamp sources add xb00tt/revamp`);
  for (const w of choice.warnings) o.log?.(`Warning: ${w}`);
  const description = await describe(choice.bundlePath);
  const app = findApp(description, appId);
  const release = await latestRelease(app, o);
  return { bundlePath: choice.bundlePath, source: choice.source, description, app, latest: release.version, assets: release.assets };
}

const receiptOf = (installed: InstalledApp) => installed.versions.find((v) => v.version === installed.current)?.receipt;

/** Patches the source's bundle offers for the installed version that it wasn't patched with and the saved selection turns on. */
function newPatches(paths: Paths, installed: InstalledApp, description: BundleDescription): string[] {
  const had = new Set(receiptOf(installed)?.patches.map((r) => r.name));
  const { enable, disable } = loadSelection(paths, installed.appId);
  return patchesForApp(description.patches, installed.appId)
    .filter((p) => fitsVersion(p, installed.appId, installed.current!) && !had.has(p.name) && !disable.includes(p.name) && (p.default || enable.includes(p.name)))
    .map((p) => p.name);
}

const skipFile = (paths: Paths) => join(paths.state, "skipped.json");

/** The release each app's user chose to skip: checks stay quiet about it until a newer one is out. */
export function loadSkipped(paths: Paths): Record<string, string> {
  return existsSync(skipFile(paths)) ? (JSON.parse(readFileSync(skipFile(paths), "utf8")) as Record<string, string>) : {};
}

/** Skips `version` of the app, or with null forgets the skip. */
export function skipVersion(paths: Paths, appId: string, version: string | null): void {
  const skipped = loadSkipped(paths);
  if (version === null) delete skipped[appId];
  else skipped[appId] = version;
  mkdirSync(paths.state, { recursive: true });
  writeFileSync(`${skipFile(paths)}.tmp`, `${JSON.stringify(skipped, null, 2)}\n`);
  renameSync(`${skipFile(paths)}.tmp`, skipFile(paths));
}

/** The install came from another bundle than the one its source pins now. */
const bundleChanged = (installed: InstalledApp, source: BundleSource) => receiptOf(installed)?.bundle.sha256 !== source.sha256;

const isStable = (app: AppInfo, version: string) => Object.hasOwn(app.versions, version) && !app.versions[version].experimental;

const lastCheckFile = (paths: Paths) => join(paths.state, "last-check.json");

/** The last check's result, or null when there is none or the file can't be read (the next check rewrites it). */
export function loadLastCheck(paths: Paths): CheckResult | null {
  try {
    return existsSync(lastCheckFile(paths)) ? (JSON.parse(readFileSync(lastCheckFile(paths), "utf8")) as CheckResult) : null;
  } catch {
    return null;
  }
}

/**
 * Refreshes the sources, then for each installed app looks up its newest release and, if it is newer than
 * `current`, downloads, verifies and dry-runs it with the saved selection. A dry run whose basis (engine, release and
 * GitHub's digests for it, bundle and selection) is unchanged since the last check is reused rather than run again. The result goes to
 * last-check.json.
 */
export async function checkUpdates(o: UpdateOptions): Promise<CheckResult> {
  const sources = await refreshSources(o.paths, o);
  const skipped = loadSkipped(o.paths);
  const previous = loadLastCheck(o.paths);
  const apps: AppCheck[] = [];
  for (const installed of listInstalls(o.paths)) {
    if (!installed.current) continue;
    o.log?.(`Checking ${installed.appId} ${installed.current}…`);
    const check: AppCheck = { appId: installed.appId, appName: installed.appId, current: installed.current, status: "failed" };
    try {
      const { bundlePath, source, description, app, latest, assets } = await newest(installed.appId, o);
      const listed = isStable(app, latest);
      const experimental = Object.hasOwn(app.versions, latest) && !listed;
      Object.assign(check, { appName: app.name, latest, listed, ...(experimental && { experimental }), status: "up to date" });
      if (compareVersions(latest, installed.current) > 0) {
        const basis = JSON.stringify([ENGINE_VERSION, latest, assets, source.sha256, loadSelection(o.paths, app.id)]);
        const before = previous?.apps.find((a) => a.appId === app.id && a.status === "update" && a.basis === basis);
        if (skipped[app.id] === latest) check.status = "skipped";
        else if (before) {
          o.log?.(`${app.name} ${latest}: nothing changed since the last dry run, so it isn't run again.`);
          Object.assign(check, { status: "update", applied: before.applied, total: before.total, failing: before.failing, aborted: before.aborted, basis });
        } else {
          const r = await patchApp({ ...o, appId: app.id, bundlePath, version: latest, force: !listed, dryRun: true });
          Object.assign(check, { status: "update", ...patchCounts(r.results), aborted: r.aborted, basis });
        }
      } else if (bundleChanged(installed, source)) {
        const { name, version } = description.manifest;
        Object.assign(check, { status: "patches", bundle: { name, version, ...(source.changelog && { changelog: source.changelog }) }, newPatches: newPatches(o.paths, installed, description) });
      }
    } catch (e) {
      check.error = e instanceof Error ? e.message : String(e);
    }
    apps.push(check);
  }
  const result = { checkedAt: new Date().toISOString(), sources, apps };
  mkdirSync(o.paths.state, { recursive: true });
  const file = lastCheckFile(o.paths);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return result;
}

/** The line `revamp check` prints and notify-send shows. */
export function checkMessage(c: AppCheck): string {
  if (c.status === "failed") return `Couldn't check ${c.appName}: ${c.error}`;
  if (c.status === "up to date") return `${c.appName} ${c.current} is up to date`;
  if (c.status === "patches") {
    const about = `${c.appName} ${c.current}: ${c.bundle!.name} ${c.bundle!.version}`;
    return c.newPatches?.length ? `${about} has new patches for it (${c.newPatches.join(", ")}); re-patch to apply them` : `${about} is out; re-patch to use it`;
  }
  if (c.status === "skipped") return `${c.appName} ${c.latest} out (skipped)`;
  const out = `${c.appName} ${c.latest} out`;
  if (c.aborted) return `${out}, but its patch job fails: ${c.aborted}`;
  const counts = `${c.applied}/${c.total}`;
  if (c.experimental) return `${out}, experimental in your bundles (${counts} patches apply)`;
  if (!c.listed) return `${out}, not yet in your bundles (untested: ${counts} patches apply)`;
  if (!c.failing?.length) return `${out}, ${counts} patches apply`;
  return `${out}, ${counts} apply: ${c.failing.join(", ")} ${c.failing.length === 1 ? "fails" : "fail"}`;
}

export interface AppUpdate {
  appId: string;
  appName: string;
  current: string;
  latest: string;
  /** Absent when `current` is the newest release and was patched with the source's current bundle. */
  result?: PatchAppResult;
}

/**
 * Installs an installed app's newest release with its saved selection (spec §7.3), or, when there is none, re-patches
 * `current` if its source now has a different bundle. A version the bundle doesn't list, or lists as experimental, needs
 * `force`; re-patching an untested install keeps it forced.
 */
export async function updateApp(appId: string, o: UpdateOptions & { force?: boolean }): Promise<AppUpdate> {
  const installed = listInstalls(o.paths).find((a) => a.appId === appId);
  const current = installed?.current;
  if (!installed || !current) throw new Error(`${appId} is not installed; install it with revamp patch ${appId}`);
  await refreshSources(o.paths, o).then((lines) => lines.forEach((l) => o.log?.(l)));
  const { bundlePath, source, app, latest } = await newest(appId, o);
  const update = { appId, appName: app.name, current, latest };
  if (compareVersions(latest, current) > 0) return { ...update, result: await patchApp({ ...o, appId: app.id, bundlePath, version: latest }) };
  if (!bundleChanged(installed, source)) return update;
  const force = o.force || receiptOf(installed)?.release.untested;
  return { ...update, result: await patchApp({ ...o, appId: app.id, bundlePath, version: current, force }) };
}
