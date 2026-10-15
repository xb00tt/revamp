// What the screens show, as plain functions the Node tests can run (no React, no Tauri).
import type { AppCheck, CheckResult, JobProgress, StorageItem } from "@revamp/engine";

export interface AppRow {
  appId: string;
  name: string;
  current: string | null;
  versions: Array<{ version: string; installedAt: string; bundle: { name: string; version: string }; untested: boolean }>;
}

export interface AppsList {
  apps: AppRow[];
  lastCheck: CheckResult | null;
  skipped: Record<string, string>;
}

export type Badge = { kind: "release" | "patches" | "ok" | "skipped" | "failed" | "new"; label: string };

/** The sidebar badge: a new release, new patches for the installed version, or nothing to do. */
export function badgeFor(app: AppRow, check: AppCheck | undefined): Badge {
  if (!app.current) return { kind: "new", label: "Not installed" };
  if (!check || check.current !== app.current) return { kind: "ok", label: app.current };
  if (check.status === "update") return { kind: "release", label: `${check.latest} out` };
  if (check.status === "patches") return { kind: "patches", label: "New patches" };
  if (check.status === "skipped") return { kind: "skipped", label: `Skipped ${check.latest}` };
  if (check.status === "failed") return { kind: "failed", label: "Check failed" };
  return { kind: "ok", label: "Up to date" };
}

/** The last check for an app, only if it was made against the version installed now. */
export const checkFor = (list: AppsList, appId: string) => {
  const found = list.lastCheck?.apps.find((a) => a.appId === appId);
  return found && found.current === list.apps.find((a) => a.appId === appId)?.current ? found : undefined;
};

/** Bundle-supplied text for the screen: no bidi overrides, zero-width or control characters (newline and tab stay). */
export const plain = (text = "") => text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]/g, "");

/** Apps that "Update all" would touch: a newer release or new patches, never a skipped release. */
export const pendingUpdates = (list: AppsList): string[] =>
  list.apps.filter((a) => a.current && ["release", "patches"].includes(badgeFor(a, checkFor(list, a.appId)).kind)).map((a) => a.appId);

export interface PatchRow {
  name: string;
  description: string;
  default: boolean;
  required: boolean;
  compatible: boolean;
  options: Record<string, { type: string; title: string; description: string; default: unknown }>;
}

export interface Selection {
  enable: string[];
  disable: string[];
  options: Record<string, Record<string, unknown>>;
}

/** Whether each patch starts switched on: required ones always, then the saved choice, then the patch's default. */
export function initialToggles(patches: PatchRow[], saved: Selection): Record<string, boolean> {
  const on = (p: PatchRow) => p.required || saved.enable.includes(p.name) || (p.default && !saved.disable.includes(p.name));
  return Object.fromEntries(patches.filter((p) => p.compatible).map((p) => [p.name, on(p)]));
}

/** The toggles as the job's enable/disable lists; required patches are left to the engine. */
export function selectionFlags(patches: PatchRow[], toggles: Record<string, boolean>): { enable: string[]; disable: string[] } {
  const choosable = patches.filter((p) => p.compatible && !p.required);
  return { enable: choosable.filter((p) => toggles[p.name]).map((p) => p.name), disable: choosable.filter((p) => !toggles[p.name]).map((p) => p.name) };
}

/** Option values as `--option` strings, only for values that differ from the patch's default. */
export function optionFlags(patches: PatchRow[], values: Record<string, Record<string, unknown>>): string[] {
  return patches.flatMap((p) =>
    Object.entries(values[p.name] ?? {})
      .filter(([key, value]) => Object.hasOwn(p.options, key) && value !== p.options[key].default)
      .map(([key, value]) => `${p.name}:${key}=${String(value)}`),
  );
}

const STEP: Record<JobProgress["step"], string> = { download: "Downloading", extract: "Extracting", patch: "Patching", repack: "Repacking", install: "Installing" };

export function progressLabel(e: JobProgress): string {
  if (e.step === "download" && e.percent !== undefined) return `Downloading ${e.percent}%`;
  if (e.step === "patch" && e.patch) return `Patching: ${e.patch} (${e.index}/${e.total})`;
  return `${STEP[e.step]}…`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export const reclaimable = (items: StorageItem[]) => items.filter((i) => !i.keep).reduce((total, i) => total + i.bytes, 0);
