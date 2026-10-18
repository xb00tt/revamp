import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPrivateDataDir,
  installedExecutable,
  installHelper,
  profileName,
  profilePattern,
  profileText,
  PROFILE_DIR,
  realSandboxEnv,
  removeHelper,
  sandboxProfileNames,
  userNamespacesRestricted,
} from "../src/sandbox-profile.ts";
import { revampPaths } from "../src/paths.ts";

// The homes here live under the system's /tmp, which assertPrivateDataDir refuses: the seam makes it stop there.
process.env.REVAMP_TRUSTED_ROOT = tmpdir();
/** Sets REVAMP_TRUSTED_ROOT (undefined removes it) until the test ends. */
const trustedRoot = (t: { after(fn: () => void): void }, value: string | undefined) => {
  t.after(() => (process.env.REVAMP_TRUSTED_ROOT = tmpdir()));
  if (value === undefined) delete process.env.REVAMP_TRUSTED_ROOT;
  else process.env.REVAMP_TRUSTED_ROOT = value;
};

const tmp = () => mkdtempSync(join(tmpdir(), "revamp-sbx-"));
/** assert.throws' validator for an error whose message holds `text` (a plain substring: paths hold regex characters, and the walk names real paths). */
const mentions = (text: string) => (e: unknown) => e instanceof Error && e.message.includes(text);
const DATA = "/home/a/.local/share/revamp";

test("userNamespacesRestricted reads the sysctl file", () => {
  const dir = tmp();
  const file = join(dir, "restrict");
  writeFileSync(file, "1\n");
  assert.equal(userNamespacesRestricted(file), true);
  writeFileSync(file, "0\n");
  assert.equal(userNamespacesRestricted(file), false);
  assert.equal(userNamespacesRestricted(join(dir, "missing")), false);
});

test("profileName suffixes the uid only when another user's profile exists", () => {
  assert.equal(profileName("hydra", undefined, DATA, 1000), "revamp-hydra");
  assert.equal(profileName("hydra", `profile revamp-hydra "${DATA}/apps/hydra/*/hydralauncher" {}`, DATA, 1000), "revamp-hydra");
  assert.equal(profileName("hydra", `${DATA}/apps/hydra/*/hydralauncher`, DATA, 1000), "revamp-hydra");
  assert.equal(profileName("hydra", `profile revamp-hydra "/home/b/.local/share/revamp/apps/hydra/*/hydralauncher" {}`, DATA, 1000), "revamp-hydra-u1000");
  // a shorter data dir must not match inside another user's longer path
  assert.equal(profileName("hydra", `"/home/a/.local/share/revamp/apps/hydra/*/h"`, "/a/.local/share/revamp", 7), "revamp-hydra-u7");
  assert.throws(() => profileName("../hydra", undefined, DATA, 1000), /unsafe app id/);
});

test("profileName counts the v1 doc's /home/* profile as this user's when the data dir is the default one under /home", () => {
  const glob = `profile revamp-hydra "/home/*/.local/share/revamp/apps/hydra/*/hydralauncher" flags=(unconfined) {`;
  assert.equal(profileName("hydra", glob, DATA, 1000), "revamp-hydra");
  assert.equal(profileName("hydra", glob, "/srv/a/revamp", 1000), "revamp-hydra-u1000"); // the glob doesn't cover this data dir
  assert.equal(profileName("hydra", glob, "/home/a/data/revamp", 1000), "revamp-hydra-u1000");
  assert.equal(profileName("hydra", glob.replace("hydra/*", "heroic/*"), DATA, 1000), "revamp-hydra-u1000"); // another app's glob
});

test("profilePattern joins the data dir, app and executable", () => {
  assert.equal(profilePattern(DATA, "hydra", "hydralauncher"), `${DATA}/apps/hydra/*/hydralauncher`);
  assert.equal(profilePattern(DATA, "heroic", "bin/heroic"), `${DATA}/apps/heroic/*/bin/heroic`);
  assert.throws(() => profilePattern(DATA, "hydra", "../evil"), /unsafe executable/);
  assert.throws(() => profilePattern(DATA, "../hydra", "x"), /unsafe app id/);
  assert.throws(() => profilePattern("home/a/revamp", "hydra", "hydralauncher"), /unsupported data path/); // AppArmor attaches by absolute path
});

const profile = (name: string, pattern: string) =>
  `abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile ${name} "${pattern}" flags=(unconfined) {\n  userns,\n  include if exists <local/${name}>\n}`;

test("profileText is the exact profile and quotes a path with a space", () => {
  const pattern = profilePattern(DATA, "hydra", "hydralauncher");
  assert.equal(profileText("revamp-hydra", pattern), profile("revamp-hydra", pattern));
  const spaced = profilePattern("/home/me/My Data/revamp", "hydra", "hydralauncher");
  assert.equal(profileText("revamp-hydra", spaced), profile("revamp-hydra", spaced));
});

test("profileText refuses a quote, a newline, a control character or a backslash", () => {
  for (const bad of ['/home/"x/apps/hydra/*/h', "/home/x\n}/apps/hydra/*/h", "/home/x\0/apps", "/home/x\t/apps", "/home/x\\/apps"]) {
    assert.throws(() => profileText("revamp-hydra", bad), /unsupported data path/);
  }
  assert.throws(() => profileText("revamp hydra", "/x"), /unsafe profile name/);
});

test("profileText refuses AppArmor glob characters in the data dir but keeps the version wildcard", () => {
  for (const dir of ["/home/x*", "/home/x?", "/home/x[a]", "/home/x]", "/home/x{a,b}", "/home/x}", "/home/x^", "/home/*"]) {
    assert.throws(() => profileText("revamp-hydra", profilePattern(dir, "hydra", "hydralauncher")), /unsupported data path/, dir);
  }
  assert.throws(() => profileText("revamp-hydra", "/home/x*"), /unsupported data path/);
  assert.doesNotThrow(() => profileText("revamp-hydra", profilePattern(DATA, "hydra", "bin/heroic")));
});

const header = "#!/bin/sh\nset -eu\numask 022\n";

test("installHelper writes the file beside its place, parse-checks it, then moves it over and reloads; failures exit 3", () => {
  const text = profileText("revamp-hydra", profilePattern(DATA, "hydra", "hydralauncher"));
  assert.equal(
    installHelper("revamp-hydra", text),
    `${header}trap "rm -f '/etc/apparmor.d/revamp-hydra.new'" EXIT\n` +
      `trap 'exit 3' HUP INT QUIT TERM\n` +
      `cat > '/etc/apparmor.d/revamp-hydra.new' <<'REVAMP_PROFILE' || exit 3\n${text}\nREVAMP_PROFILE\n` +
      `apparmor_parser -Q -K '/etc/apparmor.d/revamp-hydra.new' || exit 3\n` +
      `mv -f '/etc/apparmor.d/revamp-hydra.new' '/etc/apparmor.d/revamp-hydra' || exit 3\n` +
      `apparmor_parser -r '/etc/apparmor.d/revamp-hydra' || exit 3\n`,
  );
});

test("installHelper refuses a profile that could end the heredoc early or a name that is not a plain name", () => {
  assert.throws(() => installHelper("revamp-hydra", "x\nREVAMP_PROFILE\nrm -rf /"), /REVAMP_PROFILE/);
  assert.throws(() => installHelper("../x'; rm", "x"), /unsafe profile name/);
  assert.throws(() => removeHelper("a b"), /unsafe profile name/);
  // the root-run helpers only touch Revamp-owned profiles
  assert.throws(() => installHelper("hydra", "x"), /profile name must start with "revamp-": hydra/);
  assert.throws(() => removeHelper("hydra"), /profile name must start with "revamp-": hydra/);
  assert.throws(() => removeHelper("revamp-"), /profile name must start with "revamp-"/);
});

test("the helpers refuse a name ending in .new: its temp file would be another app's profile", () => {
  // app id "hydra.new" is a valid name, and its profile revamp-hydra.new is the temp file of revamp-hydra's
  const rule = /profile name must not end in "\.new": revamp-hydra\.new/;
  assert.throws(() => installHelper("revamp-hydra.new", "x"), rule);
  assert.throws(() => removeHelper("revamp-hydra.new"), rule);
  assert.throws(() => removeHelper(["revamp-hydra", "revamp-hydra.new"]), rule);
  // other dots, and ".new" inside a name, are fine
  assert.match(installHelper("revamp-hydra.new2", "x"), /'\/etc\/apparmor\.d\/revamp-hydra\.new2\.new'/);
  assert.match(removeHelper("revamp-my.new-app"), /'\/etc\/apparmor\.d\/revamp-my\.new-app'/);
  assert.match(removeHelper("revamp-hydra-u1000"), /'\/etc\/apparmor\.d\/revamp-hydra-u1000'/);
});

test("removeHelper unloads, then removes the file", () => {
  assert.equal(
    removeHelper("revamp-hydra"),
    `${header}apparmor_parser -R '/etc/apparmor.d/revamp-hydra' || true\nrm -f '/etc/apparmor.d/revamp-hydra' '/etc/apparmor.d/revamp-hydra.new'\n`,
  );
});

test("removeHelper takes several names: one header, one unload and remove each", () => {
  assert.equal(removeHelper(["revamp-hydra"]), removeHelper("revamp-hydra"));
  assert.equal(
    removeHelper(["revamp-hydra", "revamp-hydra-bob"]),
    `${header}apparmor_parser -R '/etc/apparmor.d/revamp-hydra' || true\nrm -f '/etc/apparmor.d/revamp-hydra' '/etc/apparmor.d/revamp-hydra.new'\n` +
      `apparmor_parser -R '/etc/apparmor.d/revamp-hydra-bob' || true\nrm -f '/etc/apparmor.d/revamp-hydra-bob' '/etc/apparmor.d/revamp-hydra-bob.new'\n`,
  );
  assert.throws(() => removeHelper([]), /no profile/);
  assert.throws(() => removeHelper(["revamp-hydra", "hydra"]), /profile name must start with "revamp-": hydra/);
  assert.throws(() => removeHelper(["revamp-hydra", "revamp-a b"]), /unsafe profile name/);
});

test("removeHelper's second list is for a .new left without its profile: nothing to unload, only the rm", () => {
  assert.equal(removeHelper([], ["revamp-hydra"]), `${header}rm -f '/etc/apparmor.d/revamp-hydra.new'\n`);
  assert.equal(
    removeHelper("revamp-hydra", ["revamp-hydra-u7"]),
    `${header}apparmor_parser -R '/etc/apparmor.d/revamp-hydra' || true\nrm -f '/etc/apparmor.d/revamp-hydra' '/etc/apparmor.d/revamp-hydra.new'\n` +
      `rm -f '/etc/apparmor.d/revamp-hydra-u7.new'\n`,
  );
  assert.throws(() => removeHelper([], []), /no profile/);
  assert.throws(() => removeHelper([], ["hydra"]), /profile name must start with "revamp-": hydra/);
  assert.throws(() => removeHelper([], ["revamp-hydra.new"]), /profile name must not end in "\.new"/);
});

test("realSandboxEnv reads profiles from the given dir, other paths as they are", () => {
  const dir = tmp();
  writeFileSync(join(dir, "revamp-hydra"), "profile text");
  const other = join(tmp(), "other");
  writeFileSync(other, "elsewhere");
  const env = realSandboxEnv(dir);
  assert.equal(env.readFile(join(PROFILE_DIR, "revamp-hydra")), "profile text");
  assert.equal(env.fileExists(join(PROFILE_DIR, "revamp-hydra")), true);
  assert.equal(env.fileExists(join(PROFILE_DIR, "revamp-missing")), false);
  assert.equal(env.readFile(join(PROFILE_DIR, "revamp-missing")), undefined);
  assert.equal(env.readFile(other), "elsewhere");
  assert.equal(env.fileExists(other), true);
  assert.equal(env.fileExists(`${PROFILE_DIR}x/revamp-hydra`), false); // only /etc/apparmor.d/… is mapped, not a lookalike prefix
});

test("realSandboxEnv defaults to $REVAMP_PROFILE_DIR, then /etc/apparmor.d; the helpers always write /etc/apparmor.d", (t) => {
  const dir = tmp();
  const name = `revamp-test-${randomUUID()}`; // a name no real /etc/apparmor.d holds, so the default lookup finds nothing
  writeFileSync(join(dir, name), "x");
  writeFileSync(join(dir, "revamp-hydra"), "x");
  const saved = process.env.REVAMP_PROFILE_DIR;
  t.after(() => (saved === undefined ? delete process.env.REVAMP_PROFILE_DIR : (process.env.REVAMP_PROFILE_DIR = saved)));
  process.env.REVAMP_PROFILE_DIR = dir;
  assert.equal(realSandboxEnv().fileExists(join(PROFILE_DIR, name)), true);
  assert.equal(realSandboxEnv().uid, process.getuid!());
  const paths = revampPaths({ HOME: tmp() });
  assert.deepEqual(sandboxProfileNames(paths, "hydra", { ...realSandboxEnv(), uid: 7 }), ["revamp-hydra-u7", "revamp-hydra-u7"]); // the plain file is not ours
  assert.match(installHelper("revamp-hydra", "x"), /'\/etc\/apparmor\.d\/revamp-hydra'/);
  assert.doesNotMatch(removeHelper("revamp-hydra"), new RegExp(dir));
  process.env.REVAMP_PROFILE_DIR = "";
  assert.equal(realSandboxEnv().fileExists(join(PROFILE_DIR, name)), false); // empty means the default
  delete process.env.REVAMP_PROFILE_DIR;
  assert.equal(realSandboxEnv().fileExists(join(PROFILE_DIR, name)), false);
});

test("userNamespacesRestricted defaults to $REVAMP_SYSCTL_PATH outside the single executable", (t) => {
  const file = join(tmp(), "sysctl");
  writeFileSync(file, "1\n");
  const saved = process.env.REVAMP_SYSCTL_PATH;
  t.after(() => (saved === undefined ? delete process.env.REVAMP_SYSCTL_PATH : (process.env.REVAMP_SYSCTL_PATH = saved)));
  process.env.REVAMP_SYSCTL_PATH = file;
  assert.equal(userNamespacesRestricted(), true);
  writeFileSync(file, "0\n");
  assert.equal(userNamespacesRestricted(), false);
});

test("assertPrivateDataDir returns the real path of a dir only root and this user can change", () => {
  const home = tmp(); // mkdtemp makes it 0700
  const data = join(home, "data");
  mkdirSync(data, { mode: 0o755 });
  assert.equal(assertPrivateDataDir(data), realpathSync(data));
  // a symlinked XDG_DATA_HOME: AppArmor attaches by the canonical path
  const link = join(tmp(), "link");
  symlinkSync(data, link);
  assert.equal(assertPrivateDataDir(link), realpathSync(data));
  // not created yet: judged by what exists above it
  assert.equal(assertPrivateDataDir(join(data, "missing/revamp")), join(data, "missing/revamp"));
  assert.throws(() => assertPrivateDataDir("data/revamp"), /unsupported data path/);
});

test("assertPrivateDataDir refuses a dir another user could write or recreate", () => {
  const open = tmp();
  chmodSync(open, 0o777);
  const data = join(open, "revamp");
  mkdirSync(data, { mode: 0o755 });
  chmodSync(data, 0o755);
  assert.throws(() => assertPrivateDataDir(data), mentions(`unsafe data path ${data}: ${realpathSync(open)} is writable by other users`));
  assert.throws(() => assertPrivateDataDir(join(open, "missing")), /is writable by other users/);
  chmodSync(open, 0o700);
  chmodSync(data, 0o777);
  assert.throws(() => assertPrivateDataDir(data), mentions(`${realpathSync(data)} is writable by other users`)); // the dir itself
  chmodSync(data, 0o770);
  assert.throws(() => assertPrivateDataDir(data, process.getuid!(), -1), /is writable by other users/); // a group that isn't the user's own
  // owned by another user (seen as one by passing another uid)
  chmodSync(data, 0o755);
  assert.throws(() => assertPrivateDataDir(data, 123456), new RegExp(`is owned by ${process.getuid!()}$`));
});

test("assertPrivateDataDir refuses a dir under a sticky world-writable one: it gets wiped, and anyone may recreate the path", (t) => {
  const sticky = tmp();
  chmodSync(sticky, 0o1777);
  const data = join(sticky, "revamp");
  mkdirSync(data, { mode: 0o700 });
  trustedRoot(t, undefined);
  assert.throws(() => assertPrivateDataDir(data), mentions(`unsafe data path ${data}: ${realpathSync(sticky)} is writable by other users`));
  // the system's /tmp itself, when that is where the temp dirs are
  if ((statSync(tmpdir()).mode & 0o1002) === 0o1002) assert.throws(() => assertPrivateDataDir(tmp()), mentions(`: ${realpathSync(tmpdir())} is writable by other users`));
});

test("REVAMP_TRUSTED_ROOT (a test seam) stops the walk: that dir and the ones above it aren't judged", (t) => {
  const open = tmp();
  chmodSync(open, 0o777);
  const data = join(open, "revamp");
  mkdirSync(data, { mode: 0o700 });
  trustedRoot(t, open);
  assert.equal(assertPrivateDataDir(data), realpathSync(data));
  chmodSync(data, 0o777);
  assert.throws(() => assertPrivateDataDir(data), mentions(`: ${realpathSync(data)} is writable by other users`)); // below it, still judged
  chmodSync(data, 0o700);
  delete process.env.REVAMP_TRUSTED_ROOT;
  assert.throws(() => assertPrivateDataDir(data), /is writable by other users/);
});

test("assertPrivateDataDir allows a group-writable dir of the user's private group (umask 002)", { skip: process.getuid!() !== process.getgid!() && "this user's group id is not their user id" }, () => {
  const data = join(tmp(), "revamp");
  mkdirSync(data);
  chmodSync(data, 0o775);
  assert.equal(statSync(data).gid, process.getgid!());
  assert.equal(assertPrivateDataDir(data), realpathSync(data));
});

function withDesktop(exec?: (data: string) => string) {
  const paths = revampPaths({ HOME: tmp() });
  mkdirSync(paths.applications, { recursive: true });
  if (exec) writeFileSync(join(paths.applications, "revamp-hydra.desktop"), `[Desktop Entry]\nName=Hydra (Revamped)\nExec=${exec(paths.data)}\n`);
  return paths;
}

test("installedExecutable returns the path under current/, ignoring extra arguments", () => {
  assert.equal(installedExecutable(withDesktop((d) => `"${d}/apps/hydra/current/hydralauncher" %U`), "hydra"), "hydralauncher");
  assert.equal(installedExecutable(withDesktop((d) => `"${d}/apps/hydra/current/bin/heroic" --no-sandbox %U`), "hydra"), "bin/heroic");
});

test("installedExecutable unescapes the Exec quoting", () => {
  const q = revampPaths({ HOME: join(tmp(), "50%") });
  mkdirSync(q.applications, { recursive: true });
  writeFileSync(join(q.applications, "revamp-hydra.desktop"), `[Desktop Entry]\nExec="${q.data.replaceAll("%", "%%")}/apps/hydra/current/hydralauncher" %U\n`);
  assert.equal(installedExecutable(q, "hydra"), "hydralauncher");
});

test("installedExecutable refuses a path outside current/, a missing file and a missing Exec", () => {
  assert.throws(() => installedExecutable(withDesktop(() => '"/opt/Hydra/hydralauncher" %U'), "hydra"), /not under .*apps\/hydra\/current/);
  assert.throws(() => installedExecutable(withDesktop(() => "/opt/Hydra/hydralauncher %U"), "hydra"), /not under .*apps\/hydra\/current/);
  assert.throws(() => installedExecutable(withDesktop((d) => `"${d}/apps/hydra/current/../evil" %U`), "hydra"), /unsafe executable/);
  const p = withDesktop();
  assert.throws(() => installedExecutable(p, "hydra"), /hydra is not installed/);
  writeFileSync(join(p.applications, "revamp-hydra.desktop"), "[Desktop Entry]\nName=x\n");
  assert.throws(() => installedExecutable(p, "hydra"), /no Exec/);
});
