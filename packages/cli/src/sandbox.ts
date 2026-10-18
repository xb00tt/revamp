// revamp sandbox <app> (spec M6): the AppArmor profile an app in the home folder needs on Ubuntu 24.04+.
// The helper scripts run as root, so they are only ever the engine's installHelper/removeHelper output.
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_DIR, removeHelper, sandboxProfileNames, type Paths, type SandboxProfileEnv } from "@revamp-app/engine";

export type Spawn = (cmd: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
export interface PromptEnv {
  PATH?: string;
  DISPLAY?: string;
  WAYLAND_DISPLAY?: string;
}

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** pkexec is on PATH and a display is set. */
export function canPrompt(env: PromptEnv, exists: (path: string) => boolean = isExecutable): boolean {
  const display = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return display && (env.PATH ?? "").split(":").some((dir) => dir !== "" && exists(join(dir, "pkexec")));
}

/** Writes <paths.state>/sandbox/<name>.sh (0644) and returns its path. */
export function writeHelper(paths: Paths, name: string, script: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) || name.includes("..")) throw new Error(`unsafe helper name "${name}"`);
  const dir = join(paths.state, "sandbox");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.sh`);
  writeFileSync(file, script);
  chmodSync(file, 0o644); // writeFileSync's mode only applies to a new file, and not past the umask
  return file;
}

const realSpawn: Spawn = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
};

/** Runs `pkexec /bin/sh <helper>`. */
export function runAsRoot(helper: string, spawn: Spawn = realSpawn): { ok: boolean; status: number | null; output: string } {
  const r = spawn("pkexec", ["/bin/sh", helper]);
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
  const [computed, suffixed] = sandboxProfileNames(paths, appId, env) as [string, string];
  return present(env, suffixed) ? suffixed : computed;
}

/** This user's profiles for the app that are in /etc/apparmor.d, once each. */
export function existingProfileNames(paths: Paths, appId: string, env: SandboxProfileEnv): string[] {
  return [...new Set(sandboxProfileNames(paths, appId, env))].filter((n) => present(env, n));
}

/** One root script that removes each profile. */
export function removeAllHelper(names: string[]): string {
  // Each removeHelper starts with the same three header lines (shebang, set -eu, umask): keep the first set only.
  return names.map((n, i) => (i === 0 ? removeHelper(n) : removeHelper(n).split("\n").slice(3).join("\n"))).join("");
}
