import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorExitCode, onPath, realDoctorEnv, runDoctor, sandboxProfilePresent, WINDOW_GLIBC, type DoctorEnv } from "../src/doctor.ts";
import { environmentWarnings } from "../src/install.ts";
import { revampPaths, type Paths } from "../src/paths.ts";
import { SYSCTL_PATH } from "../src/sandbox-profile.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "revamp-doc-"));
const HOME = "/home/u";

/** Temp paths with the given apps installed, one source and a last check, plus the window when asked. */
function setup(o: { apps?: string[]; window?: boolean; sources?: boolean; check?: boolean } = {}): Paths {
  const p = revampPaths({ HOME: tmp() });
  for (const a of o.apps ?? ["hydra"]) {
    mkdirSync(join(p.data, "apps", a, "1.0.0"), { recursive: true });
    writeFileSync(join(p.data, "apps", a, "1.0.0", "revamp.json"), JSON.stringify({ installedAt: "2026-10-18T07:00:00.000Z" })); // what makes it a finished install
    symlinkSync("1.0.0", join(p.data, "apps", a, "current"));
  }
  if (o.window ?? true) {
    mkdirSync(join(p.data, "gui"), { recursive: true });
    writeFileSync(join(p.data, "gui", "revamp-gui"), "");
  }
  if (o.sources ?? true) {
    mkdirSync(p.config, { recursive: true });
    const src = { location: "xb00tt/revamp-patches", kind: "github", name: "official", version: "0.5.0", sha256: "a".repeat(64), apps: ["hydra"] };
    writeFileSync(join(p.config, "sources.json"), JSON.stringify({ sources: [src] }));
  }
  if (o.check ?? true) {
    mkdirSync(p.state, { recursive: true });
    writeFileSync(join(p.state, "last-check.json"), JSON.stringify({ checkedAt: "2026-10-18T08:00:00.000Z", sources: [], apps: [] }));
  }
  return p;
}

/** A healthy machine; `files` are the paths fileExists answers true for (the window is under paths.data). */
function env(p: Paths, o: Partial<DoctorEnv> & { sysctl?: string; files?: string[]; texts?: Record<string, string> } = {}): DoctorEnv {
  const files = new Set([join(p.data, "gui", "revamp-gui"), ...(o.files ?? [])]);
  return {
    platform: "linux",
    arch: "x64",
    glibc: "2.39",
    readFile: (f) => (f === SYSCTL_PATH ? (o.sysctl ?? "0\n") : o.texts?.[f]),
    fileExists: (f) => files.has(f),
    sharedLibs: () => ["\tlibwebkit2gtk-4.1.so.0 (libc6,x86-64) => /lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0"],
    timer: () => ({ enabled: true, active: true, lastTrigger: "Sun 2026-10-18 09:00:00 UTC", nextElapse: "Mon 2026-10-19 09:00:00 UTC" }),
    pathEntries: ["/usr/bin", `${HOME}/.local/bin`],
    home: HOME,
    username: "u",
    ...o,
  };
}

const by = (checks: ReturnType<typeof runDoctor>, id: string) => checks.find((c) => c.id === id);

test("a healthy machine is green", () => {
  const p = setup();
  const checks = runDoctor(p, env(p));
  assert.deepEqual(checks.map((c) => c.id), ["platform", "glibc", "webkitgtk", "userns", "path", "timer", "sources", "apps"]);
  assert.ok(checks.every((c) => c.severity === "ok"), JSON.stringify(checks));
  assert.equal(doctorExitCode(checks), 0);
  assert.equal(by(checks, "platform")?.label, "Platform");
  assert.equal(by(checks, "glibc")?.label, "glibc (window)");
  assert.equal(by(checks, "webkitgtk")?.label, "WebKitGTK 4.1 (window)");
  assert.equal(by(checks, "userns")?.detail, "unrestricted");
  assert.equal(by(checks, "path")?.label, "~/.local/bin on PATH");
  assert.match(by(checks, "timer")!.detail, /Sun 2026-10-18 09:00:00 UTC/);
  assert.match(by(checks, "timer")!.detail, /Mon 2026-10-19 09:00:00 UTC/);
  assert.equal(by(checks, "sources")?.detail, "xb00tt/revamp-patches official 0.5.0\nlast check 2026-10-18T08:00:00.000Z");
  assert.equal(by(checks, "apps")?.detail, "hydra 1.0.0");
  assert.equal(WINDOW_GLIBC, "2.39");
});

test("without the window there are no glibc and webkitgtk checks", () => {
  const p = setup({ window: false });
  const checks = runDoctor(p, env(p, { glibc: "2.35", sharedLibs: () => [], fileExists: () => false }));
  assert.equal(by(checks, "glibc"), undefined);
  assert.equal(by(checks, "webkitgtk"), undefined);
  assert.equal(doctorExitCode(checks), 0);
});

test("an old glibc or another platform is broken", () => {
  const p = setup();
  const old = runDoctor(p, env(p, { glibc: "2.35" }));
  assert.equal(by(old, "glibc")?.severity, "broken");
  assert.equal(by(old, "glibc")?.fix, "The window needs glibc 2.39 or newer (Ubuntu 24.04, Linux Mint 22 or newer)");
  assert.equal(doctorExitCode(old), 2);
  // compared as numbers: 2.4 is older than 2.39, 2.100 is newer
  assert.equal(by(runDoctor(p, env(p, { glibc: "2.4" })), "glibc")?.severity, "broken");
  assert.equal(by(runDoctor(p, env(p, { glibc: "2.100" })), "glibc")?.severity, "ok");
  // process.report unavailable: can't judge, so not a failure
  const unknown = by(runDoctor(p, env(p, { glibc: undefined })), "glibc")!;
  assert.equal(unknown.severity, "ok");
  assert.equal(unknown.detail, "unknown (process.report unavailable)");
  const mac = runDoctor(p, env(p, { platform: "darwin" }));
  assert.equal(by(mac, "platform")?.severity, "broken");
  assert.equal(by(mac, "platform")?.fix, "Revamp 1.x ships for Linux x86_64");
  assert.equal(by(runDoctor(p, env(p, { arch: "arm64" })), "platform")?.severity, "broken");
});

test("a missing WebKitGTK is fixable with the apt command", () => {
  const p = setup();
  const checks = runDoctor(p, env(p, { sharedLibs: () => ["libgtk-3.so.0 (libc6,x86-64) => /lib/libgtk-3.so.0"] }));
  assert.equal(by(checks, "webkitgtk")?.severity, "fixable");
  assert.equal(by(checks, "webkitgtk")?.fix, "sudo apt install libwebkit2gtk-4.1-0");
  assert.equal(doctorExitCode(checks), 1);
});

test("restricted user namespaces: one sandbox check per app, fixable until its profile exists", () => {
  const p = setup({ apps: ["hydra", "heroic"] });
  const checks = runDoctor(p, env(p, { sysctl: "1\n", files: ["/etc/apparmor.d/revamp-heroic"] }));
  assert.equal(by(checks, "userns")?.severity, "ok");
  assert.notEqual(by(checks, "userns")?.detail, "unrestricted");
  const hydra = by(checks, "sandbox-hydra")!;
  assert.equal(hydra.label, "Sandbox profile for hydra");
  assert.equal(hydra.severity, "fixable");
  assert.equal(hydra.fix, "revamp sandbox hydra");
  const heroic = by(checks, "sandbox-heroic")!;
  assert.equal(heroic.severity, "ok");
  assert.match(heroic.detail, /needs root to read/);
  assert.match(heroic.detail, /^\/etc\/apparmor\.d\/revamp-heroic present/);
  assert.equal(doctorExitCode(checks), 1);
  // unrestricted: no sandbox checks at all
  assert.equal(by(runDoctor(p, env(p)), "sandbox-hydra"), undefined);
});

test("the sandbox check finds the profile under the second user's suffixed name", () => {
  const p = setup();
  const other = `profile revamp-hydra "/home/b/.local/share/revamp/apps/hydra/*/hydralauncher" {}`;
  const base = "/etc/apparmor.d/revamp-hydra";
  // another user's base profile, ours not written yet: fixable
  assert.equal(by(runDoctor(p, env(p, { sysctl: "1", files: [base], texts: { [base]: other } })), "sandbox-hydra")?.severity, "fixable");
  // ours is the suffixed one: ok
  const suffixed = runDoctor(p, env(p, { sysctl: "1", files: [base, `${base}-u`], texts: { [base]: other } }));
  assert.equal(by(suffixed, "sandbox-hydra")?.severity, "ok");
  assert.match(by(suffixed, "sandbox-hydra")!.detail, /revamp-hydra-u present/);
  // no base profile, but a suffixed one from earlier also counts
  const earlier = runDoctor(p, env(p, { sysctl: "1", files: [`${base}-u`] }));
  assert.equal(by(earlier, "sandbox-hydra")?.severity, "ok");
});

test("sandboxProfilePresent: one rule for the doctor and the install note", () => {
  const p = setup();
  const base = "/etc/apparmor.d/revamp-hydra";
  const mine = `profile revamp-hydra "${p.data}/apps/hydra/*/hydralauncher" {}`;
  const other = `profile revamp-hydra "/home/b/.local/share/revamp/apps/hydra/*/hydralauncher" {}`;
  const present = (e: Parameters<typeof env>[1]) => sandboxProfilePresent(p, "hydra", env(p, e));
  assert.equal(present({}), false);
  assert.equal(present({ files: [base], texts: { [base]: mine } }), true);
  assert.equal(present({ files: [base], texts: { [base]: other } }), false);
  assert.equal(present({ files: [base, `${base}-u`], texts: { [base]: other } }), true);
  // the doctor agrees with it
  assert.equal(by(runDoctor(p, env(p, { sysctl: "1", files: [base], texts: { [base]: other } })), "sandbox-hydra")?.severity, "fixable");
});

test("an unsafe app name is a fixable check, not a throw", () => {
  const p = setup({ apps: ["my app"] });
  const check = by(runDoctor(p, env(p, { sysctl: "1" })), "sandbox-my app")!;
  assert.equal(check.severity, "fixable");
  assert.match(check.detail, /^unsafe name: unsafe app id "my app"/);
  assert.throws(() => sandboxProfilePresent(p, "my app", env(p)), /unsafe app id/);
});

test("the timer", () => {
  const p = setup();
  const noSystemctl = by(runDoctor(p, env(p, { timer: () => undefined })), "timer")!;
  assert.equal(noSystemctl.severity, "ok");
  assert.equal(noSystemctl.detail, "unknown (no systemctl)");
  for (const t of [{ enabled: false, active: false }, { enabled: true, active: false }]) {
    const c = by(runDoctor(p, env(p, { timer: () => t })), "timer")!;
    assert.equal(c.severity, "fixable");
    assert.equal(c.fix, "revamp timer enable");
    assert.equal(c.label, "Daily check");
  }
});

test("sources", () => {
  const none = setup({ sources: false });
  const noSources = by(runDoctor(none, env(none)), "sources")!;
  assert.equal(noSources.severity, "fixable");
  assert.equal(noSources.fix, "revamp sources add xb00tt/revamp-patches");
  assert.equal(noSources.label, "Bundle sources");
  const unchecked = setup({ check: false });
  const never = by(runDoctor(unchecked, env(unchecked)), "sources")!;
  assert.equal(never.severity, "ok");
  assert.equal(never.detail, "xb00tt/revamp-patches official 0.5.0\nnever checked");
  // a corrupt sources.json is reported, not thrown
  const bad = setup({ sources: false });
  mkdirSync(bad.config, { recursive: true });
  writeFileSync(join(bad.config, "sources.json"), "{nope");
  assert.equal(by(runDoctor(bad, env(bad)), "sources")?.severity, "fixable");
});

test("apps lists each install, or none yet", () => {
  const p = setup({ apps: [] });
  assert.equal(by(runDoctor(p, env(p)), "apps")?.detail, "none yet");
  assert.equal(by(runDoctor(p, env(p)), "apps")?.severity, "ok");
  const two = setup({ apps: ["hydra", "heroic"] });
  assert.deepEqual(by(runDoctor(two, env(two)), "apps")?.detail.split("\n").sort(), ["heroic 1.0.0", "hydra 1.0.0"]);
});

test("PATH: missing is fixable, a trailing slash counts", () => {
  const p = setup();
  const missing = by(runDoctor(p, env(p, { pathEntries: ["/usr/bin"] })), "path")!;
  assert.equal(missing.severity, "fixable");
  assert.equal(missing.fix, "Add ~/.local/bin to your PATH");
  assert.equal(by(runDoctor(p, env(p, { pathEntries: [`${HOME}/.local/bin/`] })), "path")?.severity, "ok");
  assert.equal(onPath(["/usr/bin", "/h/.local/bin/"], "/h/.local/bin"), true);
  assert.equal(onPath(["/usr/bin"], "/h/.local/bin"), false);
});

test("the exit code is the worst severity", () => {
  const c = (severity: "ok" | "fixable" | "broken") => ({ id: "x", label: "x", severity, detail: "" });
  assert.equal(doctorExitCode([]), 0);
  assert.equal(doctorExitCode([c("ok"), c("fixable")]), 1);
  assert.equal(doctorExitCode([c("fixable"), c("broken"), c("ok")]), 2);
});

test("realDoctorEnv has the right shape", () => {
  const e = realDoctorEnv();
  assert.equal(typeof e.platform, "string");
  assert.equal(typeof e.arch, "string");
  assert.ok(e.glibc === undefined || typeof e.glibc === "string");
  assert.ok(Array.isArray(e.pathEntries));
  assert.equal(typeof e.home, "string");
  assert.equal(typeof e.username, "string");
  assert.equal(typeof e.readFile, "function");
  assert.equal(typeof e.fileExists, "function");
  assert.ok(Array.isArray(e.sharedLibs()));
  const t = e.timer();
  assert.ok(t === undefined || typeof t.enabled === "boolean");
});

test("the install note names revamp sandbox and goes quiet once the profile exists", () => {
  const f = join(tmp(), "sysctl");
  writeFileSync(f, "1\n");
  const lines = environmentWarnings({ id: "hydra", name: "Hydra" }, { sysctl: f });
  assert.equal(lines.length, 2);
  assert.equal(
    lines[1],
    "This system restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1), so Electron's sandbox can't start in an app installed in your home folder. Run once: revamp sandbox hydra",
  );
  assert.equal(environmentWarnings({ id: "hydra", name: "Hydra" }, { sysctl: f, profileExists: (n) => n === "revamp-hydra" }).length, 1);
  assert.equal(environmentWarnings({ id: "hydra", name: "Hydra" }, { sysctl: f, profileExists: (n) => n === "revamp-heroic" }).length, 2);
});
