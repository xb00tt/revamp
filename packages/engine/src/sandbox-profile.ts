import { existsSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { isSea } from "node:sea";
import { parseDesktopEntry } from "./desktop.ts";
import { desktopFilePath } from "./install.ts";
import { appDir, assertSafeName, assertSafeRelativePath, type Paths } from "./paths.ts";

export const PROFILE_DIR = "/etc/apparmor.d";
export const SYSCTL_PATH = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/**
 * A test seam's value, read only when not running as the single executable: the profile lookup decides which file root
 * overwrites or removes, so a stray variable must never steer root in the shipped binary. Empty counts as unset.
 */
export function testSeam(name: "REVAMP_PROFILE_DIR" | "REVAMP_PKEXEC" | "REVAMP_SYSCTL_PATH", env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (!isSea() && env[name]) || undefined;
}

/** true when the file reads "1"; false when "0" or missing (not an AppArmor system). Default: $REVAMP_SYSCTL_PATH (a test seam), else the sysctl. */
export function userNamespacesRestricted(sysctlPath: string = testSeam("REVAMP_SYSCTL_PATH") ?? SYSCTL_PATH): boolean {
  try {
    return readFileSync(sysctlPath, "utf8").trim() === "1";
  } catch {
    return false;
  }
}

/**
 * "revamp-<appId>"; "revamp-<appId>-u<uid>" when an existing profile text names another path (a second user).
 * `dataDir` is the resolved one (assertPrivateDataDir). The v1 doc's hand-written `/home/*` profile counts as this user's
 * when the data dir is the default one under /home, so it doesn't get a second profile for the same path.
 */
export function profileName(appId: string, existing: string | undefined, dataDir: string, uid: number): string {
  const base = `revamp-${assertSafeName("app id", appId)}`;
  if (existing === undefined) return base;
  // Anchored on what precedes the path, so a short data dir doesn't match inside another user's longer one.
  const names = (dir: string) => existing.startsWith(`${dir}/apps/${appId}/`) || ['"', " ", "\n"].some((c) => existing.includes(`${c}${dir}/apps/${appId}/`));
  const ours = names(dataDir) || (/^\/home\/[^/]+\/\.local\/share\/revamp$/.test(dataDir) && names("/home/*/.local/share/revamp"));
  return ours ? base : `${base}-u${uid}`;
}

/** What the profile lookups read from the machine, so tests supply a fake. */
export interface SandboxProfileEnv {
  readFile(path: string): string | undefined;
  fileExists(path: string): boolean;
  /** This user's uid: the suffix of a second user's profile name. */
  uid: number;
}

/**
 * The real machine. `profileDir` (default $REVAMP_PROFILE_DIR, a test seam, else /etc/apparmor.d) is where reads of
 * /etc/apparmor.d/<file> look instead: for reading only. installHelper/removeHelper keep the PROFILE_DIR constant, so the
 * knob can never move where root writes.
 */
export function realSandboxEnv(profileDir: string = testSeam("REVAMP_PROFILE_DIR") ?? PROFILE_DIR): SandboxProfileEnv {
  const at = (path: string) => (path.startsWith(`${PROFILE_DIR}/`) ? join(profileDir, path.slice(PROFILE_DIR.length + 1)) : path);
  return {
    readFile: (path) => {
      try {
        return readFileSync(at(path), "utf8");
      } catch {
        return undefined;
      }
    },
    fileExists: (path) => existsSync(at(path)),
    uid: process.getuid!(),
  };
}

/**
 * The data dir's real path (AppArmor attaches by canonical path), refused when another local user could put files there
 * (sshd StrictModes style): it and every dir above it must be owned by root or this user and not writable by others.
 * A sticky dir (/tmp) may be writable by others above a child that exists, since only its owner can rename or remove it;
 * a part that doesn't exist yet counts as writable by whoever may write the dir above it.
 */
export function assertPrivateDataDir(dir: string, uid: number = process.getuid!(), gid: number = process.getgid!()): string {
  if (!isAbsolute(dir)) throw new Error(`unsupported data path: ${JSON.stringify(dir)}`);
  let real = dir;
  try {
    real = realpathSync(dir);
  } catch {
    // not created yet: judged by what exists above it
  }
  let child: Stats | undefined; // the part below `d`, when it exists
  for (let d = real; ; d = dirname(d)) {
    let st: Stats | undefined;
    try {
      st = statSync(d);
    } catch {
      // missing
    }
    if (st) {
      if (st.uid !== 0 && st.uid !== uid) throw new Error(`unsafe data path ${dir}: ${d} is owned by ${st.uid}`);
      // ponytail: group write is fine for the user's private group (gid == uid, Ubuntu's umask 002); telling whether
      // anyone else is in that group needs /etc/group. Upgrade path: read its members.
      const others = (st.mode & 0o002) !== 0 || ((st.mode & 0o020) !== 0 && !(st.gid === uid && gid === uid));
      if (others && !((st.mode & 0o1000) !== 0 && child)) throw new Error(`unsafe data path ${dir}: ${d} is writable by other users`);
    }
    if (d === "/") return real;
    child = st;
  }
}

/**
 * The profile names that count as this user's for an app: the plain one unless another user's profile holds it, and the
 * suffixed one an earlier run may have used. Throws on an unsafe app id or data dir.
 */
export function sandboxProfileNames(paths: Paths, appId: string, env: Pick<SandboxProfileEnv, "readFile" | "uid">): readonly [computed: string, suffixed: string] {
  const base = `revamp-${assertSafeName("app id", appId)}`; // before any path is built from it
  const data = assertPrivateDataDir(paths.data);
  return [profileName(appId, env.readFile(join(PROFILE_DIR, base)), data, env.uid), `${base}-u${env.uid}`];
}

/** Whether this user's sandbox profile for the app is in /etc/apparmor.d (not whether it is loaded: that needs root). Throws on an unsafe app id or data dir. */
export function sandboxProfilePresent(paths: Paths, appId: string, env: SandboxProfileEnv): boolean {
  return sandboxProfileNames(paths, appId, env).some((n) => env.fileExists(join(PROFILE_DIR, n)));
}

/** The AppArmor path pattern: "<dataDir>/apps/<appId>/<any version>/<executable>". The data dir must be absolute. */
export function profilePattern(dataDir: string, appId: string, executable: string): string {
  if (!isAbsolute(dataDir)) throw new Error(`unsupported data path: ${JSON.stringify(dataDir)}`);
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

/**
 * sh script, run as root: write the profile beside its place, parse-check it without loading, move it over, reload it.
 * A file that doesn't parse never reaches /etc/apparmor.d (the boot would retry it forever), and the trap removes the
 * `.new` file on every way out. Each failure exits 3, never pkexec's own 126 (dismissed) or 127.
 */
export function installHelper(name: string, text: string): string {
  if (text.split("\n").includes("REVAMP_PROFILE")) throw new Error("the profile text would end the script's heredoc (REVAMP_PROFILE)");
  const path = profilePath(name);
  return (
    `${HEADER}trap "rm -f '${path}.new'" EXIT\n` +
    `cat > '${path}.new' <<'REVAMP_PROFILE' || exit 3\n${text}\nREVAMP_PROFILE\n` +
    `apparmor_parser -Q -K '${path}.new' || exit 3\n` +
    `mv -f '${path}.new' '${path}' || exit 3\n` +
    `apparmor_parser -r '${path}' || exit 3\n`
  );
}

/** sh script, run as root: unload each profile, then delete its file. */
export function removeHelper(names: string | string[]): string {
  const list = typeof names === "string" ? [names] : names;
  if (list.length === 0) throw new Error("no profile to remove");
  return HEADER + list.map((name) => profilePath(name)).map((path) => `apparmor_parser -R '${path}' || true\nrm -f '${path}'\n`).join("");
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
