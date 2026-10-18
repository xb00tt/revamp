import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Selection } from "./config.ts";
import { serializeDesktopEntry } from "./desktop.ts";
import type { PatchResult } from "./graph.ts";
import { appDir, assertSafeName, type Paths } from "./paths.ts";

export interface Receipt {
  app: string;
  version: string;
  /** untested: the bundle didn't list the version; it was verified against GitHub's published SHA-256. Absent in M1 receipts. */
  release: { asset: string; sha256: string; untested?: boolean };
  bundle: { name: string; version: string; sha256: string };
  patches: PatchResult[];
  selection: Selection;
  installedAt: string;
}

export const ICON_FILE = "revamp-icon.png";

export function newStaging(paths: Paths, appId: string): string {
  const root = appDir(paths, appId);
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, ".staging-"));
}

/**
 * Serializes jobs for one app and clears what interrupted ones left behind (a staging tree is ~700 MB).
 * The lock file holds its owner's pid; a lock whose process is gone is taken over. Returns the unlock function.
 */
export function lockApp(paths: Paths, appId: string): () => void {
  const root = appDir(paths, appId);
  mkdirSync(root, { recursive: true });
  const lock = join(root, ".lock");
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // ponytail: pid-file lock; a reused pid keeps a stale lock alive until that process exits.
      const pid = Number.parseInt(readFileSync(lock, "utf8"), 10);
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) throw new Error(`another Revamp job for ${appId} is running (pid ${pid})`);
      rmSync(lock, { force: true });
    }
  }
  for (const name of readdirSync(root)) {
    if (/^\.(staging|replaced|current)-/.test(name)) rmSync(join(root, name), { recursive: true, force: true });
  }
  return () => rmSync(lock, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface InstallInput {
  paths: Paths;
  appId: string;
  version: string;
  executable: string;
  staging: string;
  receipt: Receipt;
  desktopEntry: Record<string, string>;
}

/** Moves a finished staging dir into place, points `current` at it, writes the menu entry and prunes old versions. */
export function installStaged(i: InstallInput): string {
  const root = appDir(i.paths, i.appId);
  const exe = join(root, "current", i.executable);
  if (/["`$\\]/.test(exe)) throw new Error(`a .desktop Exec line can't hold the install path ${exe}`);
  // Build (and so validate) the menu entry first: a bad one must fail the job before anything is moved.
  const desktopText = desktopFileText(i.desktopEntry, exe, join(root, "current", ICON_FILE), existsSync(join(i.staging, ICON_FILE)));
  const dest = join(root, assertSafeName("version", i.version));
  // The staging tree comes from the .deb: replace anything named revamp.json, never write through it.
  const receiptPath = join(i.staging, "revamp.json");
  rmSync(receiptPath, { force: true });
  writeFileSync(receiptPath, JSON.stringify(i.receipt, null, 2) + "\n", { flag: "wx" });
  let aside: string | undefined;
  if (existsSync(dest)) {
    aside = join(root, `.replaced-${i.version}-${process.pid}`);
    renameSync(dest, aside);
  }
  renameSync(i.staging, dest);
  if (aside) rmSync(aside, { recursive: true, force: true });
  pointCurrent(root, i.version);
  writeDesktopFile(i.paths, i.appId, desktopText);
  pruneVersions(root);
  return dest;
}

function pointCurrent(root: string, version: string): void {
  const tmp = join(root, `.current-${process.pid}`);
  rmSync(tmp, { force: true });
  symlinkSync(version, tmp);
  renameSync(tmp, join(root, "current"));
}

export function currentVersion(root: string): string | undefined {
  try {
    return readlinkSync(join(root, "current"));
  } catch {
    return undefined;
  }
}

export interface InstalledVersion {
  version: string;
  receipt: Receipt;
}

/** Finished installs (those with a receipt), newest first. */
export function installedVersions(root: string): InstalledVersion[] {
  if (!existsSync(root)) return [];
  const out: InstalledVersion[] = [];
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    try {
      out.push({ version: d.name, receipt: JSON.parse(readFileSync(join(root, d.name, "revamp.json"), "utf8")) });
    } catch {
      // no receipt: not a finished install
    }
  }
  return out.sort((a, b) => b.receipt.installedAt.localeCompare(a.receipt.installedAt));
}

/** Keeps the version `current` points to plus the most recently installed other one. */
export function pruneVersions(root: string): string[] {
  const current = currentVersion(root);
  const removed = installedVersions(root)
    .filter((v) => v.version !== current)
    .slice(1)
    .map((v) => v.version);
  for (const v of removed) rmSync(join(root, v), { recursive: true, force: true });
  return removed;
}

export const desktopFilePath = (paths: Paths, appId: string) =>
  join(paths.applications, `revamp-${assertSafeName("app id", appId)}.desktop`);

function desktopFileText(entry: Record<string, string>, exe: string, icon: string, hasIcon: boolean): string {
  const fieldCode = /%[fFuU]/.exec(String(entry.Exec ?? ""))?.[0];
  const final: Record<string, string> = { ...entry, Exec: `"${exe}"${fieldCode ? ` ${fieldCode}` : ""}` };
  delete final.TryExec;
  if (hasIcon) final.Icon = icon;
  return serializeDesktopEntry(final);
}

function writeDesktopFile(paths: Paths, appId: string, text: string): void {
  mkdirSync(paths.applications, { recursive: true });
  const file = desktopFilePath(paths, appId);
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
  refreshDesktopDatabase(paths);
}

function refreshDesktopDatabase(paths: Paths): void {
  spawnSync("update-desktop-database", [paths.applications], { stdio: "ignore" }); // optional tool
}

export interface InstalledApp {
  appId: string;
  current: string | undefined;
  versions: InstalledVersion[];
}

export function listInstalls(paths: Paths): InstalledApp[] {
  const apps = join(paths.data, "apps");
  if (!existsSync(apps)) return [];
  return readdirSync(apps, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => ({ appId: d.name, current: currentVersion(join(apps, d.name)), versions: installedVersions(join(apps, d.name)) }))
    .filter((a) => a.versions.length > 0);
}

export function rollback(paths: Paths, appId: string): string {
  const root = appDir(paths, appId);
  const unlock = lockApp(paths, appId); // never while a job installs or storage removes a version
  try {
    const current = currentVersion(root);
    const previous = installedVersions(root).find((v) => v.version !== current);
    if (!previous) throw new Error(`no previous version of ${appId} to roll back to`);
    pointCurrent(root, previous.version);
    return previous.version;
  } finally {
    unlock();
  }
}

export function uninstall(paths: Paths, appId: string): void {
  const root = appDir(paths, appId);
  if (!existsSync(root)) throw new Error(`${appId} is not installed`);
  rmSync(root, { recursive: true, force: true });
  rmSync(desktopFilePath(paths, appId), { force: true });
  rmSync(join(paths.config, "apps", `${appId}.json`), { force: true });
  refreshDesktopDatabase(paths);
}

export function environmentWarnings(
  app: { id: string; name: string },
  o: { sysctl?: string; profileExists?: (name: string) => boolean } = {},
): string[] {
  // A Flatpak or Snap stock app keeps its settings elsewhere, so this is only true for the official .deb install.
  const out = [`Revamped ${app.name} uses the same settings as a stock ${app.name} installed from the official .deb, so only one of them can run at a time.`];
  try {
    if (readFileSync(o.sysctl ?? "/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1" && !o.profileExists?.(`revamp-${app.id}`)) {
      out.push(
        `This system restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1), so Electron's sandbox can't start in an app installed in your home folder. Run once: revamp sandbox ${app.id}`,
      );
    }
  } catch {
    // not an AppArmor system
  }
  return out;
}
