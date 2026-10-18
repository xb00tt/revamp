# Revamp M6: `doctor` and the Sandbox Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Revamp 1.1.0 with `revamp doctor` (local health checks with fixes) and `revamp sandbox <app>` (the AppArmor profile that lets a Revamped app start on stock Ubuntu 24.04+, written with one `pkexec` prompt), plus the window banner and the report note that point at it.

**In plain words:** On a stock Ubuntu 24.04 or newer, a Revamped app installed in the home folder can't start Chromium's sandbox, because the kernel restricts unprivileged user namespaces. Hydra's own fix is an AppArmor profile that allows them for its executable path. v1 told the user to write that profile by hand. M6 writes it for them: Revamp shows the profile and the two commands, asks once, and runs them through the system's administrator prompt. `doctor` tells any user what's wrong before they ask for help.

**Architecture:**
- **Engine** gets two small modules with no root access: `sandbox-profile.ts` (the profile text, the helper script, the installed executable path, the sysctl check) and `doctor.ts` (checks as data, with an injectable environment so tests need no real machine). `environmentWarnings` learns to name the command.
- **CLI** runs `pkexec /bin/sh <helper>` (or prints the `sudo` equivalent when no prompt can appear), adds `doctor`, `sandbox <app>`, the profile cleanup offer on `uninstall`, and the `serve` methods.
- **Window** shows one banner when the machine is restricted and an installed app has no profile, with a button per app.
- **Facts that shaped it** (checked 2026-10-18 on the owner's Mint 22.3): `process.report.getReport().header.glibcVersionRuntime` gives glibc; `ldconfig -p` lists `libwebkit2gtk-4.1.so.0`; `systemctl --user show revamp-check.timer -p ActiveState -p LastTriggerUSec -p NextElapseUSecRealtime` works; `/sys/kernel/security/apparmor/profiles` is **root-only**, so "loaded" can't be read: `doctor` reports the profile *file* in `/etc/apparmor.d/` instead. The receipt has no executable: it comes from the `Exec=` line of `revamp-<app>.desktop`, which Revamp writes as `"<data>/apps/<app>/current/<executable>" %U`.

**Tech Stack:** Node 26 (type stripping), node:test, `node:child_process` `spawnSync` with injected runners for tests, Vite/React window, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-revamp-v2-design.md` §5.1, §5.2, §6, §7 M6, §8; decisions 3, 16, 17, 18. Read it, plus CLAUDE.md.

## Global Constraints

- Work in a worktree (`git worktree add .worktrees/<name> -b <name>`), `cp -a node_modules` into it. Every command needs `export PATH="$HOME/.cargo/bin:$HOME/.local/node26/bin:$PATH"` first.
- Erasable TypeScript only; `import type`; `.ts` on relative imports. Runtime deps stay `acorn` + `xz-decompress`; no native addons.
- Unit tests never touch the network, the real home, `/etc` or root. Readers and spawners are injected; CLI spawn tests use `freshHome()` and a PATH override for a fake `pkexec`.
- **Never run `pkexec`, `sudo` or `apparmor_parser` for real during development or tests.** The owner may try `revamp sandbox hydra` on their machine after the review, by choice.
- `--no-sandbox` is never written by Revamp; it stays documentation.
- Names from bundles (app id, executable) go through `assertSafeName` / `assertSafeRelativePath` before they reach a path or a script. The data path goes in the profile quoted and is refused if it contains `"`, a newline or another control character.
- Text on screen: CLI through `printable()`, window through `plain()`.
- Version 1.1.0 for every package and `ENGINE_VERSION`; a `## 1.1.0` CHANGELOG section. Nothing is published by this plan: after merge the owner runs `publish:packages` (in their terminal) and `release:app`.
- Commits: conventional, each ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A data path with a space or a quote** (`XDG_DATA_HOME=/home/me/My Data`). The profile must quote the path; a `"` or control character is refused with a clear error, never written. Pinned in Task 1 (`profileText` tests).
2. **A desktop entry the user edited by hand**, for example `--no-sandbox` added after the path, or one that points outside Revamp's apps dir. `installedExecutablePath` must still find the path and refuse one outside `<data>/apps/<app>/current/`. Pinned in Task 1.
3. **The user cancels the `pkexec` dialog** (exit 126) or lacks the right (127). The CLI says "not installed; nothing changed" and exits 1, with no partial state. Pinned in Task 3.
4. **No systemd or no `systemctl`** (a container, another init). `doctor` reports the timer as "unknown", never crashes. Pinned in Task 2.
5. **A second user on the same machine** already has `/etc/apparmor.d/revamp-hydra` with their path. The profile name gets this user's suffix instead of overwriting. Pinned in Task 1.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `packages/engine/src/sandbox-profile.ts` | create | Profile name/text, helper scripts, installed executable path, sysctl and profile-file checks |
| `packages/engine/src/doctor.ts` | create | Checks as data; `realDoctorEnv` reads the machine |
| `packages/engine/src/install.ts` | modify | `environmentWarnings` names `revamp sandbox <app>` and stays quiet when the profile exists |
| `packages/engine/src/api.ts` | modify | passes the app id to `environmentWarnings` |
| `packages/engine/src/index.ts` | modify | exports |
| `packages/engine/test/sandbox-profile.test.ts`, `doctor.test.ts` | create | |
| `packages/engine/test/install.test.ts` | modify | the warning tests |
| `packages/cli/src/sandbox.ts` | create | `pkexec` runner, prompt detection, helper file in `<state>/sandbox/` |
| `packages/cli/src/main.ts` | modify | `doctor`, `sandbox <app>`, uninstall cleanup, USAGE |
| `packages/cli/src/serve.ts` | modify | `doctor.run`, `sandbox.status`, `sandbox.fix` |
| `packages/cli/test/sandbox.test.ts` | create | |
| `packages/cli/test/cli.test.ts`, `serve.test.ts` | modify | |
| `packages/gui/src/model.ts`, `App.tsx` | modify | `sandboxNote`, the banner and buttons |
| `packages/gui/test/model.test.ts` | modify | |
| `docs/electron-sandbox.md`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`, the v2 spec | modify | docs, the "loaded state" correction, 1.1.0 |
| `packages/*/package.json`, `engine/src/version.ts`, `src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock}`, `package-lock.json` | modify | 1.1.0 |

---

### Task 1: Engine `sandbox-profile.ts`

**Files:**
- Create: `packages/engine/src/sandbox-profile.ts`, `packages/engine/test/sandbox-profile.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces (produces):**
```ts
export const PROFILE_DIR = "/etc/apparmor.d";
export const SYSCTL_PATH = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
/** true when the file reads "1"; false when "0" or missing (not an AppArmor system). */
export function userNamespacesRestricted(sysctlPath?: string): boolean;
/** "revamp-<appId>"; with `username` when an existing profile text names another path (a second user). */
export function profileName(appId: string, existing: string | undefined, dataDir: string, username: string): string;
/** The AppArmor path pattern: "<dataDir>/apps/<appId>/*/<executable>". */
export function profilePattern(dataDir: string, appId: string, executable: string): string;
/** The profile file text (below). Throws `unsupported data path: …` on `"`, newline or control characters in dataDir. */
export function profileText(name: string, pattern: string): string;
export function installHelper(name: string, text: string): string;   // sh script: write <PROFILE_DIR>/<name>.new, mv over, apparmor_parser -r
export function removeHelper(name: string): string;                  // sh script: apparmor_parser -R then rm -f
export function profileFileExists(name: string, dir?: string): boolean;
/** Reads revamp-<appId>.desktop's Exec, returns the executable path relative to <dataDir>/apps/<appId>/current/, or throws. */
export function installedExecutable(paths: Paths, appId: string): string;
```

Profile text, exact (`<name>` and `<pattern>` substituted; `pattern` is quoted with `"`):
```
abi <abi/4.0>,
include <tunables/global>

profile <name> "<pattern>" flags=(unconfined) {
  userns,
  include if exists <local/<name>>
}
```

Install helper, exact:
```sh
#!/bin/sh
set -eu
umask 022
cat > '/etc/apparmor.d/<name>.new' <<'REVAMP_PROFILE'
<profile text>
REVAMP_PROFILE
mv -f '/etc/apparmor.d/<name>.new' '/etc/apparmor.d/<name>'
apparmor_parser -r '/etc/apparmor.d/<name>'
```
Remove helper: the same header, then `apparmor_parser -R '/etc/apparmor.d/<name>' || true` and `rm -f '/etc/apparmor.d/<name>'`.

- [ ] **Step 1: Write the failing tests** (`sandbox-profile.test.ts`, temp dirs only)

- `userNamespacesRestricted`: a temp file with `1\n` → true; `0\n` → false; a missing path → false.
- `profileName("hydra", undefined, "/home/a/.local/share/revamp", "a")` → `"revamp-hydra"`; with `existing` = a profile text containing `/home/a/.local/share/revamp/apps/hydra/*/hydralauncher` → `"revamp-hydra"` (same user, re-run); with `existing` naming `/home/b/...` → `"revamp-hydra-a"`.
- `profilePattern("/home/a/.local/share/revamp", "hydra", "hydralauncher")` → `"/home/a/.local/share/revamp/apps/hydra/*/hydralauncher"`; a nested executable `"bin/heroic"` keeps its slash.
- `profileText("revamp-hydra", pattern)` equals the exact text above with the quoted pattern; a `dataDir` with a space is accepted inside the quotes; `profileText` throws `/unsupported data path/` for a pattern containing `"` and for one containing `\n`.
- `installHelper("revamp-hydra", text)` equals the exact script above; `removeHelper` contains both commands in order.
- `profileFileExists("revamp-hydra", tmpDir)` → false, then true after writing the file.
- `installedExecutable`: write `<paths.applications>/revamp-hydra.desktop` with `Exec="<data>/apps/hydra/current/hydralauncher" %U` → `"hydralauncher"`; with `Exec="<data>/apps/hydra/current/bin/heroic" --no-sandbox %U` → `"bin/heroic"` (extra args ignored); with `Exec="/opt/Hydra/hydralauncher" %U` → throws `/not under .*apps\/hydra\/current/`; missing file → throws `/hydra is not installed/`.

- [ ] **Step 2: Run, expect failure**

Run: `node --test packages/engine/test/sandbox-profile.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

- `installedExecutable` uses `desktopFilePath` and `parseDesktopEntry` (both in the engine), takes the first `"…"`-quoted token of `Exec`, unescapes `\"`, `\\`, `` \` ``, `\$` and `%%`, checks the prefix `join(appDir(paths, appId), "current") + "/"`, and returns the rest through `assertSafeRelativePath("executable", …)`.
- `profileName` matches `existing` against the pattern prefix `<dataDir>/apps/<appId>/`; the suffix is `assertSafeName("user", username)`.
- Export the module's functions and constants from `index.ts`; `desktopFilePath` and `parseDesktopEntry` stay internal (no later task needs them outside the engine).

- [ ] **Step 4: Run, expect pass**

Run: `node --test packages/engine/test/sandbox-profile.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): AppArmor profile text, helper scripts and the installed executable for the sandbox fix"
```

---

### Task 2: Engine `doctor.ts` and the report note

**Files:**
- Create: `packages/engine/src/doctor.ts`, `packages/engine/test/doctor.test.ts`
- Modify: `packages/engine/src/install.ts:216-229` (`environmentWarnings`), `packages/engine/src/api.ts:263`, `packages/engine/src/index.ts`, `packages/engine/test/install.test.ts:141-144`

**Interfaces:**
- Consumes: Task 1's `userNamespacesRestricted`, `profileName`, `profileFileExists`; `listInstalls`, `loadSources`, `loadLastCheck`, `revampPaths`; the CLI's `onPath` logic is re-implemented here as `onPath(entries, dir)` (move it from `cli/src/install.ts` into the engine and re-export; update the CLI import).
- Produces:
```ts
export type DoctorSeverity = "ok" | "fixable" | "broken";
export interface DoctorCheck { id: string; label: string; severity: DoctorSeverity; detail: string; fix?: string }
export interface DoctorEnv {
  platform: string; arch: string; glibc?: string;            // from process + process.report
  readFile(path: string): string | undefined;                 // sysctl
  fileExists(path: string): boolean;                          // profiles, the window binary
  sharedLibs(): string[];                                     // `ldconfig -p` lines, [] when unavailable
  timer(): { enabled: boolean; active: boolean; lastTrigger?: string; nextElapse?: string } | undefined; // undefined = no systemctl
  pathEntries: string[]; home: string; username: string;
}
export function realDoctorEnv(): DoctorEnv;
export function runDoctor(paths: Paths, env: DoctorEnv): DoctorCheck[];
export function doctorExitCode(checks: DoctorCheck[]): 0 | 1 | 2;   // 2 if any broken, else 1 if any fixable, else 0
export const WINDOW_GLIBC = "2.39";
```
- `environmentWarnings(app: { id: string; name: string }, o?: { sysctl?: string; profileExists?: (name: string) => boolean }): string[]`. The second line becomes exactly: `This system restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1), so Electron's sandbox can't start in an app installed in your home folder. Run once: revamp sandbox <id>` and is omitted when `profileExists("revamp-<id>")` is true.

Checks, in order, with ids and exact labels:
| id | label | ok when | severity when not | fix |
|---|---|---|---|---|
| `platform` | `Platform` | `linux` + `x64` | broken | `Revamp 1.x ships for Linux x86_64` |
| `glibc` | `glibc (window)` | only when `<data>/gui/revamp-gui` exists: glibc ≥ 2.39 (compare major.minor numerically) | broken | `The window needs glibc 2.39 or newer (Ubuntu 24.04, Linux Mint 22 or newer)` |
| `webkitgtk` | `WebKitGTK 4.1 (window)` | only when the window exists: some line contains `libwebkit2gtk-4.1.so.0` | fixable | `sudo apt install libwebkit2gtk-4.1-0` |
| `userns` | `User namespaces` | sysctl not `1` → detail `unrestricted` | (info line) | — |
| `sandbox-<app>` | `Sandbox profile for <App id>` one per installed app, only when restricted | profile file exists → detail `/etc/apparmor.d/<name> present (whether it's loaded needs root to read; revamp sandbox <app> reloads it)` | fixable | `revamp sandbox <app>` |
| `path` | `~/.local/bin on PATH` | `onPath(pathEntries, <home>/.local/bin)` | fixable | `Add ~/.local/bin to your PATH` |
| `timer` | `Daily check` | `timer()` enabled and active → detail `last run <lastTrigger>, next <nextElapse>`; `undefined` → ok with detail `unknown (no systemctl)` | fixable | `revamp timer enable` |
| `sources` | `Bundle sources` | ≥ 1 source → detail one line per source: `<location> <name> <version>`, then `last check <checkedAt>` or `never checked` | fixable | `revamp sources add xb00tt/revamp-patches` |
| `apps` | `Revamped apps` | always ok: detail `<app> <current>` per app, or `none yet` | — | — |

- [ ] **Step 1: Write the failing tests** (`doctor.test.ts`, a fake `DoctorEnv` and temp `Paths`)

- All green on a healthy fake (linux/x64, glibc `2.39`, window present, webkit line present, sysctl `0`, PATH includes `<home>/.local/bin`, timer enabled+active, one source, one app): every severity `ok`, `doctorExitCode` 0, the `timer` detail contains the two timestamps.
- Window absent: no `glibc` and no `webkitgtk` checks.
- glibc `2.35` with the window → `glibc` broken, exit 2. Platform `darwin` → broken.
- Webkit line missing → fixable with the apt fix.
- Sysctl `1`, apps `hydra` (profile file absent) and `heroic` (present): `sandbox-hydra` fixable with fix `revamp sandbox hydra`; `sandbox-heroic` ok, detail mentions `needs root to read`. Exit 1.
- `timer()` returns `undefined` → ok, detail `unknown (no systemctl)`; `{ enabled: false, active: false }` → fixable.
- No sources → fixable; `loadLastCheck` null → `never checked`.
- PATH without the dir → fixable; a trailing-slash entry counts as present (`onPath`).
- `environmentWarnings({ id: "hydra", name: "Hydra" }, { sysctl: <file with 1> })` → second line ends with `Run once: revamp sandbox hydra`; with `profileExists: () => true` → one line only. Update the two existing assertions in `install.test.ts`.

- [ ] **Step 2: Run, expect failure**

Run: `node --test packages/engine/test/doctor.test.ts packages/engine/test/install.test.ts`

- [ ] **Step 3: Implement**

- `realDoctorEnv()`: `process.report.getReport().header.glibcVersionRuntime` (inside try, undefined on failure); `spawnSync("ldconfig", ["-p"])` → lines or `[]`; `spawnSync("systemctl", ["--user", "show", "revamp-check.timer", "-p", "ActiveState", "-p", "LastTriggerUSec", "-p", "NextElapseUSecRealtime", "-p", "UnitFileState"])` → parse `key=value` lines (`enabled` = `UnitFileState` is `enabled`, `active` = `ActiveState` is `active`), `undefined` when the spawn fails; `username` from `os.userInfo().username`.
- `api.ts:263` passes `{ id: app.id, name: app.name }` and `profileExists: (n) => profileFileExists(n)`.

- [ ] **Step 4: Run, expect pass**

Run: `node --test packages/engine/test/*.test.ts packages/cli/test/install.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/engine packages/cli
git commit -m "feat(engine): doctor checks as data; the install note names revamp sandbox"
```

---

### Task 3: CLI `sandbox <app>` and the uninstall cleanup

**Files:**
- Create: `packages/cli/src/sandbox.ts`, `packages/cli/test/sandbox.test.ts`
- Modify: `packages/cli/src/main.ts` (new case, `uninstall` case at 162-168, USAGE), `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 1 (`profileName`, `profilePattern`, `profileText`, `installHelper`, `removeHelper`, `profileFileExists`, `installedExecutable`, `userNamespacesRestricted`, `PROFILE_DIR`); `revampPaths`, `confirm`, `print`, `printError`, `--yes`.
- Produces (`cli/src/sandbox.ts`):
```ts
export type Spawn = (cmd: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
export interface PromptEnv { PATH?: string; DISPLAY?: string; WAYLAND_DISPLAY?: string }
/** pkexec is on PATH and a display is set. */
export function canPrompt(env: PromptEnv, exists?: (p: string) => boolean): boolean;
/** Writes <paths.state>/sandbox/<name>.sh (0644) and returns its path. */
export function writeHelper(paths: Paths, name: string, script: string): string;
/** Runs `pkexec /bin/sh <helper>`; returns { ok, status, output }. */
export function runAsRoot(helper: string, spawn?: Spawn): { ok: boolean; status: number | null; output: string };
export function sudoInstructions(helper: string): string;   // exactly: `Run it with sudo instead:\n  sudo sh ${helper}`
```

`revamp sandbox <app>` flow:
1. `installedExecutable(paths, id)` (throws `<id> is not installed` otherwise).
2. `name = profileName(id, existing, paths.data, username)` where `existing` = the current `/etc/apparmor.d/<revamp-id>` text if readable; `text = profileText(name, profilePattern(paths.data, id, exe))`; `helper = writeHelper(paths, name, installHelper(name, text))`.
3. If `!userNamespacesRestricted()`: print `This system doesn't restrict user namespaces, so Revamped <id> starts without a profile. Installing one anyway is harmless.` and continue.
4. Print the profile text, then `This writes /etc/apparmor.d/<name> and loads it with apparmor_parser -r (helper: <helper>).`
5. If `!canPrompt(process.env)`: print `sudoInstructions(helper)` and return 1.
6. Unless `--yes`: `confirm("Write it with administrator rights?")`; No → print `Nothing changed. ${sudoInstructions(helper)}` and return 1.
7. `runAsRoot(helper)`: ok → print `Installed and loaded /etc/apparmor.d/<name>. Start <id> (Revamped) again.` and return 0; status 126 or 127 → print `The administrator prompt was cancelled; nothing changed.` and return 1; other → print `pkexec failed (exit <status>): <output>` + sudo instructions, return 1.

`revamp uninstall <app>`: after the existing removal, compute `name = profileName(id, existing, paths.data, username)`; if `profileFileExists(name)`: write `helper = writeHelper(paths, `${name}-remove`, removeHelper(name))`, print `A sandbox profile /etc/apparmor.d/<name> remains.`, then: with `--yes` remove it at once; otherwise `confirm("Remove it with administrator rights?")`, and on No print `It stays. ${sudoInstructions(helper)}`. Removal goes through `canPrompt` → `runAsRoot(helper)` with the same three outcomes as the install (success: `Removed /etc/apparmor.d/<name>.`; cancelled: `The administrator prompt was cancelled; the profile stays.`; no prompt possible: `sudoInstructions`). The uninstall's exit code stays 0 whether or not the profile was removed.

Step 4's "two commands" line prints exactly: `This writes /etc/apparmor.d/<name> and runs: apparmor_parser -r /etc/apparmor.d/<name>  (helper: <helper>)`.

USAGE gains `  revamp doctor         check this machine: libraries, the sandbox, PATH, the timer, sources` (Task 4 uses it too) and `  revamp sandbox <app>  install the AppArmor profile a Revamped app needs on Ubuntu 24.04+ (one administrator prompt)`.

- [ ] **Step 1: Write the failing tests**

`sandbox.test.ts` (in-process):
- `canPrompt({ PATH: "/usr/bin", DISPLAY: ":0" }, (p) => p === "/usr/bin/pkexec")` → true; without `DISPLAY` and `WAYLAND_DISPLAY` → false; with `WAYLAND_DISPLAY: "wayland-0"` → true; when `exists` is false everywhere → false.
- `writeHelper` creates `<state>/sandbox/<name>.sh` with the script and mode `0o644`, and overwrites on a second call.
- `runAsRoot` with a fake spawn recording its arguments → called with `("pkexec", ["/bin/sh", helper])`; status 0 → `ok: true`; status 126 → `ok: false`, status 126.
- `sudoInstructions("/x/y.sh")` → the exact two-line text.

`cli.test.ts` (spawned CLI on `freshHome()`), adding a PATH override to the `cli()` helper (`env.PATH` set to a temp bin dir + the existing PATH):
- `revamp sandbox hydra` on a fresh home → status 1, stderr matches `/hydra is not installed/`.
- With a fake install: write `<home>/.local/share/applications/revamp-hydra.desktop` with `Exec="<home>/.local/share/revamp/apps/hydra/current/hydralauncher" %U`, a fake `pkexec` script in the temp bin dir that appends its args to `<home>/pkexec.log` and exits 0, `DISPLAY=:0`, and `--yes`: status 0, stdout contains `profile revamp-hydra "<home>/.local/share/revamp/apps/hydra/*/hydralauncher"` and `Installed and loaded /etc/apparmor.d/revamp-hydra`, `pkexec.log` contains `/bin/sh <home>/.local/state/revamp/sandbox/revamp-hydra.sh`, and that helper file's content equals `installHelper(...)` for that profile.
- Same, with the fake `pkexec` exiting 126 → status 1, stdout matches `/cancelled; nothing changed/`.
- Same, with `DISPLAY` and `WAYLAND_DISPLAY` removed from the spawn env (the `cli()` helper must allow deleting them: the test machine has `DISPLAY=:0`) → status 1, stdout matches `/sudo sh .*revamp-hydra\.sh/`, and `pkexec.log` doesn't exist.
- Input `n\n` without `--yes` → status 1, `Nothing changed`, no `pkexec.log`.
- `revamp uninstall hydra --yes` on the fake install (the app dir must exist for `uninstall`: create `<data>/apps/hydra/current` as a dir): completes; since `/etc/apparmor.d/revamp-hydra` doesn't exist in the test, no profile line is printed. (The cleanup's root path is covered by the unit tests of `removeHelper` + `runAsRoot`; it is not exercised end to end.)

- [ ] **Step 2: Run, expect failure**

Run: `node --test packages/cli/test/sandbox.test.ts packages/cli/test/cli.test.ts`

- [ ] **Step 3: Implement** `sandbox.ts` and the two `main.ts` cases as specified. The `existing` profile text is read with `readFileSync` inside a try (`/etc/apparmor.d/*` is world-readable when present).

- [ ] **Step 4: Run, expect pass**

Run: `node --test packages/cli/test/*.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): revamp sandbox <app> writes the AppArmor profile through pkexec; uninstall offers to remove it"
```

---

### Task 4: CLI `doctor`

**Files:**
- Modify: `packages/cli/src/main.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:** consumes Task 2 (`runDoctor`, `realDoctorEnv`, `doctorExitCode`).

Output: one line per check: `✓ <label>: <detail>` for ok, `✗ <label>: <detail>` followed by `    Fix: <fix>` when a fix exists; multi-line details (sources, apps) indent their extra lines by four spaces. Exit code from `doctorExitCode`. Everything through `print`.

- [ ] **Step 1: Write the failing test** in `cli.test.ts`: `revamp doctor` on `freshHome()` (empty `sources.json`, no apps) → stdout contains `✓ Platform: Linux x64`, `✗ Bundle sources: none`, `Fix: revamp sources add xb00tt/revamp-patches`, `✓ Revamped apps: none yet`; status is 1 or 2 (the machine decides PATH and timer), and stdout has no line for `glibc (window)` because the fresh home has no window.
- [ ] **Step 2: Run, expect failure.** `node --test --test-name-pattern='doctor' packages/cli/test/cli.test.ts`
- [ ] **Step 3: Implement** the `doctor` case (`realDoctorEnv()` is used only here; the test's environment makes the machine-dependent lines vary, hence the loose status assertion).
- [ ] **Step 4: Run, expect pass.** `node --test packages/cli/test/cli.test.ts && npm run typecheck`
- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): revamp doctor"
```

---

### Task 5: `serve` methods and the window banner

**Files:**
- Modify: `packages/cli/src/serve.ts`, `packages/cli/test/serve.test.ts`, `packages/gui/src/model.ts`, `packages/gui/src/App.tsx`, `packages/gui/test/model.test.ts`

**Interfaces:**
- `serve` methods:
  - `doctor.run` → `{ checks: DoctorCheck[]; exitCode: 0 | 1 | 2 }`.
  - `sandbox.status` → `{ restricted: boolean; canPrompt: boolean; apps: Array<{ appId: string; profile: string; installed: boolean }> }` (one entry per installed app with a current version; `installed` = the profile file exists).
  - `sandbox.fix { appId }` → runs Task 3's flow without the confirm (the pkexec dialog is the confirmation): returns `{ ok: true, profile }` or throws `RpcError(-32000, <the same messages as the CLI>)`; when `canPrompt` is false it throws with `sudoInstructions`.
- `model.ts`: `export function sandboxNote(status: SandboxStatus): string | null` → `null` when `!restricted` or every app is installed; else `This system restricts user namespaces, so Revamped apps can't start their sandbox. Revamp can install an AppArmor profile for <Hydra, Heroic> (one administrator prompt each).` with the app ids joined by `, `. `export interface SandboxStatus` mirrors the RPC result.

- [ ] **Step 1: Write the failing tests**
  - `serve.test.ts`: `doctor.run` returns `checks` with a `platform` entry and a numeric `exitCode`; `sandbox.status` on the demo home (sysctl of the test machine; make the result shape assertions independent of its value: `typeof restricted === "boolean"`, `apps` is an array with the installed demo app and `installed === false`); `sandbox.fix` with an unknown app → error code `-32000`, message `/is not installed/`.
  - `model.test.ts`: `sandboxNote({ restricted: false, canPrompt: true, apps: [...] })` → null; restricted with all installed → null; restricted with `hydra` not installed → the exact text with `hydra`.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement.** In `App.tsx`: after `apps.list`, call `sandbox.status`; when `sandboxNote` isn't null, render `<div className="banner warning">{note}<div className="row-actions">` with one button per app lacking a profile, `Fix the sandbox for <appId>`, that calls `sandbox.fix` through the existing `task()` wrapper and then refreshes; when `canPrompt` is false the buttons are replaced by the text `Run revamp sandbox <app> in a terminal.`
- [ ] **Step 4: Run, expect pass.** `npm test && npm run typecheck`
- [ ] **Step 5: Browser pane (controller).** `XDG_CACHE_HOME="$HOME/.cache" HOME=<tmp> npm run dev -w @revamp-app/gui` with a fake restricted state is not possible without root; check instead that the banner is absent on this unrestricted machine and that `doctor.run` answers in the dev console. The banner's rendering is covered by the model test; its JSX is reviewed.
- [ ] **Step 6: Commit**

```bash
git add packages/cli packages/gui
git commit -m "feat(gui): sandbox banner with a fix button per app; serve exposes doctor and sandbox"
```

---

### Task 6: Docs, 1.1.0, verification

**Files:**
- Modify: `docs/electron-sandbox.md`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-18-revamp-v2-design.md`, the version files listed in the file map.

- [ ] **Step 1: Docs**
  - `docs/electron-sandbox.md`: replace "Revamp v1 does not change this for you; pick one of the options below" with: Revamp 1.1 does it: `revamp sandbox <app>` (what it writes, the one prompt, `revamp doctor` to check). Keep Option 1 as the manual equivalent and Option 2 (`--no-sandbox`) as the last resort.
  - `README.md`: an **If a Revamped app won't start** line under Install pointing at `revamp doctor` and `revamp sandbox <app>`.
  - `CLAUDE.md`: `doctor` and `sandbox <app>` in the CLI command list; one bullet under Distribution: "`revamp sandbox` writes `/etc/apparmor.d/revamp-<app>` through `pkexec /bin/sh <state>/sandbox/<name>.sh`; tests never run pkexec (a fake on PATH)".
  - The v2 spec §5.1: add after the sysctl bullet: "(`/sys/kernel/security/apparmor/profiles` is root-only, so `doctor` reports the profile file in `/etc/apparmor.d/`, not the loaded state.)"
  - `CHANGELOG.md` `## 1.1.0`: `revamp doctor`; `revamp sandbox <app>` for stock Ubuntu 24.04+; the window banner; the install note.
- [ ] **Step 2: Version 1.1.0** in `packages/{sdk,engine,cli,gui}/package.json`, `engine/src/version.ts`, `src-tauri/tauri.conf.json`, `Cargo.toml`; refresh `package-lock.json` and `Cargo.lock`; fix `test/integration/packages.test.ts` if it names the version.
- [ ] **Step 3: Verify.** `npm test && npm run typecheck`, then `REVAMP_INTEGRATION=1 npm run test:integration` (sea + packages). Expected: all pass; `git status --porcelain` empty after a `npm run build -w @revamp-app/cli`.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: doctor and sandbox; Revamp 1.1.0"
```

---

### Task 7: Review, PR, release (owner-confirmed)

- [ ] Whole-branch review (`superpowers:requesting-code-review`); fix what it confirms.
- [ ] Open the PR against `main`; the owner merges.
- [ ] **(ask)** Release 1.1.0: the owner runs `npm run publish:packages` in their terminal (npm needs its one-time password) from a clean worktree at origin/main; the controller then runs `npm run release:app` there. The owner installs it from the tarball with `./revamp self-install` (self-update arrives in M8).
- [ ] **Acceptance on a restricted machine** (spec M6): the owner, or a throwaway VM/container with `kernel.apparmor_restrict_unprivileged_userns=1`, AppArmor and polkit: fresh tarball install, `revamp patch hydra`, `revamp sandbox hydra`, Hydra (Revamped) starts, `revamp doctor` green. Not reproducible on the owner's Mint (sysctl `0`); the owner may still run `revamp sandbox hydra` there to see the prompt and the profile land, which is harmless.
