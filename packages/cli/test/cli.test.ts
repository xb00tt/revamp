import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installHelper, profileText, removeHelper, type PatchAppResult, type PatchListing } from "@revamp-app/engine";
import { writeDemoBundle } from "../../engine/test/helpers/demo.ts";
import { formatInstalls, formatPatchList, formatPatchResult, printable } from "../src/format.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
/** A home with an empty sources.json: the CLI seeds the default source only while the file doesn't exist, and tests stay offline. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-"));
  mkdirSync(join(home, ".config/revamp"), { recursive: true });
  writeFileSync(join(home, ".config/revamp/sources.json"), '{"sources":[]}\n');
  return home;
}
/** Nothing in it: the CLI looks for sandbox profiles here instead of the machine's /etc/apparmor.d. */
const NO_PROFILES = mkdtempSync(join(tmpdir(), "revamp-cli-profiles-"));
/**
 * `extra` overrides the spawned CLI's environment; an undefined value removes the variable (this machine has DISPLAY=:0).
 * By default there are no profiles and no usable pkexec, so a test can't reach the real /etc/apparmor.d or the real pkexec.
 */
const cli = (args: string[], home = freshHome(), input = "", extra: Record<string, string | undefined> = {}) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: "",
    XDG_CONFIG_HOME: "",
    XDG_CACHE_HOME: "",
    XDG_STATE_HOME: "",
    REVAMP_PROFILE_DIR: NO_PROFILES,
    REVAMP_PKEXEC: "/nonexistent/pkexec",
    REVAMP_SYSCTL_PATH: "/nonexistent/sysctl", // unrestricted unless a test says otherwise
    ...extra,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return spawnSync(process.execPath, [MAIN, ...args], { encoding: "utf8", input, env: env as NodeJS.ProcessEnv });
};

test("formatPatchResult shows each patch, failures under it, and notes", () => {
  const r: PatchAppResult = {
    appId: "hydra",
    appName: "Hydra",
    version: "4.1.6",
    untested: false,
    installed: true,
    dryRun: false,
    installDir: "/x/apps/hydra/4.1.6",
    exitCode: 2,
    warnings: ["W"],
    logs: [],
    results: [
      { name: "Disable self-update", status: "applied", required: true, internal: false },
      { name: "Recently downloaded sort", status: "failed", required: false, internal: false, message: 'fingerprint "library sort switch" failed at step "pattern": …' },
      { name: "(internal patch #3)", status: "applied", required: false, internal: true },
      { name: "Off", status: "disabled", required: false, internal: false },
    ],
  };
  assert.equal(
    formatPatchResult(r),
    [
      "Hydra 4.1.6: 1/2 patches apply (installed to /x/apps/hydra/4.1.6)",
      "  ✓ Disable self-update (required)",
      "  ✗ Recently downloaded sort",
      '      fingerprint "library sort switch" failed at step "pattern": …',
      "    Off [disabled]",
      "Note: W",
    ].join("\n"),
  );
  assert.match(formatPatchResult({ ...r, installed: false, aborted: 'required patch "X" failed', exitCode: 1 }), /nothing installed: required patch "X" failed/);
  assert.match(formatPatchResult({ ...r, version: "4.1.7", untested: true }), /^Hydra 4\.1\.7 \(untested\): 1\/2 patches apply/);
  const helperFailed = [...r.results, { name: "(internal patch #4: helper)", status: "failed" as const, required: false, internal: true, message: "m" }];
  assert.match(formatPatchResult({ ...r, results: helperFailed }), /^Hydra 4\.1\.6: 1\/2 patches apply[^]*\n  ✗ \(internal patch #4: helper\)\n      m\nNote: W$/);
});

test("formatInstalls lists versions in local time and marks the current and untested ones", (t) => {
  const tz = process.env.TZ;
  process.env.TZ = "Europe/Sofia"; // UTC+3 in October, so 21:30Z is 00:30 the next day
  t.after(() => (tz === undefined ? delete process.env.TZ : (process.env.TZ = tz)));
  assert.equal(formatInstalls([]), "No Revamped apps installed.");
  const receipt = (version: string) => ({
    app: "hydra",
    version,
    release: { asset: "a", sha256: "a" },
    bundle: { name: "b", version: "1", sha256: "b" },
    selection: { enable: [], disable: [], options: {} },
    installedAt: "2026-10-14T21:30:00.000Z",
    patches: [{ name: "Recently downloaded sort", status: "applied" as const, required: false, internal: false }],
  });
  assert.equal(
    formatInstalls([{ appId: "hydra", current: "4.1.6", versions: [{ version: "4.1.6", receipt: receipt("4.1.6") }] }]),
    "hydra 4.1.6 (current)  installed 2026-10-15 00:30  Recently downloaded sort",
  );
  const forced = { ...receipt("4.1.7"), release: { asset: "a", sha256: "a", untested: true } };
  assert.match(formatInstalls([{ appId: "hydra", current: "4.1.6", versions: [{ version: "4.1.7", receipt: forced }] }]), /^hydra 4\.1\.7 \(untested\)  installed/);
});

test("the CLI prints usage, lists nothing in an empty home, and rejects unknown commands", () => {
  assert.equal(cli(["--help"]).status, 0);
  assert.match(cli(["--help"]).stdout, /revamp patch <app>/);
  const list = cli(["list"]);
  assert.equal(list.status, 0);
  assert.equal(list.stdout.trim(), "No Revamped apps installed.");
  const bad = cli(["frobnicate"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown command "frobnicate"/);
  assert.match(cli(["rollback"]).stderr, /needs an app/);
});

test("formatPatchList shows each patch's state, description and options", () => {
  const listing: PatchListing = {
    bundle: { name: "Revamp official", version: "0.2.0", minEngine: "0.2.0", author: "a", license: "GPL-3.0-only", source: "s" },
    app: { id: "hydra", name: "Hydra", release: { github: "o/r", tag: "v{version}", asset: "a" }, installDir: "opt/Hydra", executable: "h", desktopFile: "d", versions: {}, required: ["Core"] },
    version: "4.1.7",
    listed: false,
    patches: [
      { name: "Core", description: "Always on.", apps: null, default: false, required: true, compatible: true, options: { claimLinks: { type: "bool", title: "Claim links", description: "Keep links.", default: true } } },
      { name: "Sort", description: "", apps: [{ app: "hydra", versions: ["4.1.6"] }], default: true, required: false, compatible: false, options: {} },
      { name: "Universal", description: "", apps: null, default: false, required: false, compatible: true, options: {} },
    ],
  };
  assert.equal(
    formatPatchList(listing),
    [
      'Hydra 4.1.7 (not in this bundle: patching it needs --force), from bundle "Revamp official" 0.2.0',
      "  Core  [required]",
      "      Always on.",
      '      --option "Core:claimLinks=<bool>"  Claim links, default true',
      "          Keep links.",
      "  Sort  [only for 4.1.6]",
      "  Universal  [off by default]",
    ].join("\n"),
  );
});

test("revamp patches lists a bundle's patches for an app; bad --option fails before downloading", () => {
  const dir = mkdtempSync(join(tmpdir(), "revamp-cli-bundle-"));
  const bundle = join(dir, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const r = cli(["patches", "demo", "--bundle", bundle]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Demo 1.0.0, from bundle "Demo bundle" 1.0.0\n  Say goodbye  [on by default]\n');
  const bad = cli(["patch", "demo", "--bundle", bundle, "--option", "Say goodbye=1"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /revamp: --option "Say goodbye=1" must look like "<patch>:<key>=<value>"/);
  assert.match(cli(["patches", "nope", "--bundle", bundle]).stderr, /has no app "nope"/);
});

test("revamp sources adds a file source once confirmed, patches use it, and remove drops it", () => {
  const home = freshHome();
  const bundle = join(home, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const sha256 = createHash("sha256").update(readFileSync(bundle)).digest("hex");

  const declined = cli(["sources", "add", bundle], home, "n\n");
  assert.equal(declined.status, 1);
  assert.equal(
    declined.stdout,
    `Bundle "Demo bundle" 1.0.0 by test (GPL-3.0-only), from ${bundle}\n  Apps: Demo 1.0.0, 2.0.0\n  SHA-256: ${sha256}\nTrust this bundle and add the source? [y/N] `,
  );
  assert.equal(cli(["sources", "list"], home).stdout, "No bundle sources. Add one: revamp sources add xb00tt/revamp-patches\n");

  assert.match(cli(["sources", "add", bundle, "--yes"], home).stdout, new RegExp(`\nAdded ${bundle}\\.\n$`));
  assert.equal(cli(["sources", "list"], home).stdout, `${bundle}\n  "Demo bundle" 1.0.0 (file), apps: demo\n  SHA-256: ${sha256}\n`);
  const listing = cli(["patches", "demo"], home);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /^Demo 1\.0\.0, from bundle "Demo bundle" 1\.0\.0\n/);

  assert.equal(cli(["sources", "remove", bundle], home).stdout, `Removed ${bundle} ("Demo bundle" 1.0.0).\n`);
  assert.equal(cli(["sources", "list"], home).stdout, "No bundle sources. Add one: revamp sources add xb00tt/revamp-patches\n");
  assert.match(cli(["sources", "nope"], home).stderr, /^Unknown sources command "nope"\./);
});

test("sources add with no location is a usage error before any seeding", () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-bare-")); // no sources.json: a seed here would reach GitHub
  const r = cli(["sources", "add"], home);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'revamp: "sources add" needs a source, e.g. revamp sources add xb00tt/revamp-patches\n');
  assert.equal(existsSync(join(home, ".config/revamp/sources.json")), false);
});

test("bundle text can't move the cursor or clear the screen before the trust prompt", () => {
  assert.equal(printable("a\x1b[2Kb\rc\u009b\nd\te"), "a\\x1b[2Kb\\x0dc\\x9b\nd\te");
  const home = freshHome();
  const bundle = join(home, "evil.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  writeFileSync(bundle, readFileSync(bundle, "utf8").replace('name: "Demo bundle"', 'name: "Demo\\u001b[2K\\r bundle"'));
  const r = cli(["sources", "add", bundle], home, "n\n");
  assert.match(r.stdout, /^Bundle "Demo\\x1b\[2K\\x0d bundle" 1\.0\.0/);
  assert.doesNotMatch(r.stdout, /\x1b|\r/);
});

test("end of input at the trust prompt answers no: exit 1, nothing saved", () => {
  const home = freshHome();
  const bundle = join(home, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const r = cli(["sources", "add", bundle], home);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "");
  assert.equal(cli(["sources", "list"], home).stdout, "No bundle sources. Add one: revamp sources add xb00tt/revamp-patches\n");
});

test("check and update say so when nothing is installed", () => {
  const home = freshHome();
  for (const command of ["check", "update"]) {
    const r = cli([command], home);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "No Revamped apps installed.\n");
  }
  assert.equal(cli(["update", "hydra"], home).stderr, "revamp: hydra is not installed; install it with revamp patch hydra\n");
});

test("update with no app tries every installed app and exits 1 when they fail", () => {
  const home = freshHome();
  for (const id of ["alpha", "beta"]) {
    const dir = join(home, ".local/share/revamp/apps", id);
    mkdirSync(join(dir, "1.0.0"), { recursive: true });
    writeFileSync(join(dir, "1.0.0/revamp.json"), JSON.stringify({ installedAt: "2026-10-14T00:00:00.000Z" }));
    symlinkSync("1.0.0", join(dir, "current"));
  }
  const r = cli(["update"], home);
  assert.equal(r.status, 1);
  for (const id of ["alpha", "beta"]) assert.match(r.stderr, new RegExp(`^revamp: ${id}: no bundle source has "${id}"`, "m"));
});

test("only patch takes --dry-run: update and the rest refuse it before doing anything", () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-bare-")); // no sources.json: a seed here would reach GitHub
  const dir = join(home, ".local/share/revamp/apps/demo");
  mkdirSync(join(dir, "1.0.0"), { recursive: true });
  writeFileSync(join(dir, "1.0.0/revamp.json"), JSON.stringify({ installedAt: "2026-10-14T00:00:00.000Z" }));
  symlinkSync("1.0.0", join(dir, "current"));
  for (const args of [["update", "--dry-run"], ["update", "demo", "--dry-run"], ["uninstall", "demo", "--dry-run", "--yes"]]) {
    const r = cli(args, home);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `revamp: "${args[0]}" has no --dry-run; use revamp patch <app> --dry-run\n`);
  }
  assert.equal(existsSync(join(home, ".config/revamp/sources.json")), false);
  assert.equal(existsSync(join(dir, "current")), true);
});

test("the sources prompt can't get fake lines from newlines in one-line bundle fields", () => {
  const home = freshHome();
  const bundle = join(home, "evil.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  writeFileSync(bundle, readFileSync(bundle, "utf8").replace('name: "Demo bundle"', 'name: "Demo\\n  SHA-256: ffff"'));
  const r = cli(["sources", "add", bundle], home, "n\n");
  assert.match(r.stdout, /^Bundle "Demo\\x0a  SHA-256: ffff" 1\.0\.0/);
  assert.equal(r.stdout.split("\n").filter((l) => l.startsWith("  SHA-256:")).length, 1);
});

test("the timer needs the installed binary", () => {
  const home = freshHome();
  const bin = join(home, ".local/share/revamp/bin/revamp");
  assert.equal(cli(["timer", "enable"], home).stderr, `revamp: the timer runs the installed revamp (${bin}): run npm run install:cli, then revamp timer enable\n`);
  assert.match(cli(["timer"]).stderr, /^"timer" needs enable or disable\./);
});

/**
 * A home with Revamped hydra installed (its menu entry and app dir), a fake pkexec that logs its arguments and its
 * standard input (the script) and exits with `exit`, a profile dir standing in for /etc/apparmor.d (only abi/4.0 in it)
 * and a sysctl file saying the system restricts user namespaces.
 */
function sandboxHome(exit = 0) {
  const home = freshHome();
  const data = join(home, ".local/share/revamp");
  mkdirSync(join(data, "apps/hydra/current"), { recursive: true });
  mkdirSync(join(home, ".local/share/applications"), { recursive: true });
  writeFileSync(join(home, ".local/share/applications/revamp-hydra.desktop"), `[Desktop Entry]\nName=Hydra (Revamped)\nExec="${data}/apps/hydra/current/hydralauncher" %U\n`);
  const bin = join(home, "bin");
  mkdirSync(bin);
  const log = join(home, "pkexec.log");
  writeFileSync(join(bin, "pkexec"), `#!/bin/sh\necho "$@" >> '${log}'\ncat >> '${log}'\nexit ${exit}\n`);
  chmodSync(join(bin, "pkexec"), 0o755);
  const profiles = join(home, "apparmor.d");
  mkdirSync(join(profiles, "abi"), { recursive: true });
  writeFileSync(join(profiles, "abi/4.0"), "");
  const sysctl = join(home, "restrict");
  writeFileSync(sysctl, "1\n");
  const env = { REVAMP_PKEXEC: join(bin, "pkexec"), REVAMP_PROFILE_DIR: profiles, REVAMP_SYSCTL_PATH: sysctl, DISPLAY: ":0" };
  const pattern = `${data}/apps/hydra/*/hydralauncher`;
  const script = installHelper("revamp-hydra", profileText("revamp-hydra", pattern));
  return { home, data, log, env, profiles, pattern, script, helper: join(home, ".local/state/revamp/sandbox/revamp-hydra.sh") };
}
const noDisplay = (env: Record<string, string>) => ({ ...env, DISPLAY: undefined, WAYLAND_DISPLAY: undefined });

test("sandbox needs an installed app", () => {
  const { env } = sandboxHome();
  const r = cli(["sandbox", "heroic"], undefined, "", env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /heroic is not installed/);
});

test("sandbox on a system that doesn't restrict user namespaces does nothing and asks for nothing", () => {
  const s = sandboxHome();
  writeFileSync(s.env.REVAMP_SYSCTL_PATH, "0\n");
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "This system doesn't restrict user namespaces, so Revamped hydra starts without a profile. Nothing to do.\n");
  assert.equal(existsSync(s.log), false);
  assert.equal(existsSync(s.helper), false);
});

test("sandbox refuses an AppArmor older than 4.0 before showing or asking anything", () => {
  const s = sandboxHome();
  rmSync(join(s.profiles, "abi/4.0"));
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "This system's AppArmor is older than 4.0, which the profile needs; see docs/electron-sandbox.md.\n");
  assert.equal(r.stdout, "");
  assert.equal(existsSync(s.log), false);
});

test("sandbox shows the script, pipes it to pkexec's shell and leaves no helper file", () => {
  const s = sandboxHome();
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes(s.script.trimEnd()), r.stdout); // the whole script root will run, profile included
  assert.ok(r.stdout.includes(`profile revamp-hydra "${s.pattern}"`), r.stdout);
  assert.ok(r.stdout.includes("This writes /etc/apparmor.d/revamp-hydra and runs: apparmor_parser -r /etc/apparmor.d/revamp-hydra\n"), r.stdout);
  assert.match(r.stdout, /Installed and loaded \/etc\/apparmor\.d\/revamp-hydra\. Start hydra \(Revamped\) again\./);
  assert.equal(readFileSync(s.log, "utf8"), `/bin/sh -s\n${s.script}`);
  assert.equal(existsSync(s.helper), false); // nothing user-writable that root runs
});

test("sandbox reports a cancelled administrator prompt with the sudo way out", () => {
  const s = sandboxHome(126);
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /The administrator prompt was cancelled; nothing changed\. Run it with sudo instead:\n {2}sudo sh '.*revamp-hydra\.sh'\n/);
  assert.doesNotMatch(r.stdout, /Installed and loaded/);
  assert.equal(readFileSync(s.helper, "utf8"), s.script);
});

test("sandbox treats pkexec's 127 as a failure and keeps what pkexec said", () => {
  const s = sandboxHome();
  writeFileSync(s.env.REVAMP_PKEXEC, "#!/bin/sh\ncat > /dev/null\necho 'Error executing command as another user: Not authorized' >&2\nexit 127\n");
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pkexec failed \(exit 127\): Error executing command as another user: Not authorized\nRun it with sudo instead:\n {2}sudo sh '.*revamp-hydra\.sh'\n/);
  assert.doesNotMatch(r.stdout, /nothing changed/);
});

test("sandbox shows pkexec's other failures with the sudo way out", () => {
  const s = sandboxHome(3);
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pkexec failed \(exit 3\)/);
  assert.doesNotMatch(r.stdout, /nothing changed/); // the script exits 3 on its own failures, some after the move
  assert.match(r.stdout, /sudo sh .*revamp-hydra\.sh/);
  assert.equal(readFileSync(s.helper, "utf8"), s.script);
});

test("sandbox without a display writes the helper for sudo and never calls pkexec", () => {
  const s = sandboxHome();
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", noDisplay(s.env));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Run it with sudo instead:\n {2}sudo sh .*revamp-hydra\.sh/);
  assert.equal(existsSync(s.log), false);
  assert.equal(readFileSync(s.helper, "utf8"), s.script);
});

test("answering no to the sandbox prompt changes nothing but leaves the helper for sudo", () => {
  const s = sandboxHome();
  const r = cli(["sandbox", "hydra"], s.home, "n\n", s.env);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes(s.script.trimEnd()), r.stdout); // shown before the question
  assert.match(r.stdout, /Write it with administrator rights\? \[y\/N\] /);
  assert.match(r.stdout, /Nothing changed\. Run it with sudo instead:\n {2}sudo sh .*revamp-hydra\.sh/);
  assert.equal(existsSync(s.log), false);
  assert.equal(readFileSync(s.helper, "utf8"), s.script);
});

test("sandbox runs after a y at its one question, and the end of input answers no", () => {
  const s = sandboxHome();
  const yes = cli(["sandbox", "hydra"], s.home, "y\n", s.env);
  assert.equal(yes.status, 0, yes.stderr + yes.stdout);
  assert.match(yes.stdout, /Write it with administrator rights\? \[y\/N\] /);
  assert.equal(readFileSync(s.log, "utf8"), `/bin/sh -s\n${s.script}`);
  const s2 = sandboxHome();
  const eof = cli(["sandbox", "hydra"], s2.home, "", s2.env);
  assert.equal(eof.status, 1);
  assert.match(eof.stdout, /Nothing changed\./);
  assert.equal(existsSync(s2.log), false);
});

test("sandbox reuses this user's suffixed profile instead of adding a second one for the same path", () => {
  const s = sandboxHome();
  const name = `revamp-hydra-u${process.getuid!()}`;
  writeFileSync(join(s.profiles, name), `profile ${name} "${s.pattern}" flags=(unconfined) {}`);
  const r = cli(["sandbox", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(s.log, "utf8"), `/bin/sh -s\n${installHelper(name, profileText(name, s.pattern))}`);
});

test("uninstall finishes without a profile line when there is no profile", () => {
  const s = sandboxHome();
  const r = cli(["uninstall", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, "Removed Revamped hydra.\n");
  assert.equal(existsSync(join(s.data, "apps/hydra")), false);
  assert.equal(existsSync(s.log), false);
});

/** sandboxHome plus this user's profile file, as a past `revamp sandbox hydra` leaves it. */
function withProfile(exit = 0) {
  const s = sandboxHome(exit);
  writeFileSync(join(s.profiles, "revamp-hydra"), profileText("revamp-hydra", s.pattern));
  return s;
}

test("uninstall offers to remove the profile and pipes removeHelper's script to pkexec", () => {
  const s = withProfile();
  const r = cli(["uninstall", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /A sandbox profile \/etc\/apparmor\.d\/revamp-hydra remains\./);
  assert.ok(r.stdout.includes(removeHelper("revamp-hydra").trimEnd()), r.stdout);
  assert.match(r.stdout, /Removed \/etc\/apparmor\.d\/revamp-hydra\./);
  assert.equal(readFileSync(s.log, "utf8"), `/bin/sh -s\n${removeHelper("revamp-hydra")}`);
});

test("uninstall asks twice when piped y, y: the app, then the profile", () => {
  const s = withProfile();
  const r = cli(["uninstall", "hydra"], s.home, "y\ny\n", s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Remove Revamped hydra[^\n]*\? \[y\/N\] /);
  assert.match(r.stdout, /Remove it with administrator rights\? \[y\/N\] /);
  assert.match(r.stdout, /Removed \/etc\/apparmor\.d\/revamp-hydra\./);
  assert.equal(readFileSync(s.log, "utf8"), `/bin/sh -s\n${removeHelper("revamp-hydra")}`);
  assert.equal(existsSync(join(s.data, "apps/hydra")), false);
});

test("uninstall's profile question answered n keeps the profile and leaves the sudo way out", () => {
  const s = withProfile();
  const r = cli(["uninstall", "hydra"], s.home, "y\nn\n", s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Remove it with administrator rights\? \[y\/N\] /);
  assert.match(r.stdout, /It stays\. Run it with sudo instead:\n {2}sudo sh .*revamp-hydra-remove\.sh/);
  assert.equal(existsSync(s.log), false);
  assert.equal(readFileSync(join(s.home, ".local/state/revamp/sandbox/revamp-hydra-remove.sh"), "utf8"), removeHelper("revamp-hydra"));
  assert.equal(existsSync(join(s.data, "apps/hydra")), false); // the app itself was removed on the first y
});

test("uninstall's first question answered n removes nothing and never reaches the profile", () => {
  const s = withProfile();
  const r = cli(["uninstall", "hydra"], s.home, "n\ny\n", s.env);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /sandbox profile/);
  assert.equal(existsSync(join(s.data, "apps/hydra")), true);
  assert.equal(existsSync(s.log), false);
});

test("the end of input answers no to the profile question", () => {
  const s = withProfile();
  const r = cli(["uninstall", "hydra"], s.home, "y\n", s.env); // the second question finds the input closed
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Remove it with administrator rights\? \[y\/N\] \nIt stays\./);
  assert.equal(existsSync(s.log), false);
});

test("uninstall keeps going when the profile prompt is cancelled, and says the profile stays", () => {
  const s = withProfile(126);
  const r = cli(["uninstall", "hydra", "--yes"], s.home, "", s.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /The administrator prompt was cancelled; the profile stays\. Run it with sudo instead:\n {2}sudo sh '.*revamp-hydra-remove\.sh'\n/);
  assert.equal(existsSync(join(s.data, "apps/hydra")), false);
});

test("uninstall removes both of this user's profiles in one script and says them", () => {
  const s = withProfile();
  const suffixed = `revamp-hydra-u${process.getuid!()}`;
  writeFileSync(join(s.profiles, suffixed), "x");
  const both = removeHelper(["revamp-hydra", suffixed]);
  const no = cli(["uninstall", "hydra"], s.home, "y\nn\n", s.env);
  assert.equal(no.status, 0, no.stderr);
  assert.match(no.stdout, /Remove them with administrator rights\? \[y\/N\] /);
  assert.match(no.stdout, /They stay\. Run it with sudo instead:/);
  assert.equal(readFileSync(join(s.home, ".local/state/revamp/sandbox/revamp-hydra-remove.sh"), "utf8"), both);
  const s2 = withProfile();
  writeFileSync(join(s2.profiles, suffixed), "x");
  const yes = cli(["uninstall", "hydra"], s2.home, "y\ny\n", s2.env);
  assert.equal(yes.status, 0, yes.stderr);
  assert.equal(readFileSync(s2.log, "utf8"), `/bin/sh -s\n${both}`);
});

test("uninstall without a display shows the script, then leaves the profile and the sudo command", () => {
  const s = withProfile();
  const r = cli(["uninstall", "hydra", "--yes"], s.home, "", noDisplay(s.env));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf(removeHelper("revamp-hydra").trimEnd()) >= 0, r.stdout);
  assert.ok(r.stdout.indexOf(removeHelper("revamp-hydra").trimEnd()) < r.stdout.indexOf("sudo sh "), r.stdout);
  assert.match(r.stdout, /sudo sh .*revamp-hydra-remove\.sh/);
  assert.equal(existsSync(s.log), false);
});

test("doctor reports the checks that don't depend on the machine, and exits 1 or 2", () => {
  const r = cli(["doctor"]);
  // Fixable (1) or broken (2) depending on the machine's PATH and timer; never 0 here, because the fresh home has no source.
  assert.ok(r.status === 1 || r.status === 2, `${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^✓ Platform: linux x64$/m);
  assert.match(r.stdout, /^✗ Bundle sources: none/m);
  assert.match(r.stdout, /^    Fix: revamp sources add xb00tt\/revamp-patches$/m);
  assert.match(r.stdout, /^✓ Revamped apps: none yet$/m);
  assert.doesNotMatch(r.stdout, /glibc \(window\)/); // no window in the fresh home
});

test("doctor indents the extra lines of a detail, so a source's name can't fake a check line", () => {
  const home = freshHome();
  const source = { location: "xb00tt/revamp-patches", name: "Evil\n✓ Fake: ok", version: "1.0.0", sha256: "a" };
  writeFileSync(join(home, ".config/revamp/sources.json"), JSON.stringify({ sources: [source] }));
  const r = cli(["doctor"], home);
  assert.match(r.stdout, /^✓ Bundle sources: xb00tt\/revamp-patches Evil\n    ✓ Fake: ok 1\.0\.0\n    never checked$/m);
  assert.doesNotMatch(r.stdout, /^✓ Fake/m);
});
