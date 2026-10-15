// What the screens show, as plain functions the Node tests can run (no React, no Tauri).
import type { AppCheck, CheckResult, JobProgress, PatchAppResult, StorageItem } from "@revamp/engine";

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

/**
 * The last check for an app, only if it was made against the version installed now, and brought up to date with what
 * happened since: a skip or its undo, or a re-patch (which settles "new patches").
 */
export const checkFor = (list: AppsList, appId: string): AppCheck | undefined => {
  const found = list.lastCheck?.apps.find((a) => a.appId === appId);
  const app = list.apps.find((a) => a.appId === appId);
  if (!found || found.current !== app?.current) return undefined;
  const skipped = list.skipped[appId];
  if (found.status === "update" && found.latest === skipped) return { ...found, status: "skipped" };
  if (found.status === "skipped" && found.latest !== skipped) return { ...found, status: "update" };
  const installedAt = app.versions.find((v) => v.version === app.current)?.installedAt;
  if (found.status === "patches" && installedAt && Date.parse(installedAt) > Date.parse(list.lastCheck!.checkedAt)) return undefined;
  return found;
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

/** The engine labels a patch the user doesn't pick "(internal patch #7: Hydra extension loader)"; on screen it reads "Hydra extension loader (helper)". */
export function patchName(label: string): string {
  const m = /^\(internal patch #(\d+)(?:: (.*))?\)$/s.exec(label);
  return !m ? label : m[2] ? `${m[2]} (helper)` : `helper #${m[1]}`;
}

export function progressLabel(e: JobProgress): string {
  if (e.step === "download" && e.percent !== undefined) return `Downloading ${e.percent}%`;
  if (e.step === "patch" && e.patch) return `Patching: ${patchName(e.patch)} (${e.index}/${e.total})`;
  return `${STEP[e.step]}…`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export const reclaimable = (items: StorageItem[]) => items.filter((i) => !i.keep).reduce((total, i) => total + i.bytes, 0);

// A job's screen (dry run, patch, update), built from serve's job.log and job.progress notifications and the reply.
export const JOB_STEPS: JobProgress["step"][] = ["download", "extract", "patch", "repack", "install"];
const STEPS = JOB_STEPS;
/** Share of the progress bar per step; a dry run stops after patching. */
const WEIGHTS: Record<"dry" | "install", Record<JobProgress["step"], number>> = {
  dry: { download: 40, extract: 35, patch: 25, repack: 0, install: 0 },
  install: { download: 30, extract: 30, patch: 25, repack: 10, install: 5 },
};

export interface JobLine {
  at: number;
  kind: "info" | "ok" | "fail" | "warn" | "summary";
  text: string;
}

export interface JobState {
  dryRun: boolean;
  started: number;
  steps: Record<JobProgress["step"], "todo" | "active" | "done">;
  /** Overall progress, 0–100. */
  percent: number;
  /** How far the active step is, 0–1. */
  fraction: number;
  /** The last download percent written to the log, to log it once per tenth. */
  logged: number;
  lines: JobLine[];
  done: boolean;
  ok: boolean;
  summary: string;
}

export function startJob(dryRun: boolean, now: number): JobState {
  const steps = Object.fromEntries(STEPS.map((s) => [s, "todo"])) as JobState["steps"];
  return { dryRun, started: now, steps, percent: 0, fraction: 0, logged: -1, lines: [], done: false, ok: false, summary: "" };
}

function percentOf(s: JobState): number {
  const w = WEIGHTS[s.dryRun ? "dry" : "install"];
  return Math.round(STEPS.reduce((total, step) => total + (s.steps[step] === "done" ? w[step] : s.steps[step] === "active" ? w[step] * s.fraction : 0), 0));
}

/** One notification from `revamp serve` applied to the job; anything but job.log and job.progress is ignored. */
export function jobEvent(s: JobState, method: string, params: unknown, now: number): JobState {
  const p = (params ?? {}) as { line?: unknown } & Partial<JobProgress>;
  const line = (kind: JobLine["kind"], text: string) => [...s.lines, { at: now, kind, text: plain(text) }];
  if (method === "job.log" && typeof p.line === "string") return { ...s, lines: line("info", p.line) };
  if (method !== "job.progress" || !p.step || !STEPS.includes(p.step)) return s;
  const at = STEPS.indexOf(p.step);
  const steps = Object.fromEntries(STEPS.map((step, i) => [step, i < at ? "done" : i === at ? "active" : s.steps[step]])) as JobState["steps"];
  let next: JobState = { ...s, steps, fraction: s.steps[p.step] === "active" ? s.fraction : 0 };
  if (p.step === "download" && typeof p.percent === "number") {
    next.fraction = p.percent / 100;
    if (s.logged < 0 || Math.floor(p.percent / 10) > Math.floor(s.logged / 10)) next = { ...next, logged: p.percent, lines: line("info", `Downloaded ${p.percent}%`) };
  }
  if (p.step === "patch" && p.patch && p.index && p.total) next = { ...next, fraction: (p.index - 1) / p.total, lines: line("info", `Patching ${p.index}/${p.total}: ${patchName(p.patch)}`) };
  return { ...next, percent: percentOf(next) };
}

export interface JobOutcome {
  result?: PatchAppResult;
  report?: string;
  /** Set when there was nothing to do (an update with no newer release or bundle). */
  upToDate?: string;
  error?: string;
}

/** The job's end: each named patch's result, notes and the summary line (the first line of the CLI's report). */
export function finishJob(s: JobState, outcome: JobOutcome, now: number): JobState {
  const lines = [...s.lines];
  const add = (kind: JobLine["kind"], text: string) => void lines.push({ at: now, kind, text: plain(text) });
  const end = (ok: boolean, summary: string, percent = s.percent): JobState => ({ ...s, lines, done: true, ok, summary: plain(summary), percent });
  if (outcome.error) return add("fail", outcome.error), end(false, outcome.error);
  const r = outcome.result;
  if (!r) return add("summary", outcome.upToDate ?? "Nothing to do"), end(true, outcome.upToDate ?? "Nothing to do", 100);
  for (const x of r.results) {
    if (x.status === "applied" && !x.internal) add("ok", `✓ ${x.name}${x.required ? " (required)" : ""}`);
    else if (x.status === "failed") add("fail", `✗ ${patchName(x.name)}${x.message ? `: ${x.message}` : ""}`);
    else if (x.status === "skipped" && !x.internal) add("fail", `– ${x.name} skipped${x.message ? `: ${x.message}` : ""}`);
  }
  if (r.aborted) add("fail", `Stopped: ${r.aborted}`);
  for (const w of r.warnings) add("warn", `Note: ${w}`);
  const summary = outcome.report?.split("\n")[0] ?? `${r.appName} ${r.version}`;
  add("summary", summary);
  const steps = Object.fromEntries(STEPS.map((step) => [step, s.steps[step] === "todo" && !r.installed ? "todo" : "done"])) as JobState["steps"];
  return { ...end(!r.aborted && r.exitCode === 0, summary, r.aborted ? s.percent : 100), steps: r.aborted ? s.steps : { ...steps, download: "done", extract: "done", patch: "done" } };
}
