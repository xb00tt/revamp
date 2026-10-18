import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { loadSources } from "./bundle-sources.ts";
import { listInstalls } from "./install.ts";
import type { Paths } from "./paths.ts";
import { PROFILE_DIR, profileName, SYSCTL_PATH } from "./sandbox-profile.ts";
import { loadLastCheck } from "./updates.ts";

export type DoctorSeverity = "ok" | "fixable" | "broken";
export interface DoctorCheck {
  id: string;
  label: string;
  severity: DoctorSeverity;
  detail: string;
  fix?: string;
}

/** Everything doctor reads from the machine, so tests supply a fake. */
export interface DoctorEnv {
  platform: string;
  arch: string;
  glibc?: string;
  readFile(path: string): string | undefined;
  fileExists(path: string): boolean;
  /** `ldconfig -p` lines; [] when unavailable. */
  sharedLibs(): string[];
  /** undefined = no systemctl. */
  timer(): { enabled: boolean; active: boolean; lastTrigger?: string; nextElapse?: string } | undefined;
  pathEntries: string[];
  home: string;
  username: string;
}

/** The window is built on glibc 2.39; the CLI's own floor is Node's. */
export const WINDOW_GLIBC = "2.39";

/** Whether `dir` is one of the PATH entries, ignoring trailing slashes. */
export const onPath = (entries: string[], dir: string) => entries.some((e) => e.replace(/\/+$/, "") === dir.replace(/\/+$/, ""));

export function realDoctorEnv(): DoctorEnv {
  let glibc: string | undefined;
  try {
    glibc = (process.report.getReport() as unknown as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  } catch {
    // no report: glibc stays unknown
  }
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return r.error ? undefined : r;
  };
  return {
    platform: process.platform,
    arch: process.arch,
    glibc,
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    fileExists: existsSync,
    sharedLibs: () => run("ldconfig", ["-p"])?.stdout.split("\n") ?? [],
    timer: () => {
      const r = run("systemctl", ["--user", "show", "revamp-check.timer", "-p", "ActiveState", "-p", "LastTriggerUSec", "-p", "NextElapseUSecRealtime", "-p", "UnitFileState"]);
      if (!r) return undefined;
      const v = Object.fromEntries(r.stdout.split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
      const time = (s?: string) => (s && s !== "n/a" ? s : undefined);
      return {
        enabled: v.UnitFileState === "enabled",
        active: v.ActiveState === "active",
        lastTrigger: time(v.LastTriggerUSec),
        nextElapse: time(v.NextElapseUSecRealtime),
      };
    },
    pathEntries: (process.env.PATH ?? "").split(":"),
    home: process.env.HOME || userInfo().homedir,
    username: userInfo().username,
  };
}

/** Numeric major.minor comparison: "2.4" is older than "2.39". */
function glibcAtLeast(have: string, want: string): boolean {
  const [h1 = 0, h2 = 0] = have.split(".").map(Number);
  const [w1 = 0, w2 = 0] = want.split(".").map(Number);
  return h1 > w1 || (h1 === w1 && h2 >= w2);
}

/** The profile names that count as this user's for an app: the plain one unless another user's profile holds it, and the suffixed one an earlier run may have used. */
function sandboxProfileNames(paths: Paths, appId: string, env: Pick<DoctorEnv, "readFile" | "username">): string[] {
  const base = `revamp-${appId}`;
  return [profileName(appId, env.readFile(join(PROFILE_DIR, base)), paths.data, env.username), `${base}-${env.username}`];
}

/** Whether this user's sandbox profile for the app is in /etc/apparmor.d (not whether it is loaded: that needs root). Throws on an unsafe app id or username. */
export function sandboxProfilePresent(paths: Paths, appId: string, env: Pick<DoctorEnv, "readFile" | "fileExists" | "username">): boolean {
  return sandboxProfileNames(paths, appId, env).some((n) => env.fileExists(join(PROFILE_DIR, n)));
}

/** The checks, in report order. Reads only local state; never the network. */
export function runDoctor(paths: Paths, env: DoctorEnv): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, fix: string, notOk: DoctorSeverity = "fixable") =>
    checks.push(ok ? { id, label, severity: "ok", detail } : { id, label, severity: notOk, detail, fix });

  add("platform", "Platform", env.platform === "linux" && env.arch === "x64", `${env.platform} ${env.arch}`, "Revamp 1.x ships for Linux x86_64", "broken");

  if (env.fileExists(join(paths.data, "gui", "revamp-gui"))) {
    add(
      "glibc",
      "glibc (window)",
      env.glibc === undefined || glibcAtLeast(env.glibc, WINDOW_GLIBC),
      env.glibc ?? "unknown (process.report unavailable)",
      `The window needs glibc ${WINDOW_GLIBC} or newer (Ubuntu 24.04, Linux Mint 22 or newer)`,
      "broken",
    );
    const webkit = env.sharedLibs().some((l) => l.includes("libwebkit2gtk-4.1.so.0"));
    add("webkitgtk", "WebKitGTK 4.1 (window)", webkit, webkit ? "libwebkit2gtk-4.1.so.0 found" : "libwebkit2gtk-4.1.so.0 not found", "sudo apt install libwebkit2gtk-4.1-0");
  }

  const restricted = env.readFile(SYSCTL_PATH)?.trim() === "1";
  checks.push({
    id: "userns",
    label: "User namespaces",
    severity: "ok",
    detail: restricted ? "restricted (kernel.apparmor_restrict_unprivileged_userns=1)" : "unrestricted",
  });
  if (restricted) {
    for (const { appId } of listInstalls(paths)) {
      const id = `sandbox-${appId}`;
      const label = `Sandbox profile for ${appId}`;
      let names: string[];
      try {
        names = sandboxProfileNames(paths, appId, env);
      } catch (e) {
        checks.push({ id, label, severity: "fixable", detail: `unsafe name: ${(e as Error).message}` });
        continue;
      }
      const found = names.find((n) => env.fileExists(join(PROFILE_DIR, n)));
      add(
        id,
        label,
        found !== undefined,
        found !== undefined
          ? `${join(PROFILE_DIR, found)} present (whether it's loaded needs root to read; revamp sandbox ${appId} reloads it)`
          : `${join(PROFILE_DIR, names[0]!)} missing`,
        `revamp sandbox ${appId}`,
      );
    }
  }

  const bin = join(env.home, ".local/bin");
  add("path", "~/.local/bin on PATH", onPath(env.pathEntries, bin), onPath(env.pathEntries, bin) ? bin : `${bin} is not on PATH`, "Add ~/.local/bin to your PATH");

  const timer = env.timer();
  add(
    "timer",
    "Daily check",
    timer === undefined || (timer.enabled && timer.active),
    !timer
      ? "unknown (no systemctl)"
      : timer.enabled && timer.active
        ? `last run ${timer.lastTrigger ?? "never"}, next ${timer.nextElapse ?? "unknown"}`
        : timer.enabled
          ? "enabled but not active"
          : "not enabled",
    "revamp timer enable",
  );

  let sources: { location: string; name: string; version: string }[] = [];
  let sourcesError: string | undefined;
  try {
    sources = loadSources(paths);
  } catch (e) {
    sourcesError = (e as Error).message;
  }
  const check = loadLastCheck(paths);
  add(
    "sources",
    "Bundle sources",
    sources.length > 0,
    sourcesError ?? (sources.length === 0 ? "none added" : [...sources.map((s) => `${s.location} ${s.name} ${s.version}`), check ? `last check ${check.checkedAt}` : "never checked"].join("\n")),
    "revamp sources add xb00tt/revamp-patches",
  );

  const apps = listInstalls(paths);
  checks.push({ id: "apps", label: "Revamped apps", severity: "ok", detail: apps.length ? apps.map((a) => `${a.appId} ${a.current ?? "(no current version)"}`).join("\n") : "none yet" });
  return checks;
}

/** 2 if any check is broken, else 1 if any is fixable, else 0. */
export function doctorExitCode(checks: DoctorCheck[]): 0 | 1 | 2 {
  return checks.some((c) => c.severity === "broken") ? 2 : checks.some((c) => c.severity === "fixable") ? 1 : 0;
}
