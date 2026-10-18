import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revampPaths, type SandboxProfileEnv } from "@revamp-app/engine";
import { canPrompt, chooseProfileName, existingProfileNames, pkexecPath, runAsRoot, sudoInstructions, writeHelper } from "../src/sandbox.ts";

const tempPaths = () => revampPaths({ HOME: mkdtempSync(join(tmpdir(), "revamp-sandbox-")), XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "" });
const PKEXEC = "/usr/bin/pkexec";

test("canPrompt needs /usr/bin/pkexec and a display", () => {
  const exists = (p: string) => p === PKEXEC;
  assert.equal(canPrompt({ DISPLAY: ":0" }, exists), true);
  assert.equal(canPrompt({ WAYLAND_DISPLAY: "wayland-0" }, exists), true);
  assert.equal(canPrompt({}, exists), false);
  assert.equal(canPrompt({ DISPLAY: "" }, exists), false);
  assert.equal(canPrompt({ DISPLAY: ":0" }, () => false), false);
  assert.equal(canPrompt({ DISPLAY: ":0" }, (p) => p === "/tmp/bin/pkexec"), false); // not looked up on PATH
});

test("REVAMP_PKEXEC names another pkexec for tests; canPrompt and the spawn both follow it", () => {
  assert.equal(pkexecPath({}), PKEXEC);
  assert.equal(pkexecPath({ REVAMP_PKEXEC: "" }), PKEXEC);
  assert.equal(pkexecPath({ REVAMP_PKEXEC: "/tmp/fake" }), "/tmp/fake");
  assert.equal(canPrompt({ DISPLAY: ":0", REVAMP_PKEXEC: "/tmp/fake" }, (p) => p === "/tmp/fake"), true);
});

test("canPrompt's default check wants an executable file", () => {
  const bin = mkdtempSync(join(tmpdir(), "revamp-pkexec-"));
  const env = { DISPLAY: ":0", REVAMP_PKEXEC: join(bin, "pkexec") };
  assert.equal(canPrompt(env), false);
  writeFileSync(join(bin, "pkexec"), "#!/bin/sh\n", { mode: 0o644 });
  assert.equal(canPrompt(env), false); // present, but not executable
  chmodSync(join(bin, "pkexec"), 0o755);
  assert.equal(canPrompt(env), true);
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

test("sudoInstructions is the two-line text", () => {
  assert.equal(sudoInstructions("/x/y.sh"), "Run it with sudo instead:\n  sudo sh /x/y.sh");
});

// A machine whose /etc/apparmor.d holds the given files: name -> text.
const machine = (files: Record<string, string>, username = "bob"): SandboxProfileEnv => ({
  readFile: (p) => files[p.replace("/etc/apparmor.d/", "")],
  fileExists: (p) => p.replace("/etc/apparmor.d/", "") in files,
  username,
});

test("the profile a user installs: their suffixed one if it exists, else the computed name", () => {
  const paths = tempPaths();
  const mine = `profile revamp-hydra "${paths.data}/apps/hydra/*/hydralauncher" flags=(unconfined) {}`;
  const other = `profile revamp-hydra "/home/amy/.local/share/revamp/apps/hydra/*/hydralauncher" flags=(unconfined) {}`;
  assert.equal(chooseProfileName(paths, "hydra", machine({})), "revamp-hydra");
  assert.equal(chooseProfileName(paths, "hydra", machine({ "revamp-hydra": mine })), "revamp-hydra");
  assert.equal(chooseProfileName(paths, "hydra", machine({ "revamp-hydra": other })), "revamp-hydra-bob");
  // amy's profile was removed after bob got his own: bob's stays the one, never a second profile for the same path
  assert.equal(chooseProfileName(paths, "hydra", machine({ "revamp-hydra-bob": other.replace("/home/amy", "/home/bob") })), "revamp-hydra-bob");
  assert.throws(() => chooseProfileName(paths, "../x", machine({})), /unsafe/);
});

test("the profiles to remove are this user's existing ones, once each, never another user's", () => {
  const paths = tempPaths();
  const mine = `profile revamp-hydra "${paths.data}/apps/hydra/*/hydralauncher" {}`;
  const other = `profile revamp-hydra "/home/amy/x/*/hydralauncher" {}`;
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({})), []);
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": mine })), ["revamp-hydra"]);
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": other })), []); // amy's
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": other, "revamp-hydra-bob": "p" })), ["revamp-hydra-bob"]);
  assert.deepEqual(existingProfileNames(paths, "hydra", machine({ "revamp-hydra": mine, "revamp-hydra-bob": "p" })), ["revamp-hydra", "revamp-hydra-bob"]);
});
