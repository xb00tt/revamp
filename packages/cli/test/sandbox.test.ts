import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revampPaths, type Paths, type SandboxProfileEnv } from "@revamp-app/engine";
import { applyProfile, canPrompt, chooseProfileName, existingProfileNames, pkexecPath, planProfile, runAsRoot, sudoInstructions, writeHelper } from "../src/sandbox.ts";

// No test here may look at the machine's /etc/apparmor.d or reach the real pkexec.
process.env.REVAMP_PROFILE_DIR = mkdtempSync(join(tmpdir(), "revamp-sandbox-profiles-"));
process.env.REVAMP_PKEXEC = "/nonexistent/pkexec";
process.env.REVAMP_TRUSTED_ROOT = tmpdir(); // the homes live under the system's /tmp

const tempPaths = (o: Record<string, string> = {}) => revampPaths({ HOME: mkdtempSync(join(tmpdir(), "revamp-sandbox-")), XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "", ...o });
const PKEXEC = "/usr/bin/pkexec";

test("canPrompt needs the given pkexec to exist and a display", () => {
  const exists = (p: string) => p === PKEXEC;
  assert.equal(canPrompt({ DISPLAY: ":0" }, PKEXEC, exists), true);
  assert.equal(canPrompt({ WAYLAND_DISPLAY: "wayland-0" }, PKEXEC, exists), true);
  assert.equal(canPrompt({}, PKEXEC, exists), false);
  assert.equal(canPrompt({ DISPLAY: "" }, PKEXEC, exists), false);
  assert.equal(canPrompt({ DISPLAY: ":0" }, PKEXEC, () => false), false);
  assert.equal(canPrompt({ DISPLAY: ":0" }, "/tmp/bin/pkexec", exists), false); // the path it is given, not a PATH lookup
});

test("pkexecPath is /usr/bin/pkexec unless REVAMP_PKEXEC (a test seam) names another program", () => {
  assert.equal(pkexecPath({}), PKEXEC);
  assert.equal(pkexecPath({ REVAMP_PKEXEC: "" }), PKEXEC);
  assert.equal(pkexecPath({ REVAMP_PKEXEC: "/tmp/fake" }), "/tmp/fake");
});

test("canPrompt's default check wants an executable file", () => {
  const bin = mkdtempSync(join(tmpdir(), "revamp-pkexec-"));
  const pkexec = join(bin, "pkexec");
  assert.equal(canPrompt({ DISPLAY: ":0" }, pkexec), false);
  writeFileSync(pkexec, "#!/bin/sh\n", { mode: 0o644 });
  assert.equal(canPrompt({ DISPLAY: ":0" }, pkexec), false); // present, but not executable
  chmodSync(pkexec, 0o755);
  assert.equal(canPrompt({ DISPLAY: ":0" }, pkexec), true);
});

test("writeHelper writes <state>/sandbox/<name>.sh as 0644 and overwrites", () => {
  const paths = tempPaths();
  const file = writeHelper(paths, "revamp-hydra", "one\n");
  assert.equal(file, join(paths.state, "sandbox/revamp-hydra.sh"));
  assert.equal(readFileSync(file, "utf8"), "one\n");
  assert.equal(statSync(file).mode & 0o777, 0o644);
  assert.equal(writeHelper(paths, "revamp-hydra", "two\n"), file);
  assert.equal(readFileSync(file, "utf8"), "two\n");
  assert.equal(statSync(file).mode & 0o777, 0o644);
  assert.throws(() => writeHelper(paths, "../evil", "x"), /unsafe/);
});

test("runAsRoot pipes the script to pkexec /bin/sh -s and reports the status and output", (t) => {
  const saved = process.env.REVAMP_PKEXEC;
  t.after(() => (saved === undefined ? delete process.env.REVAMP_PKEXEC : (process.env.REVAMP_PKEXEC = saved)));
  delete process.env.REVAMP_PKEXEC;
  const calls: [string, string[], string | undefined][] = [];
  const spawn = (status: number | null) => (cmd: string, args: string[], input?: string) => (calls.push([cmd, args, input]), { status, stdout: "out\n", stderr: "err\n" });
  assert.deepEqual(runAsRoot("echo hi\n", spawn(0)), { ok: true, status: 0, output: "out\nerr" });
  assert.deepEqual(calls, [[PKEXEC, ["/bin/sh", "-s"], "echo hi\n"]]);
  assert.deepEqual(runAsRoot("x", spawn(126)), { ok: false, status: 126, output: "out\nerr" });
  calls.length = 0;
  runAsRoot("y", spawn(0), "/tmp/fake");
  assert.deepEqual(calls, [["/tmp/fake", ["/bin/sh", "-s"], "y"]]); // the path main.ts also gave canPrompt
  assert.deepEqual(runAsRoot("x", spawn(null)).ok, false);
});

test("runAsRoot's real spawn reports a missing pkexec instead of throwing", (t) => {
  const saved = process.env.REVAMP_PKEXEC;
  t.after(() => (saved === undefined ? delete process.env.REVAMP_PKEXEC : (process.env.REVAMP_PKEXEC = saved)));
  process.env.REVAMP_PKEXEC = "/nonexistent/pkexec";
  assert.equal(pkexecPath(), "/nonexistent/pkexec"); // checked first: a wrong seam here would call the real pkexec
  const r = runAsRoot("exit 0\n");
  assert.equal(r.ok, false);
  assert.equal(r.status, null);
  assert.match(r.output, /pkexec/);
});

test("sudoInstructions is the two-line text, with the path quoted for sh", () => {
  assert.equal(sudoInstructions("/x/y.sh"), "Run it with sudo instead:\n  sudo sh '/x/y.sh'");
  assert.equal(sudoInstructions("/x/My State/it's.sh"), "Run it with sudo instead:\n  sudo sh '/x/My State/it'\\''s.sh'");
});

// A machine whose /etc/apparmor.d holds the given files: name -> text.
const machine = (files: Record<string, string>, uid = 7): SandboxProfileEnv => ({
  readFile: (p) => files[p.replace("/etc/apparmor.d/", "")],
  fileExists: (p) => p.replace("/etc/apparmor.d/", "") in files,
  uid,
});

/** Revamped hydra's menu entry, which is all planProfile reads of the install. */
function installed(paths: Paths): Paths {
  mkdirSync(paths.applications, { recursive: true });
  writeFileSync(join(paths.applications, "revamp-hydra.desktop"), `[Desktop Entry]\nExec="${paths.data}/apps/hydra/current/hydralauncher" %U\n`);
  mkdirSync(join(paths.data, "apps/hydra"), { recursive: true });
  return paths;
}

test("the plan's sudo command quotes a state dir with a space", () => {
  const paths = installed(tempPaths({ XDG_STATE_HOME: join(mkdtempSync(join(tmpdir(), "revamp-sandbox-")), "My State") }));
  assert.equal(planProfile(paths, "hydra", machine({})).sudo(), `Run it with sudo instead:\n  sudo sh '${join(paths.state, "sandbox/revamp-hydra.sh")}'`);
});

test("the profile names the data dir's real path when XDG_DATA_HOME is a symlink", () => {
  const target = mkdtempSync(join(tmpdir(), "revamp-sandbox-data-"));
  const link = join(mkdtempSync(join(tmpdir(), "revamp-sandbox-")), "data");
  symlinkSync(target, link);
  const paths = installed(tempPaths({ XDG_DATA_HOME: link }));
  const plan = planProfile(paths, "hydra", machine({}));
  assert.ok(plan.script.includes(`"${realpathSync(target)}/revamp/apps/hydra/*/hydralauncher"`), plan.script);
  // this user's profile, written with the real path, is found through the link
  const mine = `profile revamp-hydra "${realpathSync(target)}/revamp/apps/hydra/*/hydralauncher" {}`;
  assert.equal(planProfile(paths, "hydra", machine({ "revamp-hydra": mine })).name, "revamp-hydra");
});

test("planProfile refuses a data dir other users can write", () => {
  const paths = installed(tempPaths());
  chmodSync(paths.data, 0o777);
  assert.throws(() => planProfile(paths, "hydra", machine({})), new RegExp(`unsafe data path ${paths.data}: ${paths.data} is writable by other users`));
});

/** A fake pkexec that reads the script and exits with `status`, saying what pkexec says without an agent. */
function fakePkexec(status: number): string {
  const file = join(mkdtempSync(join(tmpdir(), "revamp-pkexec-")), "pkexec");
  writeFileSync(file, `#!/bin/sh\ncat > /dev/null\necho 'No authentication agent found.' >&2\nexit ${status}\n`);
  chmodSync(file, 0o755);
  return file;
}

test("applyProfile: only 126 is a dismissed prompt; 127 and the script's own 3 are failures with pkexec's output; all offer sudo", () => {
  const paths = installed(tempPaths());
  const plan = planProfile(paths, "hydra", machine({}));
  const sudo = `Run it with sudo instead:\n  sudo sh '${join(paths.state, "sandbox/revamp-hydra.sh")}'`;
  assert.equal(applyProfile(plan, fakePkexec(0)), undefined);
  assert.equal(applyProfile(plan, fakePkexec(126)), `The administrator prompt was cancelled; nothing changed. ${sudo}`);
  assert.equal(applyProfile(plan, fakePkexec(127)), `pkexec failed (exit 127): No authentication agent found.\n${sudo}`);
  assert.equal(applyProfile(plan, fakePkexec(3)), `pkexec failed (exit 3): No authentication agent found.\n${sudo}`);
  assert.equal(readFileSync(join(paths.state, "sandbox/revamp-hydra.sh"), "utf8"), plan.script);
});

test("the profile a user installs: their suffixed one if it exists, else the computed name", () => {
  const paths = tempPaths();
  const mine = `profile revamp-hydra "${paths.data}/apps/hydra/*/hydralauncher" flags=(unconfined) {}`;
  const other = `profile revamp-hydra "/home/amy/.local/share/revamp/apps/hydra/*/hydralauncher" flags=(unconfined) {}`;
  assert.equal(chooseProfileName(paths, "hydra", machine({})), "revamp-hydra");
  assert.equal(chooseProfileName(paths, "hydra", machine({ "revamp-hydra": mine })), "revamp-hydra");
  assert.equal(chooseProfileName(paths, "hydra", machine({ "revamp-hydra": other })), "revamp-hydra-u7");
  // amy's profile was removed after this user got their own: theirs stays the one, never a second profile for the same path
  assert.equal(chooseProfileName(paths, "hydra", machine({ "revamp-hydra-u7": mine })), "revamp-hydra-u7");
  assert.throws(() => chooseProfileName(paths, "../x", machine({})), /unsafe/);
});

test("the profiles to remove are this user's existing ones, once each, never another user's", () => {
  const paths = tempPaths();
  const mine = `profile revamp-hydra "${paths.data}/apps/hydra/*/hydralauncher" {}`;
  const other = `profile revamp-hydra "/home/amy/x/*/hydralauncher" {}`;
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({})), []);
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": mine })), ["revamp-hydra"]);
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": other })), []); // amy's
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": other, "revamp-hydra-u7": "p" })), ["revamp-hydra-u7"]);
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": mine, "revamp-hydra-u7": "p" })), ["revamp-hydra", "revamp-hydra-u7"]);
});
