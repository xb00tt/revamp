import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";
import { loadSources } from "./bundle-sources.ts";
import { listInstalls, type InstalledApp } from "./install.ts";
import type { Paths } from "./paths.ts";
import { PROFILE_DIR, realSandboxEnv, sandboxProfileNames, SYSCTL_PATH, type SandboxProfileEnv } from "./sandbox-profile.ts";
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
export interface DoctorEnv extends SandboxProfileEnv {
  platform: string;
  arch: string;
  glibc?: string;
  /** `ldconfig -p` lines; [] when unavailable. */
  sharedLibs(): string[];
  /** undefined = no systemctl. */
  timer(): { enabled: boolean; active: boolean; lastTrigger?: string; nextElapse?: string } | undefined;
  pathEntries: string[];
  home: string;
}

/** The window is built on glibc 2.39; the CLI's own floor is Node's. */
export const WINDOW_GLIBC = "2.39";

/** Whether `dir` is one of the PATH entries, ignoring trailing slashes. */
export const onPath = (entries: string[], dir: string) => entries.some((e) => e.replace(/\/+$/, "") === dir.replace(/\/+$/, ""));

/** The timer fields out of `systemctl show -p ActiveState -p LastTriggerUSec -p NextElapseUSecRealtime -p UnitFileState`. */
export function parseTimerShow(stdout: string): { enabled: boolean; active: boolean; lastTrigger?: string; nextElapse?: string } {
  const v: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) v[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  const time = (s?: string) => (s && s !== "n/a" ? s : undefined);
  return {
    enabled: v.UnitFileState === "enabled",
    active: v.ActiveState === "active",
    lastTrigger: time(v.LastTriggerUSec),
    nextElapse: time(v.NextElapseUSecRealtime),
  };
}

function glibcVersion(): string | undefined {
  try {
    return (process.report.getReport() as unknown as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  } catch {
    return undefined; // no report: glibc stays unknown
  }
}

/** The only place doctor reads the machine. Nothing runs until a check asks (glibc and the two commands are lazy). */
export function realDoctorEnv(): DoctorEnv {
  // A missing binary, a non-zero exit or a hang all mean "unavailable".
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    return r.error || r.status !== 0 ? undefined : r;
  };
  let home = process.env.HOME ?? "";
  try {
    home ||= userInfo().homedir;
  } catch {
    // keep ""
  }
  return {
    ...realSandboxEnv(),
    platform: process.platform,
    arch: process.arch,
    get glibc() {
      return glibcVersion();
    },
    sharedLibs: () => (run("ldconfig", ["-p"]) ?? run("/sbin/ldconfig", ["-p"]))?.stdout.split("\n") ?? [],
    timer: () => {
      const r = run("systemctl", ["--user", "show", "revamp-check.timer", "-p", "ActiveState", "-p", "LastTriggerUSec", "-p", "NextElapseUSecRealtime", "-p", "UnitFileState"]);
      return r && parseTimerShow(r.stdout);
    },
    pathEntries: (process.env.PATH ?? "").split(":"),
    home,
  };
}

/** Numeric major.minor comparison: "2.4" is older than "2.39". */
function glibcAtLeast(have: string, want: string): boolean {
  const [h1 = 0, h2 = 0] = have.split(".").map(Number);
  const [w1 = 0, w2 = 0] = want.split(".").map(Number);
  return h1 > w1 || (h1 === w1 && h2 >= w2);
}

/** The checks, in report order. Reads only local state; never the network. */
export function runDoctor(paths: Paths, env: DoctorEnv): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  let apps: InstalledApp[] = [];
  let appsError: string | undefined;
  try {
    apps = listInstalls(paths);
  } catch (e) {
    appsError = (e as Error).message;
  }
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
    for (const { appId } of apps) {
      const id = `sandbox-${appId}`;
      const label = `Sandbox profile for ${appId}`;
      let names: readonly string[];
      try {
        names = sandboxProfileNames(paths, appId, env);
      } catch (e) {
        checks.push({ id, label, severity: "fixable", detail: (e as Error).message });
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

  try {
    const sources = loadSources(paths).filter(Boolean); // a hand-edited file may hold nulls
    const check = loadLastCheck(paths);
    add(
      "sources",
      "Bundle sources",
      sources.length > 0,
      sources.length === 0
        ? "none added"
        : [...sources.map((s) => `${s.location} ${s.name} ${s.version}`), check?.checkedAt ? `last check ${check.checkedAt}` : "never checked"].join("\n"),
      "revamp sources add xb00tt/revamp-patches",
    );
  } catch (e) {
    checks.push({ id: "sources", label: "Bundle sources", severity: "fixable", detail: (e as Error).message, fix: `repair or remove ${join(paths.config, "sources.json")}` });
  }

  checks.push(
    appsError !== undefined
      ? { id: "apps", label: "Revamped apps", severity: "fixable", detail: `could not read installed apps: ${appsError}` }
      : { id: "apps", label: "Revamped apps", severity: "ok", detail: apps.length ? apps.map((a) => `${a.appId} ${a.current ?? "(no current version)"}`).join("\n") : "none yet" },
  );
  return checks;
}

/** 2 if any check is broken, else 1 if any is fixable, else 0. */
export function doctorExitCode(checks: DoctorCheck[]): 0 | 1 | 2 {
  return checks.some((c) => c.severity === "broken") ? 2 : checks.some((c) => c.severity === "fixable") ? 1 : 0;
}
