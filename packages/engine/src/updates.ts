// revamp check and revamp update (spec §7.3): the newest GitHub release of each installed app, dry-run or installed.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, findApp, patchApp, patchCounts, type PatchAppResult } from "./api.ts";
import { bundleForApp, refreshSources, type SourceFetchOptions } from "./bundle-sources.ts";
import { listInstalls } from "./install.ts";
import type { AppInfo } from "./job.ts";
import type { Paths } from "./paths.ts";
import { compareVersions } from "./version.ts";

export interface UpdateOptions extends SourceFetchOptions {
  paths: Paths;
  /** Tests point this at a local server; defaults to https://github.com. */
  releaseBaseUrl?: string;
  log?: (line: string) => void;
}

export interface AppCheck {
  appId: string;
  /** The bundle's name for the app, or its id when the check failed before reading the bundle. */
  appName: string;
  current: string;
  /** The newest GitHub release, when the check got that far. */
  latest?: string;
  status: "up to date" | "update" | "failed";
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

export async function latestRelease(app: AppInfo, o: Pick<UpdateOptions, "apiBaseUrl" | "fetch"> = {}): Promise<string> {
  const url = `${o.apiBaseUrl ?? "https://api.github.com"}/repos/${app.release.github}/releases/latest`;
  const res = await (o.fetch ?? fetch)(url, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  const tag = ((await res.json().catch(() => undefined)) as { tag_name?: unknown } | undefined)?.tag_name;
  const version = typeof tag === "string" ? versionFromTag(app.release.tag, tag) : undefined;
  if (!version) throw new Error(`the latest ${app.name} release on GitHub has tag ${JSON.stringify(tag)}, which doesn't fit "${app.release.tag}"`);
  return version;
}

/** An installed app's bundle (from the sources) and its newest release. */
async function newest(appId: string, o: UpdateOptions) {
  const choice = await bundleForApp(o.paths, appId, o);
  if (!choice) throw new Error(`no bundle source has "${appId}"; add one, e.g. revamp sources add xb00tt/revamp`);
  for (const w of choice.warnings) o.log?.(`Warning: ${w}`);
  const app = findApp(await describe(choice.bundlePath), appId);
  return { bundlePath: choice.bundlePath, app, latest: await latestRelease(app, o) };
}

const isStable = (app: AppInfo, version: string) => Object.hasOwn(app.versions, version) && !app.versions[version].experimental;

/**
 * Refreshes the sources, then for each installed app looks up its newest release and, if it is newer than
 * `current`, downloads, verifies and dry-runs it with the saved selection. The result goes to last-check.json.
 */
export async function checkUpdates(o: UpdateOptions): Promise<CheckResult> {
  const sources = await refreshSources(o.paths, o);
  const apps: AppCheck[] = [];
  for (const installed of listInstalls(o.paths)) {
    if (!installed.current) continue;
    const check: AppCheck = { appId: installed.appId, appName: installed.appId, current: installed.current, status: "failed" };
    try {
      const { bundlePath, app, latest } = await newest(installed.appId, o);
      const listed = isStable(app, latest);
      const experimental = Object.hasOwn(app.versions, latest) && !listed;
      Object.assign(check, { appName: app.name, latest, listed, ...(experimental && { experimental }), status: "up to date" });
      if (compareVersions(latest, installed.current) > 0) {
        const r = await patchApp({ ...o, appId: app.id, bundlePath, version: latest, force: !listed, dryRun: true });
        Object.assign(check, { status: "update", ...patchCounts(r.results), aborted: r.aborted });
      }
    } catch (e) {
      check.error = e instanceof Error ? e.message : String(e);
    }
    apps.push(check);
  }
  const result = { checkedAt: new Date().toISOString(), sources, apps };
  mkdirSync(o.paths.state, { recursive: true });
  const file = join(o.paths.state, "last-check.json");
  writeFileSync(`${file}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return result;
}

/** The line `revamp check` prints and notify-send shows. */
export function checkMessage(c: AppCheck): string {
  if (c.status === "failed") return `Couldn't check ${c.appName}: ${c.error}`;
  if (c.status === "up to date") return `${c.appName} ${c.current} is up to date`;
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
  /** Absent when `current` is already the newest release. */
  result?: PatchAppResult;
}

/**
 * Installs an installed app's newest release with its saved selection (spec §7.3). A version the bundle doesn't list,
 * or lists as experimental, needs `force`.
 */
export async function updateApp(appId: string, o: UpdateOptions & { force?: boolean }): Promise<AppUpdate> {
  const current = listInstalls(o.paths).find((a) => a.appId === appId)?.current;
  if (!current) throw new Error(`${appId} is not installed; install it with revamp patch ${appId}`);
  await refreshSources(o.paths, o).then((lines) => lines.forEach((l) => o.log?.(l)));
  const { bundlePath, app, latest } = await newest(appId, o);
  const update = { appId, appName: app.name, current, latest };
  if (compareVersions(latest, current) <= 0) return update;
  return { ...update, result: await patchApp({ ...o, appId: app.id, bundlePath, version: latest }) };
}
