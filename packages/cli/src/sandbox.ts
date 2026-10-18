// revamp sandbox <app> (spec M6): the AppArmor profile an app in the home folder needs on Ubuntu 24.04+.
// The scripts that run as root are only ever the engine's installHelper/removeHelper output, piped to pkexec on stdin.
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_DIR, sandboxProfileNames, type Paths, type SandboxProfileEnv } from "@revamp-app/engine";

export type Spawn = (cmd: string, args: string[], input?: string) => { status: number | null; stdout: string; stderr: string };
export interface PromptEnv {
  DISPLAY?: string;
  WAYLAND_DISPLAY?: string;
  REVAMP_PKEXEC?: string;
}

const PKEXEC = "/usr/bin/pkexec";
/**
 * Always the absolute /usr/bin/pkexec, never a PATH lookup. REVAMP_PKEXEC is a test seam that swaps in another program
 * the user runs as themselves (a fake that logs its input): it is no way to root, which only the real pkexec gives.
 */
export const pkexecPath = (env: Pick<PromptEnv, "REVAMP_PKEXEC"> = process.env): string => env.REVAMP_PKEXEC || PKEXEC;

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** pkexec is installed and a display is set. */
export function canPrompt(env: PromptEnv, exists: (path: string) => boolean = isExecutable): boolean {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY) && exists(pkexecPath(env));
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
export function runAsRoot(script: string, spawn: Spawn = realSpawn): { ok: boolean; status: number | null; output: string } {
  const r = spawn(pkexecPath(), ["/bin/sh", "-s"], script);
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
