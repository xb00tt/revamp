import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertAsarPath, readAsar, writeAsar } from "./asar.ts";
import { loadSelection, resolveSelection, saveSelection } from "./config.ts";
import { extractDeb, type EntryKind } from "./deb.ts";
import { parseDesktopEntry } from "./desktop.ts";
import { downloadVerified, fileSha256 } from "./download.ts";
import type { PatchResult } from "./graph.ts";
import { environmentWarnings, ICON_FILE, installStaged, lockApp, newStaging } from "./install.ts";
import { ASAR_PATH, patchesForApp, type AppInfo, type BundleDescription, type SandboxPatchOutput } from "./job.ts";
import { assertSafeName, assertSafeRelativePath, releasePath, revampPaths, type Paths } from "./paths.ts";
import { runSandboxed } from "./sandbox.ts";
import { compareVersions, ENGINE_VERSION } from "./version.ts";

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
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface PatchAppResult {
  appId: string;
  appName: string;
  version: string;
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
function findApp(desc: BundleDescription, appId: string): AppInfo {
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

export async function patchApp(o: PatchAppOptions): Promise<PatchAppResult> {
  const paths = o.paths ?? revampPaths();
  const log = o.log ?? (() => {});
  const bundlePath = resolve(o.bundlePath);
  const desc = await describe(bundlePath);
  const bundleName = desc.manifest.name;
  const app = findApp(desc, o.appId);
  const version = o.version ?? newestStable(app.versions);
  if (!version || !Object.hasOwn(app.versions, version)) {
    const supported = Object.keys(app.versions).sort(compareVersions).join(", ");
    throw new Error(`${app.name} ${version ?? "(no stable version)"} is not supported by bundle "${bundleName}" (supported: ${supported})`);
  }
  const info = app.versions[version];
  if (info.experimental && !o.force) throw new Error(`${app.name} ${version} is experimental in this bundle; add --force to patch it anyway`);
  const asset = assertSafeName("asset", fill(app.release.asset, version));
  const tag = fill(app.release.tag, version);
  const resolved = resolveSelection(app, patchesForApp(desc.patches, app.id), loadSelection(paths, app.id), {
    enable: o.enable,
    disable: o.disable,
    options: o.options,
  });
  const selection = resolved.selection;
  const warnings = [...resolved.warnings];

  // One job per app at a time; this also sweeps staging dirs that interrupted jobs left behind.
  const unlock = lockApp(paths, app.id);
  try {
    const debPath = releasePath(paths, app.id, version, asset);
    log(`Downloading ${asset}…`);
    const url = `${o.releaseBaseUrl ?? "https://github.com"}/${app.release.github}/releases/download/${tag}/${asset}`;
    const how = await downloadVerified({ url, dest: debPath, sha256: info.sha256, fetch: o.fetch });
    if (how === "replaced") log("The cached download had the wrong SHA-256, so it was downloaded again.");

    const staging = newStaging(paths, app.id);
    try {
      log("Extracting…");
      await extractDeb(debPath, staging, installSelector(app));
      const exe = statSync(join(staging, app.executable), { throwIfNoEntry: false });
      if (!exe?.isFile() || (exe.mode & 0o111) === 0) throw new Error(`the .deb has no executable file ${app.installDir}/${app.executable}`);
      const stockDesktop = takeMeta(staging, app);

      log("Patching…");
      const outDir = join(staging, ".revamp-out");
      mkdirSync(outDir);
      const job = await runSandboxed<SandboxPatchOutput>(
        { mode: "patch", bundle: bundlePath, staging, outDir, appId: app.id, version, selection, force: o.force ?? false, stockDesktop },
        { read: [staging, bundlePath], write: [outDir] },
      );
      const base = { appId: app.id, appName: app.name, version, results: job.results, logs: job.logs, dryRun: o.dryRun ?? false, warnings };
      if (job.aborted) return { ...base, installed: false, aborted: job.aborted, exitCode: 1 };
      const exitCode = job.results.some((r) => r.status === "failed" || r.status === "skipped") ? 2 : 0;
      if (o.dryRun) return { ...base, installed: false, exitCode };

      log("Repacking…");
      const asarPath = join(staging, ASAR_PATH);
      const changes = new Map(job.files.map((f) => [f, readFileSync(join(outDir, "files", ...assertAsarPath(f).split("/")))]));
      rmSync(`${asarPath}.new`, { force: true }); // the .deb could have planted a symlink here
      writeAsar(readAsar(asarPath), `${asarPath}.new`, changes);
      renameSync(`${asarPath}.new`, asarPath);
      rmSync(outDir, { recursive: true, force: true });

      log("Installing…");
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
          release: { asset, sha256: info.sha256 },
          bundle: { name: bundleName, version: desc.manifest.version, sha256: await fileSha256(bundlePath) },
          patches: job.results,
          selection,
          installedAt: new Date().toISOString(),
        },
      });
      saveSelection(paths, app.id, selection);
      return { ...base, installed: true, installDir, exitCode, warnings: [...warnings, ...environmentWarnings(app.name)] };
    } finally {
      rmSync(staging, { recursive: true, force: true }); // no-op after a successful install renamed it
    }
  } finally {
    unlock();
  }
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
