import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import { assertAsarPath, readAsar, writeAsar } from "./asar.ts";
import { loadSelection, resolveSelection, saveSelection, type Selection } from "./config.ts";
import { extractDeb, type EntryKind } from "./deb.ts";
import { parseDesktopEntry } from "./desktop.ts";
import { realDoctorEnv, sandboxProfilePresent } from "./doctor.ts";
import { downloadVerified, fileSha256, releaseDigest } from "./download.ts";
import type { PatchResult } from "./graph.ts";
import { environmentWarnings, ICON_FILE, installStaged, listInstalls, lockApp, newStaging } from "./install.ts";
import { ASAR_PATH, patchesForApp, type AppInfo, type BundleDescription, type PatchInfo, type SandboxPatchOutput } from "./job.ts";
import { assertSafeName, assertSafeRelativePath, releasePath, revampPaths, type Paths } from "./paths.ts";
import { runSandboxed } from "./sandbox.ts";
import { compareVersions, ENGINE_VERSION } from "./version.ts";

/** The install note's question; an unsafe username can't be judged, so the note stays. */
function profileInstalled(paths: Paths, appId: string): boolean {
  try {
    return sandboxProfilePresent(paths, appId, realDoctorEnv());
  } catch {
    return false;
  }
}

export interface PatchAppOptions {
  appId: string;
  bundlePath: string;
  version?: string;
  force?: boolean;
  enable?: string[];
  disable?: string[];
  /** `--option` flags: "<patch>:<key>=<value>". */
  options?: string[];
  dryRun?: boolean;
  paths?: Paths;
  /** Tests point this at a local server; defaults to https://github.com. */
  releaseBaseUrl?: string;
  /** Tests point this at a local server; defaults to https://api.github.com. */
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  /** Structured progress for front ends that draw it (the GUI); `log` keeps the CLI's lines. */
  progress?: (event: JobProgress) => void;
  /** Asked once when a re-patch finds default-on patches the install never had; without it they just follow their defaults. */
  confirmNewPatches?: (question: NewPatchesQuestion) => Promise<NewPatchesAnswer>;
}

export interface NewPatchesQuestion {
  bundle: { name: string; version: string };
  appName: string;
  version: string;
  patches: Array<{ name: string; description: string }>;
}
/** "off-this-run" skips the patches now and saves nothing, so the next run asks again. */
export type NewPatchesAnswer = "on" | "off" | "off-this-run";

/** Patch names in the current install's receipt; undefined when the app has no current install. */
export function installedPatchNames(paths: Paths, appId: string): string[] | undefined {
  const inst = listInstalls(paths).find((a) => a.appId === appId);
  if (!inst?.current) return undefined;
  const v = inst.versions.find((x) => x.version === inst.current);
  // A disabled or incompatible entry is in the receipt but was never installed.
  return (v?.receipt.patches ?? []).flatMap((p) => (p.name && p.status !== "disabled" && p.status !== "incompatible" ? [p.name] : []));
}

/** Default-on, non-required patches the bundle offers for `version` that the install never had and nobody answered. */
export function newPatchesToAsk(
  app: AppInfo,
  patches: PatchInfo[],
  version: string,
  installed: string[] | undefined,
  saved: Selection,
  flags: { enable?: string[]; disable?: string[] },
  /** Under --force the engine runs every default-on patch whatever its versions, so they all count as offered. */
  forced: boolean,
): PatchInfo[] {
  if (!installed) return [];
  const answered = [...saved.enable, ...saved.disable, ...(flags.enable ?? []), ...(flags.disable ?? [])];
  return patches.filter(
    (p) => (forced || fitsVersion(p, app.id, version)) && p.default && !app.required.includes(p.name) && !installed.includes(p.name) && !answered.includes(p.name),
  );
}

export type JobStep = "download" | "extract" | "patch" | "repack" | "install";

/** download carries `percent` when the size is known; patch names the patch starting (`index` of `total`, internal ones included). */
export interface JobProgress {
  step: JobStep;
  percent?: number;
  patch?: string;
  index?: number;
  total?: number;
}

export interface PatchAppResult {
  appId: string;
  appName: string;
  version: string;
  /** The bundle doesn't list this version; it was verified only against GitHub's published SHA-256. */
  untested: boolean;
  results: PatchResult[];
  installed: boolean;
  dryRun: boolean;
  installDir?: string;
  aborted?: string;
  exitCode: 0 | 1 | 2;
  warnings: string[];
  logs: string[];
}

export function describe(bundlePath: string): Promise<BundleDescription> {
  const bundle = resolve(bundlePath);
  return runSandboxed<BundleDescription>({ mode: "describe", bundle }, { read: [bundle], write: [] });
}

export function newestStable(versions: AppInfo["versions"]): string | undefined {
  return Object.keys(versions)
    .filter((v) => !versions[v].experimental)
    .sort(compareVersions)
    .at(-1);
}

const fill = (template: string, version: string) => template.replaceAll("{version}", version);
const META = ".revamp-meta";

/** The app a job or listing is about, after checking the bundle's engine floor and the app's bundle-supplied names. */
export function findApp(desc: BundleDescription, appId: string): AppInfo {
  const bundleName = desc.manifest.name;
  if (compareVersions(desc.manifest.minEngine, ENGINE_VERSION) > 0) {
    throw new Error(`bundle "${bundleName}" needs Revamp ${desc.manifest.minEngine} or newer (this is ${ENGINE_VERSION})`);
  }
  const app = desc.apps.find((a) => a.id === appId);
  if (!app) throw new Error(`bundle "${bundleName}" has no app "${appId}" (it has: ${desc.apps.map((a) => a.id).join(", ") || "none"})`);
  assertSafeName("app id", app.id);
  assertSafeRelativePath("executable", app.executable);
  return app;
}

/** A job's tally, as the report header and update checks show it: named patches that ran (not disabled or incompatible). */
export function patchCounts(results: PatchResult[]): { applied: number; total: number; failing: string[] } {
  const ran = results.filter((x) => !x.internal && x.status !== "disabled" && x.status !== "incompatible");
  return {
    applied: ran.filter((x) => x.status === "applied").length,
    total: ran.length,
    failing: ran.filter((x) => x.status !== "applied").map((x) => x.name),
  };
}

export async function patchApp(o: PatchAppOptions): Promise<PatchAppResult> {
  const paths = o.paths ?? revampPaths();
  const log = o.log ?? (() => {});
  const progress = o.progress ?? (() => {});
  const bundlePath = resolve(o.bundlePath);
  const desc = await describe(bundlePath);
  const bundleName = desc.manifest.name;
  const app = findApp(desc, o.appId);
  const version = o.version ?? newestStable(app.versions);
  if (!version) throw new Error(`bundle "${bundleName}" has no stable ${app.name} version; pass --version`);
  assertSafeName("version", version);
  const info = Object.hasOwn(app.versions, version) ? app.versions[version] : undefined;
  if (!info && !o.force) {
    const supported = Object.keys(app.versions).sort(compareVersions).join(", ");
    throw new Error(
      `${app.name} ${version} is not supported by bundle "${bundleName}" (supported: ${supported}); ` +
        "add --force to patch it anyway, verified only against GitHub's published SHA-256",
    );
  }
  if (info?.experimental && !o.force) throw new Error(`${app.name} ${version} is experimental in this bundle; add --force to patch it anyway`);
  const untested = !info;
  const asset = assertSafeName("asset", fill(app.release.asset, version));
  const tag = fill(app.release.tag, version);
  const patches = patchesForApp(desc.patches, app.id);
  const saved = loadSelection(paths, app.id);
  const resolved = resolveSelection(app, patches, saved, {
    enable: o.enable,
    disable: o.disable,
    options: o.options,
  });
  const selection = resolved.selection;
  let runSelection: Selection | undefined;
  if (o.confirmNewPatches) {
    const ask = newPatchesToAsk(app, patches, version, installedPatchNames(paths, app.id), saved, o, o.force ?? false);
    if (ask.length) {
      const names = ask.map((p) => p.name);
      const answer = await o.confirmNewPatches({
        bundle: { name: bundleName, version: desc.manifest.version },
        appName: app.name,
        version,
        patches: ask.map((p) => ({ name: p.name, description: p.description })),
      });
      if (answer === "on") selection.enable.push(...names);
      else if (answer === "off") selection.disable.push(...names);
      else runSelection = { ...selection, disable: [...selection.disable, ...names] };
    }
  }
  const warnings = [...resolved.warnings];
  if (untested) warnings.push(`${app.name} ${version} is untested: bundle "${bundleName}" doesn't list it, so it was verified only against GitHub's published SHA-256.`);

  // One job per app at a time; this also sweeps staging dirs that interrupted jobs left behind.
  const unlock = lockApp(paths, app.id);
  try {
    let sha256 = info?.sha256;
    if (!sha256) {
      log(`Looking up GitHub's SHA-256 for ${asset}…`);
      sha256 = await releaseDigest({ repo: app.release.github, tag, asset, apiBaseUrl: o.apiBaseUrl, fetch: o.fetch });
    }
    const debPath = releasePath(paths, app.id, version, asset);
    log(`Downloading ${asset}…`);
    const url = `${o.releaseBaseUrl ?? "https://github.com"}/${app.release.github}/releases/download/${tag}/${asset}`;
    let percent = -1;
    const onProgress = (received: number, size: number | undefined) => {
      const now = size ? Math.floor((received * 100) / size) : -1;
      if (now > percent) progress({ step: "download", percent: (percent = now) });
    };
    progress({ step: "download" });
    const how = await downloadVerified({ url, dest: debPath, sha256, fetch: o.fetch, onProgress });
    if (how === "replaced") log("The cached download had the wrong SHA-256, so it was downloaded again.");

    const staging = newStaging(paths, app.id);
    try {
      log("Extracting…");
      progress({ step: "extract" });
      await extractDeb(debPath, staging, installSelector(app));
      let exe: Stats | undefined;
      try {
        exe = statSync(join(staging, app.executable));
      } catch {} // missing, or a symlink loop
      if (!exe?.isFile() || (exe.mode & 0o111) === 0) throw new Error(`the .deb has no executable file ${app.installDir}/${app.executable}`);
      const stockDesktop = takeMeta(staging, app);

      log("Patching…");
      const outDir = join(staging, ".revamp-out");
      mkdirSync(outDir);
      const job = await runSandboxed<SandboxPatchOutput>(
        { mode: "patch", bundle: bundlePath, staging, outDir, appId: app.id, version, selection: runSelection ?? selection, force: o.force ?? false, stockDesktop },
        { read: [staging, bundlePath], write: [outDir] },
        { onEvent: (e) => progress({ step: "patch", ...patchEvent(e) }) },
      );
      const base = { appId: app.id, appName: app.name, version, untested, results: job.results, logs: job.logs, dryRun: o.dryRun ?? false, warnings };
      if (job.aborted) return { ...base, installed: false, aborted: job.aborted, exitCode: 1 };
      const exitCode = job.results.some((r) => r.status === "failed" || r.status === "skipped") ? 2 : 0;
      if (o.dryRun) return { ...base, installed: false, exitCode };

      log("Repacking…");
      progress({ step: "repack" });
      const asarPath = join(staging, ASAR_PATH);
      const changes = new Map(job.files.map((f) => [f, readFileSync(join(outDir, "files", ...assertAsarPath(f).split("/")))]));
      rmSync(`${asarPath}.new`, { force: true }); // the .deb could have planted a symlink here
      writeAsar(readAsar(asarPath), `${asarPath}.new`, changes);
      renameSync(`${asarPath}.new`, asarPath);
      rmSync(outDir, { recursive: true, force: true });

      log("Installing…");
      progress({ step: "install" });
      const installDir = installStaged({
        paths,
        appId: app.id,
        version,
        executable: app.executable,
        staging,
        desktopEntry: job.desktopEntry,
        receipt: {
          app: app.id,
          version,
          release: { asset, sha256, untested },
          bundle: { name: bundleName, version: desc.manifest.version, sha256: await fileSha256(bundlePath) },
          patches: job.results,
          selection: runSelection ?? selection,
          installedAt: new Date().toISOString(),
        },
      });
      saveSelection(paths, app.id, selection);
      return { ...base, installed: true, installDir, exitCode, warnings: [...warnings, ...environmentWarnings({ id: app.id, name: app.name }, { profileExists: () => profileInstalled(paths, app.id) })] };
    } finally {
      rmSync(staging, { recursive: true, force: true }); // no-op after a successful install renamed it
    }
  } finally {
    unlock();
  }
}

export interface PatchListing {
  bundle: BundleDescription["manifest"];
  app: AppInfo;
  version: string;
  /** False when the bundle doesn't list the version: patching it needs --force. */
  listed: boolean;
  patches: Array<PatchInfo & { required: boolean; compatible: boolean }>;
}

/** The patch can apply to this app version (it lists no apps, or lists this one with no versions or with this version). */
export const fitsVersion = (p: PatchInfo, appId: string, version: string): boolean =>
  p.apps === null || p.apps.some((a) => a.app === appId && (a.versions === null || a.versions.includes(version)));

/** What `revamp patches <app>` shows: every patch that can apply to the app, judged for one version. */
export async function listPatches(bundlePath: string, appId: string, version?: string): Promise<PatchListing> {
  const desc = await describe(bundlePath);
  const app = findApp(desc, appId);
  const v = version ?? newestStable(app.versions);
  if (!v) throw new Error(`bundle "${desc.manifest.name}" has no stable ${app.name} version; pass --version`);
  const required = new Set(app.required);
  const patches = patchesForApp(desc.patches, app.id).map((p) => ({
    ...p,
    required: required.has(p.name),
    compatible: fitsVersion(p, app.id, v),
  }));
  return { bundle: desc.manifest, app, version: v, listed: Object.hasOwn(app.versions, v), patches };
}

/** The sandboxed child's "patch started" event, keeping only well-formed fields: the child runs bundle code. */
function patchEvent(e: unknown): Pick<JobProgress, "patch" | "index" | "total"> {
  const { patch, index, total } = (e ?? {}) as Record<string, unknown>;
  return typeof patch === "string" && Number.isInteger(index) && Number.isInteger(total) ? { patch, index: index as number, total: total as number } : {};
}

/** installDir/** goes to the staging root; the stock desktop file and hicolor PNG icons (regular files only) go to .revamp-meta/. */
function installSelector(app: AppInfo): (path: string, kind: EntryKind) => string | null {
  const prefix = `${app.installDir.replace(/^\/+|\/+$/g, "")}/`;
  const desktop = app.desktopFile.replace(/^\/+/, "");
  return (p, kind) => {
    if (p.startsWith(prefix)) return p.slice(prefix.length);
    // A link's target is relative to where the .deb puts it, so moved into .revamp-meta it would point elsewhere.
    if (kind === "link") return null;
    if (p === desktop) return `${META}/stock.desktop`;
    const icon = /^usr\/share\/icons\/hicolor\/(\d+)x\d+\/apps\/([^/]+\.png)$/.exec(p);
    return icon ? `${META}/icons/${icon[1]}/${icon[2]}` : null;
  };
}

/** Reads the stock desktop entry, keeps its largest PNG icon as revamp-icon.png and removes .revamp-meta/. */
function takeMeta(staging: string, app: AppInfo): Record<string, string> {
  const meta = join(staging, META);
  try {
    const desktopPath = join(meta, "stock.desktop");
    if (!existsSync(desktopPath)) throw new Error(`the .deb has no ${app.desktopFile}`);
    const entry = parseDesktopEntry(readFileSync(desktopPath, "utf8"));
    const icons = join(meta, "icons");
    if (/^[\w.+-]+$/.test(entry.Icon ?? "") && existsSync(icons)) {
      const sizes = readdirSync(icons).map(Number).sort((a, b) => b - a);
      const size = sizes.find((s) => existsSync(join(icons, String(s), `${entry.Icon}.png`)));
      if (size !== undefined) {
        rmSync(join(staging, ICON_FILE), { force: true }); // never copy through a symlink the .deb planted
        copyFileSync(join(icons, String(size), `${entry.Icon}.png`), join(staging, ICON_FILE), constants.COPYFILE_EXCL);
      }
    }
    return entry;
  } finally {
    rmSync(meta, { recursive: true, force: true });
  }
}
