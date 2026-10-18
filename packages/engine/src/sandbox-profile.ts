import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { parseDesktopEntry } from "./desktop.ts";
import { desktopFilePath } from "./install.ts";
import { appDir, assertSafeName, assertSafeRelativePath, type Paths } from "./paths.ts";

export const PROFILE_DIR = "/etc/apparmor.d";
export const SYSCTL_PATH = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/** true when the file reads "1"; false when "0" or missing (not an AppArmor system). */
export function userNamespacesRestricted(sysctlPath: string = SYSCTL_PATH): boolean {
  try {
    return readFileSync(sysctlPath, "utf8").trim() === "1";
  } catch {
    return false;
  }
}

/** "revamp-<appId>"; with `username` when an existing profile text names another path (a second user). */
export function profileName(appId: string, existing: string | undefined, dataDir: string, username: string): string {
  const base = `revamp-${assertSafeName("app id", appId)}`;
  if (existing === undefined) return base;
  const prefix = `${dataDir}/apps/${appId}/`;
  // Anchored on what precedes the path, so a short data dir doesn't match inside another user's longer one.
  const ours = existing.startsWith(prefix) || ['"', " ", "\n"].some((c) => existing.includes(c + prefix));
  return ours ? base : `${base}-${assertSafeName("user", username)}`;
}

/** What the profile lookups read from the machine, so tests supply a fake. */
export interface SandboxProfileEnv {
  readFile(path: string): string | undefined;
  fileExists(path: string): boolean;
  username: string;
}

/** The real machine; the username falls back to $USER when the user database can't be read. */
export function realSandboxEnv(): SandboxProfileEnv {
  let username = process.env.USER ?? "";
  try {
    username = userInfo().username;
  } catch {
    // keep $USER
  }
  return {
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    fileExists: existsSync,
    username,
  };
}

/** The profile names that count as this user's for an app: the plain one unless another user's profile holds it, and the suffixed one an earlier run may have used. Throws on an unsafe app id or username. */
export function sandboxProfileNames(paths: Paths, appId: string, env: Pick<SandboxProfileEnv, "readFile" | "username">): string[] {
  const base = `revamp-${assertSafeName("app id", appId)}`; // before any path is built from it
  assertSafeName("user", env.username);
  return [profileName(appId, env.readFile(join(PROFILE_DIR, base)), paths.data, env.username), `${base}-${env.username}`];
}

/** Whether this user's sandbox profile for the app is in /etc/apparmor.d (not whether it is loaded: that needs root). Throws on an unsafe app id or username. */
export function sandboxProfilePresent(paths: Paths, appId: string, env: SandboxProfileEnv): boolean {
  return sandboxProfileNames(paths, appId, env).some((n) => env.fileExists(join(PROFILE_DIR, n)));
}

/** The AppArmor path pattern: "<dataDir>/apps/<appId>/<any version>/<executable>". */
export function profilePattern(dataDir: string, appId: string, executable: string): string {
  return `${dataDir}/apps/${assertSafeName("app id", appId)}/*/${assertSafeRelativePath("executable", executable)}`;
}

/**
 * The profile file text. Throws `unsupported data path: …` on `"`, `\`, newline, control characters or AppArmor glob
 * characters (`* ? [ ] { } ^`) anywhere but the version wildcard `/*\/` that `profilePattern` puts before the executable.
 * No trailing newline: installHelper's heredoc adds it; add one when writing the text to a file.
 */
export function profileText(name: string, pattern: string): string {
  assertSafeName("profile name", name);
  // The executable can't hold "*" (assertSafeRelativePath), so the last "/*/" is the version wildcard; judge the rest.
  const at = pattern.lastIndexOf("/*/");
  const rest = at < 0 ? pattern : pattern.slice(0, at) + pattern.slice(at + 2);
  if (/["\\*?[\]{}^\u0000-\u001f\u007f]/.test(rest)) throw new Error(`unsupported data path: ${JSON.stringify(pattern)}`);
  return [
    "abi <abi/4.0>,",
    "include <tunables/global>",
    "",
    `profile ${name} "${pattern}" flags=(unconfined) {`,
    "  userns,",
    `  include if exists <local/${name}>`,
    "}",
  ].join("\n");
}

const HEADER = "#!/bin/sh\nset -eu\numask 022\n";
/** Where a root-run helper may write: only Revamp-owned profiles, never another package's. */
function profilePath(name: string): string {
  assertSafeName("profile name", name);
  if (!/^revamp-[A-Za-z0-9._+-]+$/.test(name)) throw new Error(`profile name must start with "revamp-": ${name}`);
  return `${PROFILE_DIR}/${name}`;
}

/** sh script, run as root: write the profile beside its place, move it over, reload it. */
export function installHelper(name: string, text: string): string {
  if (text.split("\n").includes("REVAMP_PROFILE")) throw new Error("the profile text would end the script's heredoc (REVAMP_PROFILE)");
  const path = profilePath(name);
  return (
    `${HEADER}cat > '${path}.new' <<'REVAMP_PROFILE'\n${text}\nREVAMP_PROFILE\n` +
    `mv -f '${path}.new' '${path}'\napparmor_parser -r '${path}'\n`
  );
}

/** sh script, run as root: unload the profile, then delete its file. */
export function removeHelper(name: string): string {
  const path = profilePath(name);
  return `${HEADER}apparmor_parser -R '${path}' || true\nrm -f '${path}'\n`;
}

export function profileFileExists(name: string, dir: string = PROFILE_DIR): boolean {
  return existsSync(join(dir, assertSafeName("profile name", name)));
}

/** Reads revamp-<appId>.desktop's Exec, returns the executable path relative to <dataDir>/apps/<appId>/current/, or throws. */
export function installedExecutable(paths: Paths, appId: string): string {
  const desktop = desktopFilePath(paths, appId);
  let text: string;
  try {
    text = readFileSync(desktop, "utf8");
  } catch {
    throw new Error(`${appId} is not installed (no ${desktop})`);
  }
  const exec = parseDesktopEntry(text).Exec;
  if (!exec) throw new Error(`${desktop} has no Exec line`);
  // First word: quoted (Revamp's own entries) or bare (hand-edited); extra arguments are ignored.
  const word = /^"((?:\\.|[^"\\])*)"/.exec(exec)?.[1] ?? exec.split(/\s/)[0]!;
  // install.ts today refuses `"`, a backtick, `$` and `\` in install paths and writes `%` raw, so this unescape is for
  // hand-edited entries and the spec's `%%` form.
  const path = word.replace(/\\(["`$\\])|%%/g, (_, c?: string) => c ?? "%");
  const prefix = `${join(appDir(paths, appId), "current")}/`;
  if (!path.startsWith(prefix)) throw new Error(`the Exec path ${path} in ${desktop} is not under ${prefix}`);
  return assertSafeRelativePath("executable", path.slice(prefix.length));
}
