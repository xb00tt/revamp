import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeHelper, revampPaths, type SandboxProfileEnv } from "@revamp-app/engine";
import { canPrompt, chooseProfileName, existingProfileNames, removeAllHelper, runAsRoot, sudoInstructions, writeHelper } from "../src/sandbox.ts";

const tempPaths = () => revampPaths({ HOME: mkdtempSync(join(tmpdir(), "revamp-sandbox-")), XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "" });
const pkexecAt = (path: string) => (p: string) => p === path;

test("canPrompt needs pkexec on PATH and a display", () => {
  const exists = pkexecAt("/usr/bin/pkexec");
  assert.equal(canPrompt({ PATH: "/bin:/usr/bin", DISPLAY: ":0" }, exists), true);
  assert.equal(canPrompt({ PATH: "/usr/bin", WAYLAND_DISPLAY: "wayland-0" }, exists), true);
  assert.equal(canPrompt({ PATH: "/usr/bin" }, exists), false);
  assert.equal(canPrompt({ PATH: "/usr/bin", DISPLAY: "" }, exists), false);
  assert.equal(canPrompt({ PATH: "/usr/bin", DISPLAY: ":0" }, () => false), false);
  assert.equal(canPrompt({ DISPLAY: ":0" }, () => true), false); // no PATH, no pkexec
});

test("canPrompt's default check wants an executable file", () => {
  const bin = mkdtempSync(join(tmpdir(), "revamp-pkexec-"));
  const env = { PATH: `/nonexistent:${bin}`, DISPLAY: ":0" };
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

test("runAsRoot runs pkexec /bin/sh <helper> and reports the status and output", () => {
  const calls: [string, string[]][] = [];
  const spawn = (status: number | null) => (cmd: string, args: string[]) => (calls.push([cmd, args]), { status, stdout: "out\n", stderr: "err\n" });
  assert.deepEqual(runAsRoot("/x/y.sh", spawn(0)), { ok: true, status: 0, output: "out\nerr" });
  assert.deepEqual(calls, [["pkexec", ["/bin/sh", "/x/y.sh"]]]);
  assert.deepEqual(runAsRoot("/x/y.sh", spawn(126)), { ok: false, status: 126, output: "out\nerr" });
  assert.deepEqual(runAsRoot("/x/y.sh", spawn(null)).ok, false);
});

test("runAsRoot's real spawn reports a missing pkexec instead of throwing", () => {
  const saved = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    const r = runAsRoot("/x/y.sh");
    assert.equal(r.ok, false);
    assert.equal(r.status, null);
    assert.match(r.output, /pkexec/);
  } finally {
    process.env.PATH = saved;
  }
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

test("removeAllHelper is one script that removes each profile", () => {
  assert.equal(removeAllHelper(["revamp-hydra"]), removeHelper("revamp-hydra"));
  const both = removeAllHelper(["revamp-hydra", "revamp-hydra-bob"]);
  assert.equal(both.match(/^#!\/bin\/sh$/gm)?.length, 1);
  assert.equal(both.match(/^set -eu$/gm)?.length, 1);
  for (const n of ["revamp-hydra", "revamp-hydra-bob"]) assert.ok(both.includes(`apparmor_parser -R '/etc/apparmor.d/${n}' || true\nrm -f '/etc/apparmor.d/${n}'\n`));
  assert.equal(existsSync("/etc/apparmor.d/revamp-hydra.new"), false); // nothing here touches /etc
});
