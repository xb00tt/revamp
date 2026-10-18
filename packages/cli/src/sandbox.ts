// revamp sandbox <app> (spec M6): the AppArmor profile an app in the home folder needs on Ubuntu 24.04+.
// The scripts that run as root are only ever the engine's installHelper/removeHelper output, piped to pkexec on stdin.
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installedExecutable, installHelper, PROFILE_DIR, profilePattern, profileText, realSandboxEnv, sandboxProfileNames, type Paths, type SandboxProfileEnv } from "@revamp-app/engine";

export type Spawn = (cmd: string, args: string[], input?: string) => { status: number | null; stdout: string; stderr: string };
export interface PromptEnv {
  DISPLAY?: string;
  WAYLAND_DISPLAY?: string;
}

const PKEXEC = "/usr/bin/pkexec";
/**
 * Always the absolute /usr/bin/pkexec, never a PATH lookup. REVAMP_PKEXEC is a test seam that swaps in another program
 * the user runs as themselves (a fake that logs its input): it is no way to root, which only the real pkexec gives.
 */
export const pkexecPath = (env: { REVAMP_PKEXEC?: string } = process.env): string => env.REVAMP_PKEXEC || PKEXEC;

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** `pkexec` (from pkexecPath) is installed and a display is set. Pass the same path to runAsRoot. */
export function canPrompt(env: PromptEnv, pkexec: string, exists: (path: string) => boolean = isExecutable): boolean {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY) && exists(pkexec);
}

/**
 * Writes <paths.state>/sandbox/<name>.sh (0644) and returns its path. Only for the sudo fallback, which the user
 * runs and reads themselves: nothing that root runs through pkexec is read from a file the user can change.
 */
export function writeHelper(paths: Paths, name: string, script: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) || name.includes("..")) throw new Error(`unsafe helper name "${name}"`);
  const dir = join(paths.state, "sandbox");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.sh`);
  writeFileSync(file, script);
  chmodSync(file, 0o644); // writeFileSync's mode only applies to a new file, and not past the umask
  return file;
}

const realSpawn: Spawn = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", input });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
};

/** Runs the script as root: `pkexec /bin/sh -s` with the script on its standard input. */
export function runAsRoot(script: string, spawn: Spawn = realSpawn, pkexec: string = pkexecPath()): { ok: boolean; status: number | null; output: string } {
  const r = spawn(pkexec, ["/bin/sh", "-s"], script);
  return { ok: r.status === 0, status: r.status, output: `${r.stdout}${r.stderr}`.trim() };
}

export const sudoInstructions = (helper: string): string => `Run it with sudo instead:\n  sudo sh ${helper}`;

const present = (env: SandboxProfileEnv, name: string) => env.fileExists(join(PROFILE_DIR, name));

/**
 * The name `revamp sandbox` installs under. This user's suffixed profile, if one exists, is reused: choosing the plain
 * name beside it would put two profiles on the same path. Otherwise the engine's computed name.
 * Throws on an unsafe app id or username.
 */
export function chooseProfileName(paths: Paths, appId: string, env: SandboxProfileEnv): string {
  const [computed, suffixed] = sandboxProfileNames(paths, appId, env);
  return present(env, suffixed) ? suffixed : computed;
}

/** This user's profiles for the app that are in /etc/apparmor.d, once each. */
export function existingProfileNames(paths: Paths, appId: string, env: SandboxProfileEnv): string[] {
  return [...new Set(sandboxProfileNames(paths, appId, env))].filter((n) => present(env, n));
}

/** pkexec exits 126 when the prompt is dismissed and 127 when authorization fails. */
export const cancelled = (r: { status: number | null }): boolean => r.status === 126 || r.status === 127;
export const pkexecFailed = (r: { status: number | null; output: string }, sudo: string): string =>
  `pkexec failed (exit ${r.status ?? "none"})${r.output ? `: ${r.output}` : ""}\n${sudo}`;

export interface ProfilePlan {
  name: string;
  /** Where root writes it. */
  file: string;
  /** What root runs, from the engine's installHelper. */
  script: string;
  /** Writes the helper file for the user's own sudo and returns the instructions; only call it when that is the way out. */
  sudo(): string;
}

/** What `revamp sandbox <app>` and the window's fix button both install. Throws when the app isn't installed. */
export function planProfile(paths: Paths, appId: string, env: SandboxProfileEnv = realSandboxEnv()): ProfilePlan {
  const exe = installedExecutable(paths, appId);
  const name = chooseProfileName(paths, appId, env);
  const script = installHelper(name, profileText(name, profilePattern(paths.data, appId, exe)));
  // pkexec gets the script on its stdin; the helper file is only for the user's own sudo.
  return { name, file: `${PROFILE_DIR}/${name}`, script, sudo: () => sudoInstructions(writeHelper(paths, name, script)) };
}

/** Runs the plan through pkexec. undefined when it worked, else what to tell the user. */
export function applyProfile(plan: ProfilePlan, pkexec: string = pkexecPath()): string | undefined {
  const r = runAsRoot(plan.script, undefined, pkexec);
  if (r.ok) return undefined;
  return cancelled(r) ? "The administrator prompt was cancelled; nothing changed." : pkexecFailed(r, plan.sudo());
}
