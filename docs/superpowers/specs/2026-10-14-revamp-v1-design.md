# Revamp v1: design

- **Date:** 2026-10-14
- **Status:** draft, waiting for the owner's review
- **Inputs:**
  - `docs/kickoff-prompt.md`: its settled decisions are not repeated here.
  - `docs/research/morphe.md`.
  - The brainstorm on 2026-10-14 (decision log in §2).
  - Measurements and probes on the owner's machine (§3).

Revamp is Morphe for Linux Electron apps. It does four things:
- downloads an official release
- edits the built JavaScript inside `app.asar` once, at rest
- installs the result next to the stock app in the user's home
- re-applies the same patches when a new release ships

v1 serves the owner (Hydra daily use, one Heroic demo patch). The patch format and the bundles are community-ready.

---

## 1. Goals and success

v1 removes four pains of the owner's hand-built Hydra fork:

| Pain | v1 answer |
|---|---|
| Build toolchain (yarn, electron-builder, cargo, minutes per build) | Patch the shipped `.deb`. No toolchain at patch time; seconds, not minutes. |
| Upstream churn (merge and re-check every release) | Fingerprints instead of merges. A new release either applies or fails per patch with a precise message. |
| Install plumbing (`dist/linux-unpacked` plus a hand-made desktop entry) | `revamp patch hydra` installs to `~/.local/share` and writes the menu entry. |
| No sharing | Bundles are single files that anyone can publish. Users add them as sources. |

**v1 is done when** all five milestones (§13) pass. The headline criterion is milestone 3: the owner switches daily use from the fork to Revamped Hydra and retires the fork.

**Scope note, confirmed with the owner.** The fork branch contains about 50 unreleased upstream commits (Epic/Legendary, umu runtime, RPCS3 cloud saves, OTA bridge). Revamp patches official releases only, so these arrive when Hydra releases them. Revamped Hydra 4.1.6 plus the owner's three features is the replacement.

## 2. Decision log (brainstorm 2026-10-14)

The settled decisions from the kickoff (#1–#11) still apply. These were decided in the brainstorm:

| # | Question | Choice | Evidence / reason |
|---|---|---|---|
| Q1 | JS parser | **acorn** (pure JS, ESTree) | Measured on Hydra's 13.76 MB renderer (1.41 M nodes): 1.0–1.5 s, 389 MB RSS, works under `--permission` with no extra flags. meriyah was about 0.3 s faster but used about 120 MB more. Native oxc and ast-grep were no faster (oxc pays for deserialization), need `--allow-addons` (Node warns it "could invalidate the permission model"), and ast-grep patterns failed on case clauses and object keys. |
| Q2 | Fingerprint API | **By example**: code patterns with `$X` and `$$$` blanks, a mandatory `strings` prefilter, optional named `where` checks, and `count`. Regex is an escape hatch. | Hydra and Heroic fingerprints written in all three candidate styles (§5.3). Code-shaped patterns read like the target code and capture mangled names for reuse. |
| Q3 | Bundle format | **One self-contained ESM `.mjs`**, published with `bundle.json` and `patches.json` | Nothing to unpack (no path-traversal surface), and one hash covers everything. The label is readable without running code via `patches.json` and `bundle.json`. |
| Q4 | Engine ↔ GUI IPC | **stdin/stdout pipe**, newline-delimited JSON-RPC 2.0 | No port, no auth token, no browser CSRF surface, and the lifetime is tied to the window. Tauri supports this for sidecars natively. |
| Q5 | State layout | **XDG split** with a `current` symlink and a per-install receipt | Standard locations. Backups skip the cache. Rollback means repointing one link. |
| Q6 | Extension ↔ app contract | **A `globalThis.__revamp` registry for shared things.** Extensions compile their own copies of pure libraries. | A second copy of React, Redux, i18n or the router silently breaks hooks and context. Pure libraries are safe to duplicate and add no fingerprints. |
| Q7 | Repo layout | **npm workspaces:** `packages/{sdk,engine,cli,gui}` plus `bundles/official`. One `revamp` binary serves both CLI and GUI. | Keeps the SDK separable for community bundles. Every engine fix lands in both front ends. |
| Q8 | Node version | **Node 26** (Active LTS from 2026-10-28, EOL 2029-04-30) as both runtime and dev runtime | Node 26 `--permission` blocks the network (tested: `fetch` → `ERR_ACCESS_DENIED`). Node 24 has no `--allow-net`. Node 26 also has one-step `--build-sea` and an ESM SEA entry. |

## 3. Verified facts (2026-10-14)

### 3.1 Electron and the apps
- **Fuses (Hydra and Heroic, identical).**
  - `EnableEmbeddedAsarIntegrityValidation` is **off** and `OnlyLoadAppFromAsar` is **off**. `RunAsNode` is on.
  - Asar integrity is enforced on macOS and Windows only (electronjs.org/docs/latest/tutorial/asar-integrity).
  - So a rewritten asar loads.
- **Versions.** Hydra 4.1.6 runs Electron 41.10.3 (binary `/opt/Hydra/hydralauncher`). Heroic 2.22.3 runs Electron 43.1.1.
- **Relocation is safe.**
  - Hydra finds its helpers through `process.resourcesPath`: `7zzs`, `ludusavi`, `umu-run`, `hydra-native/*.node`, `.so` files, `achievement.wav`.
  - There is no hardcoded `/opt/Hydra` and no self-integrity check.
  - Copying the whole app tree works. `chrome-sandbox` is not setuid.
- **userData.** Hydra resolves `~/.config/hydralauncher` from `package.json` `name` (`hydralauncher`); the asar has no `productName`. A copy that leaves `name` untouched shares userData with stock, which is intended.
- **Single instance.** Hydra calls `requestSingleInstanceLock()`, and the lock lives in userData.
  - If stock Hydra is running, launching Revamped focuses stock and quits.
  - Only one Hydra runs at a time. Heroic behaves the same.
- **Window class.**
  - WM_CLASS is the Electron *desktop name* minus `.desktop`, which defaults to `<package name>.desktop`.
  - So both copies are `hydralauncher` and group in the Cinnamon panel.
  - Fix: set `desktopName` in the asar's `package.json`. Neither `--class` nor `CHROME_DESKTOP` works, because Electron's init overwrites them.
- **Deep links.**
  - Hydra calls `app.setAsDefaultProtocolClient("hydralauncher")` on every start.
  - Electron registers the *desktop name* as the `x-scheme-handler/hydralauncher` default via GIO.
  - With the new `desktopName`, Revamped claims `hydralauncher://` links on each start, and stock reclaims them on its own start.
- **Self-updater.**
  - Hydra uses electron-updater 6.6.2 as a real module at `node_modules/electron-updater/out/*.js`. It checks every 50 minutes, plus a renderer IPC.
  - `resources/package-type` = `deb` → `DebUpdater` → `pkexec /bin/bash -c 'dpkg -i …'`.
  - Heroic bundles electron-updater into `build/main/main.js`.
  - Both have `AppUpdater.isUpdaterActive()`. When it returns `false`, `checkForUpdates()` resolves `null`, which is the "not packaged" path developers hit daily. Hydra's `UpdateManager` only logs the `null` result.
  - Deleting `app-update.yml` instead causes unhandled rejections. Don't.
- **asar format.**
  - A 16-byte pickle prefix, then a JSON header (Hydra: about 8 MB, 30,658 files, 164 of them `unpacked`).
  - File offsets are decimal strings relative to the end of the header.
  - Each file entry carries `integrity {algorithm: "SHA256", hash, blockSize: 4194304, blocks}`.
  - Unpacked files live in `app.asar.unpacked/` and have no offset.
- **Electron sandbox.**
  - The owner's Mint has `kernel.apparmor_restrict_unprivileged_userns = 0`, so the home copy runs.
  - Stock Ubuntu 24.04+ sets it to 1.
  - Documented, not solved, in v1 (§14).
- **Heroic data is not shared.**
  - The owner's Heroic is a Flatpak (data in `~/.var/app/com.heroicgameslauncher.hgl/config/heroic`).
  - The `.deb` build uses `~/.config/heroic`, so Revamped Heroic starts without the owner's logins.
  - Acceptable for the milestone-2 demo patch.

### 3.2 Built code
- **Hydra renderer.**
  - `out/renderer/assets/index-<hash>.js`: 13.76 MB, 276k lines, ESM, unminified.
  - esbuild `keepNames` wraps functions as `__name(fn, "origName")`.
  - Identifiers sometimes get `$1` suffixes, and names are not unique: there are two `sortLibraryGames` and two `useAppSelector` (the second one is recharts').
  - Fingerprints anchor on behavior strings (case labels, i18n keys, route paths), not names.
- **Hydra main.** `out/main/index.js`: 4.6 MB, ESM.
- **Heroic.**
  - Renderer chunks are `build/assets/App.js` (1 MB, minified, e.g. `d.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals")})`), `index4.js`, …, plus a hashed entry `index-<hash>.js`.
  - Main is `build/main/main.js` (12.9 MB).
- **Hydra translations** are inlined object literals:
  - Each namespace object (e.g. `const library$y = { "library": "Library", … }`) is referenced from a locale object (`const en$1 = { …, library: library$y }`).
  - Those are referenced from `const resources = { "pt-BR": ptBR$1, en: en$1, bg, … }`.
- **Hydra "More like this".**
  - Stock 4.1.6 already has `function SimilarGames({ objectId, shop })`, rendered once as `jsx(SimilarGames, { objectId, shop })` in game details.
  - The fork's rework is renderer-only and adds no i18n keys.

### 3.3 Node (owner has 24.18; Revamp targets 26.12+)
- **Node 26 permission flags.** `--permission` is stable. `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi` and `--allow-net` exist; `--allow-net` is experimental and arrived in v25.0.
- **SEA binaries ignore Node flags in argv.** Flags reach a SEA child only through `--node-options="…"` when the SEA config has `execArgvExtension: "cli"`.
  - Tested: in the child, reads outside the allowed dir and `child_process` were denied, and `fetch` was denied on 26.
- **Loading the bundle.** On Node 26, `import()` of a file on disk inside a SEA fails with `ERR_UNKNOWN_BUILTIN_MODULE`, but `createRequire(path)(path)` (require(esm)) works. So bundles must not use top-level `await`.
- **SEA size.** The Node 26 SEA binary is about 144 MB on disk.
- **Native TypeScript.** Node runs `.ts` natively (type stripping). Tests use `node --test` with no TS runner.

### 3.4 Releases
| App | Asset | Size | SHA-256 (GitHub `digest`) |
|---|---|---|---|
| Hydra 4.1.6 | `hydralauncher_4.1.6_amd64.deb` (tag `v4.1.6`) | 149,549,332 | `fc075d4c9334fa7462cdfe4faef625f61e6933df48fa03e1939b635951147363` |
| Heroic 2.22.3 | `Heroic-2.22.3-linux-amd64.deb` (tag `v2.22.3`) | 127,528,508 | `f89eed7e0eb900fbe3051edfedbe7532db14328241cbf8c1fb766462dfc0b849` |

The integration test re-checks the Hydra hash against the downloaded bytes.

---

## 4. Architecture

### 4.1 Repo layout
```
revamp/
  package.json            npm workspaces root; engines.node ">=26"
  packages/
    sdk/                  @revamp/sdk: declarations and types for bundle authors (no engine code)
    engine/               @revamp/engine: download, verify, unpack, asar, fingerprints, edits,
                          patch graph, sandbox, install, state
    cli/                  @revamp/cli: `revamp` command and `revamp serve`; builds the SEA binary
    gui/                  Tauri v2 shell (Rust boilerplate) + Vite/React/TS web UI   [M5]
  bundles/
    official/             Hydra + Heroic app definitions, patches, extensions; builds
                          dist/official.mjs + bundle.json + patches.json
  docs/
```
**Tooling:**
- `node --test` runs `.ts` natively.
- `tsc --noEmit` for types.
- esbuild for the CLI bundle (SEA input), the bundle file and extensions.

**Runtime dependencies:**
- engine: `acorn`, plus one xz decompressor (pure JS or WASM, no native addon, no external process). The M1 plan picks the package by measuring it on the real `.deb`.
- `@electron/asar` is a dev dependency, used only as a test oracle.

### 4.2 Units

| Unit | Does | Depends on |
|---|---|---|
| `sdk` | `defineApp`, `definePatch`, `fingerprint`, option builders, and types for `ctx`, `Match` and the extension registry. Returns plain data. | nothing |
| `engine/state` | XDG paths (honors `$XDG_*`), config JSON read/write, receipts | node |
| `engine/download` | `fetch` to file with streaming SHA-256 and progress events; cache lookup | node |
| `engine/deb` | `ar` → `data.tar.{xz,zst,gz}` → tar, extracted safely into a directory | xz lib, `node:zlib` |
| `engine/asar` | Read header and files; write a new asar = old data + appended files + new header | node |
| `engine/pattern` | Compile a pattern string to a matcher; match against an acorn AST with a node-type index | acorn |
| `engine/fingerprint` | strings → pattern → where → count pipeline with per-job caching and `FingerprintError` | pattern |
| `engine/edits` | Per-file splice buffer, list-aware insert/remove, overlap detection, apply, re-parse check | acorn |
| `engine/graph` | Selection, dependency order, transactional patch execution, failure propagation, finalize | — |
| `engine/sandbox` | Parent: spawn the child with permission flags. Child (`runner`): load bundle, build `ctx`, run graph, write outputs. | graph, fingerprint, edits, asar |
| `engine/install` | Staging, receipt, `current` symlink, desktop entry, retention, warnings | state |
| `engine/api` | Facade used by CLI and `serve`: `patchApp`, `listPatches`, `listInstalled`, `rollback`, `check`, `update`, sources | all |
| `cli` | `node:util.parseArgs` commands → `engine/api`; `serve` = JSON-RPC over stdio | engine |
| `bundles/official` | App definitions, patches, extension sources, build script | sdk (types), esbuild |

### 4.3 Patch job flow (`revamp patch hydra`)
1. **Describe and resolve.**
   - The parent never runs bundle code, so it first runs the sandbox child in **describe** mode (§4.4), with read access to the bundle file only.
   - The child returns plain JSON: `manifest`, `apps` (release info, versions and hashes, `installDir`, `required`) and every patch's metadata (name, description, compatibility, default, options, dependsOn). This is the same data the bundle build writes to `patches.json`.
   - Check `manifest.minEngine` ≤ engine version, otherwise stop with "bundle needs Revamp ≥ X".
   - Pick the version: `--version`, otherwise the newest *stable* version in `app.versions`.
   - Resolve the selection: required patches, defaults and saved choices, plus flags.
2. **Download.**
   - The URL is `https://github.com/<repo>/releases/download/<tag>/<asset>`, cached at `~/.cache/revamp/releases/<app>/<version>/<asset>`.
   - Verify the SHA-256 against `app.versions[v].sha256`, and stop on mismatch.
   - Unlisted versions (only with `--force`) are verified against the GitHub API asset `digest` and labeled *untested*.
3. **Stage.**
   - Create `~/.local/share/revamp/apps/<app>/.staging-<id>/`.
   - Extract `data.tar.*` from the `.deb`:
     - the contents of `app.installDir` (e.g. `opt/Hydra/**`) go to the staging root
     - `app.desktopFile` is kept in memory
     - the icon named by its `Icon=` key is saved to `revamp-icon.png`: the largest `usr/share/icons/hicolor/<size>/apps/<Icon>.png`
     - everything else is skipped
   - Staging sits on the same filesystem as the final directory, so the install is an atomic rename.
4. **Patch (sandboxed child).**
   - Reads: the staging dir and the bundle file. Writes: `<staging>/.revamp-out/` only.
   - Runs every patch through the graph, applies the buffered edits, and re-parses every changed JS file with acorn. A syntax error fails the job and names the file, the position and the patches that edited it.
   - Writes the changed and new files plus `result.json` (per-patch status, the desktop-entry overrides, timings).
5. **Repack (parent).**
   - Write `app.asar.new` = the original data region copied as-is, with the changed and new files appended. Update their header entries (size, offset, integrity) and write the header.
   - Swap the new asar into place and delete `.revamp-out/`. `app.asar.unpacked/` is untouched.
   - Edits never reprint whole files: the 13.7 MB renderer gets only its splices.
6. **Install (parent).**
   - Rename staging to `apps/<app>/<version>/`. If that version is already installed, the old directory is renamed aside first and deleted after the swap.
   - Write the receipt `apps/<app>/<version>/revamp.json`: bundle name, version and SHA-256, release SHA-256, applied patches with their options, failed patches, time.
   - Atomically repoint `apps/<app>/current`: write a temp symlink, then rename.
   - Write `~/.local/share/applications/revamp-<app>.desktop` from the stock entry plus the patches' `desktopEntry` overrides:
     - `Exec="…/apps/<app>/current/<executable>" %U`
     - `Icon=…/apps/<app>/current/revamp-icon.png`
     - then run `update-desktop-database` on that directory if it exists.
   - Retention: keep the version `current` points to plus the most recent other version; delete the rest. Never delete `current`'s target.
   - Print warnings: the shared single-instance lock with stock, and the Electron userns sysctl when it is `1` (§14).
7. **Failure rules.**
   - Any failure before step 6 deletes the staging dir and leaves existing installs untouched.
   - A failed **required** patch aborts the job.
   - A failed optional patch is reported and the job installs without it.

**Performance target (M1).** With a cached `.deb`, a patch job takes seconds:
- extraction about 5–15 s (to be measured)
- acorn parse about 2 s for Hydra's two big files
- asar rewrite about 1 s

ponytail: if extraction dominates, cache the extracted tree per release and copy or hardlink from it.

### 4.4 Sandbox
- **The child is the same `revamp` binary** started with `REVAMP_SANDBOX=1`. It is spawned as:
  - SEA mode: `spawn(process.execPath, ["--node-options=--permission --allow-fs-read=<staging>,<bundle> --allow-fs-write=<staging>/.revamp-out", "--sandbox-runner", <jobfile>])`. This needs `execArgvExtension: "cli"` in the SEA config.
  - Dev mode (plain `node`): the same flags passed directly, plus read access to the repo root for the runner source and `node_modules`.
- **Two modes:**
  - `describe`: reads the bundle only and writes JSON to stdout.
  - `patch`: reads the bundle and staging, and writes to `.revamp-out/`.
  - The job file is JSON passed by path inside the readable set: mode, app, version, selection, options.
- **Granted:** reads of the staging dir and the bundle file; writes to the out dir.
- **Not granted:** network, child processes, workers, addons, WASI and inspector, none of which are flagged.
- **Timeout:** the child is killed after 180 s.
- **Loading the bundle:** the child loads it with `createRequire(bundle)(bundle)`. A bundle that throws on load fails the job with "bundle failed to load".
- **The parent never runs bundle code.** The parent does all network, hashing, extraction, asar writing and installing.
- **The parent never executes anything downloaded.** Extraction rejects:
  - absolute paths
  - `..` segments
  - symlinks or hardlinks resolving outside the target
  - device, FIFO and socket entries
  - duplicate paths

### 4.5 State layout
| Path | Contents |
|---|---|
| `~/.local/share/revamp/apps/<app>/<version>/` | the patched app tree, plus `revamp.json` (receipt) and `revamp-icon.png` |
| `~/.local/share/revamp/apps/<app>/current` | symlink to the active version |
| `~/.local/share/revamp/apps/<app>/.staging-<id>/` | in-progress job; removed on success or failure |
| `~/.local/share/applications/revamp-<app>.desktop` | menu entry |
| `~/.config/revamp/sources.json` | bundle sources with pinned SHA-256 [M4] |
| `~/.config/revamp/apps/<app>.json` | selection: enabled and disabled patch names, plus options |
| `~/.cache/revamp/releases/<app>/<version>/<asset>` | downloaded releases (keep those of installed versions plus the newest) |
| `~/.cache/revamp/bundles/<sha256>.mjs` | downloaded bundles [M4] |
| `~/.local/state/revamp/revamp.log`, `last-check.json` | log and last update-check result |
| `~/.config/systemd/user/revamp-check.{service,timer}` | daily check [M4] |
| `~/.local/bin/revamp` | the CLI binary (symlink to the installed SEA) |

The icon is referenced by absolute path through `current` (`Icon=…/apps/hydra/current/revamp-icon.png`), which avoids icon-theme caches.

---

## 5. Patch model (SDK)

### 5.1 Apps
```ts
export const hydra = defineApp({
  id: "hydra",
  name: "Hydra",
  release: { github: "hydralauncher/hydra", tag: "v{version}", asset: "hydralauncher_{version}_amd64.deb" },
  installDir: "opt/Hydra",            // inside the .deb data tree
  executable: "hydralauncher",        // relative to installDir
  desktopFile: "usr/share/applications/hydralauncher.desktop",
  versions: {
    "4.1.6": { sha256: "fc075d4c9334fa7462cdfe4faef625f61e6933df48fa03e1939b635951147363" },
    // "4.1.7": { sha256: "…", experimental: true },
  },
  required: [disableSelfUpdate, sideBySideIdentity],
});
```
- The release hash belongs to the **app version**, not to each patch; this changes the kickoff sketch.
- A version marked `experimental` is installable only with `--force`, as is any unlisted version.

### 5.2 Patches
```ts
export const recentlyDownloadedSort = definePatch({
  name: "Recently downloaded sort",            // omitted name = internal, hidden from users
  description: "Adds a 'Recently downloaded' option to the library sort menus.",
  compatibleWith: [{ app: hydra, versions: ["4.1.6"] }],   // versions omitted = all of the app's versions
  dependsOn: [],
  default: true,                               // default true; universal patches (no compatibleWith) are forced false
  options: {},
  execute(ctx) { /* §5.4 */ },
  finalize(ctx) { /* optional, runs after all patches, reverse order */ },
});
```
**Options:**
- Builders: `option.bool | string | number({ title, description?, default?, values?: Record<label, value>, required?, validate?(v): string | undefined })`.
- `values` are presets.
- `validate` returns an error message or `undefined`.
- Typed access: `ctx.options.<key>`.

**Bundle module exports** (the whole bundle is one ESM file, §7.1):
```ts
export const manifest = { name: "Revamp official", version: "0.1.0", minEngine: "0.1.0",
  author: "xb00tt", license: "GPL-3.0-only", source: "github:xb00tt/revamp" };
export const apps = [hydra, heroic];
export const patches = [/* every named patch; internal ones are reached through dependsOn */];
```

### 5.3 Fingerprints
```ts
export const librarySortSwitch = fingerprint({
  name: "library sort switch",
  strings: ['case "recently_played"', '"most_played"'],          // required, ≥1; all must occur in the file
  pattern: `[...$GAMES].sort(($A, $B) => { switch ($BY) { $$$ } $$$ })`,
  where: { "inside renderer": (m) => m.file.startsWith("out/renderer/") },  // optional named checks
  count: "one",                                                      // "one" (default) | "many" (≥1)
  scope: "app",                                                      // "app" (default) | "all"
});
```
**Which files are searched:**
- `scope: "app"` means every `.js`, `.mjs` and `.cjs` file in the asar outside `node_modules/`.
- `"all"` also includes `node_modules/`.
- Paths are never matched by chunk name. Fixed, meaningful paths (`package.json`, `out/renderer/index.html`) are reached with `ctx.file`, not fingerprints.

**Pipeline and errors.** Steps run in order, and the first step that leaves no candidates throws `FingerprintError`:
1. `strings`: indexOf over each candidate file. If no file holds all of them, the error lists, per string, how many files contain it.
2. `pattern`: parse the surviving files (each file is parsed once per job, shared by all patches), then structurally match.
3. `where:<name>`: each named check filters the matches.
4. `count`: `one` needs exactly 1 match, otherwise the error lists file:line of every match. `many` needs ≥1.

**Regex escape hatch:** use `regex: /…/g` instead of `pattern`. Its matches are text ranges with the same edit methods.

**Caching:** results (matches or the error) are cached per job by fingerprint identity and shared across patches.

**Pattern language** (patterns are ordinary JS parsed by acorn):
- **How a pattern is parsed:** as an expression, then as statements. If both fail, it is wrapped as a switch case (`switch(_){ P }`), an object member (`({ P })`) or a class member (`class _ { P }`); the first that parses wins.
- **`$NAME`** (uppercase, digits, `_`) in any identifier position matches any **single** node: an expression, identifier, statement, property key or block. The capture is reused only if every occurrence has the same source text.
- **`$$$` / `$$$NAME`** as a list item matches **zero or more** items. Lists are statements, arguments, array elements, object properties, parameters and switch cases.
- **Object literal and object destructuring patterns are unordered subsets:** the listed properties must exist and others may too. `{ url: "/discounts" }` matches `{url:"/discounts",icon:X9,label:…}`.
- **Every other list is ordered and exact-length,** unless it contains `$$$`.
- **Everything else must be structurally equal:** node types, literal values (any quote style), operators and identifier names. Use `$X` wherever names are mangled.
- **Ignored:** whitespace, comments (including `/* @__PURE__ */`) and redundant parentheses.

**Examples written in this API:**
```ts
// Hydra sort helper (readable code)
const librarySortSwitch = fingerprint({ name: "library sort switch",
  strings: ['case "recently_played"', '"most_played"'],
  pattern: `[...$GAMES].sort(($A, $B) => { switch ($BY) { $$$ } $$$ })` });

// Heroic sidebar link (minified code)
const dealsLink = fingerprint({ name: "sidebar Deals link",
  strings: ['"discounts.sidebar"'],
  pattern: `$R.jsx($LINK, { url: "/discounts" })` });

// Universal: electron-updater, bundled or not
const updaterActive = fingerprint({ name: "electron-updater isUpdaterActive",
  strings: ["isUpdaterActive()"], scope: "all", count: "many",
  pattern: `isUpdaterActive() $BODY` });
```

### 5.4 `ctx` and matches
```ts
interface PatchContext<O> {
  app: { id: string; version: string };
  options: OptionValues<O>;
  match(fp: Fingerprint): Match;          // fp.count must be "one"
  matchAll(fp: Fingerprint): Match[];     // fp.count must be "many"
  file(path: string): TextFile;           // fixed-path text files inside the asar
  addFile(path: string, contents: string | Uint8Array): void;   // new file inside the asar
  desktopEntry: Record<string, string>;   // [Desktop Entry] keys, prefilled from the stock .desktop
  log(message: string): void;
}
interface Match extends Editable {
  file: string; node: AcornNode; text: string; start: number; end: number; line: number;
  [capture: `$${string}`]: Capture;       // m.$B → Capture; `${m.$B}` stringifies to its source text
  find(pattern: string): Match;           // exactly one match inside this match
  findAll(pattern: string): Match[];
  resolve(): Match;                       // Identifier → its top-level declaration's initializer (same file)
}
interface Capture extends Editable { node: AcornNode; text: string; start: number; end: number;
  resolve(): Match; items?: Capture[] }   // items for $$$NAME list captures
interface Editable {
  replace(code: string): void;
  insertBefore(code: string): void;
  insertAfter(code: string): void;
  remove(): void;
}
interface TextFile { text: string; setText(t: string): void; json<T>(): T; setJson(v: unknown): void }
```
**Edit semantics:**
- **Splices against the original text.** Edits are recorded against the original file text, so every match in a job sees the same offsets.
- **Lists get separators automatically.** If the target is a list item (array element, object property, argument, parameter), `insertBefore`, `insertAfter` and `remove` add or remove the `,` separator. Statements and switch cases need no separator.
- **Edits are per-patch transactional.** They are buffered while a patch runs and committed only if `execute` returns. A throwing patch leaves no edits behind.
- **Overlaps are errors.** Overlapping `replace` or `remove` ranges, or an insert inside a removed or replaced range, fail with an error naming both patches.
- **Same-position inserts** keep execution order.
- **Applied once.** Edits are applied once per file after all `finalize` calls, then the file is re-parsed (§4.3 step 4).

### 5.5 Execution semantics
- **Selection:**
  - required patches (from the app definition)
  - plus defaults compatible with the version
  - plus saved and flag enables
  - minus saved and flag disables (required patches can't be disabled)
  - plus the transitive `dependsOn` closure (internal patches included)
  - A patch incompatible with the version is excluded unless `--force`.
- **Order:** topological; ties are broken by name, and internal patches by declaration order. `finalize` runs over applied patches in reverse order.
- **Statuses:**
  - `applied`
  - `failed` (an error with patch, fingerprint and step, or an option validation error)
  - `skipped` (a dependency failed: names it)
  - `incompatible`
  - `disabled`
- **Required-patch failure:** the job aborts (§4.3 step 7).
- **Morphe concepts carried over:** dependency graph with failure propagation, typed options with presets and validators, universal patches default-off, `finalize`, stable/experimental targets enforced unless `--force`, generated `patches.json`, `minEngine`.

### 5.6 Error output (the "upstream released, what broke?" experience)
```
Hydra 4.1.7 (untested): 4/5 patches apply
  ✓ Disable self-update
  ✓ Side-by-side identity
  ✓ Recently added sort
  ✗ Recently downloaded sort
      fingerprint "library sort switch" failed at step "pattern":
        strings matched 1 file: out/renderer/assets/index-B2x9.js
        pattern [...$GAMES].sort(($A, $B) => { switch ($BY) { $$$ } $$$ }) matched 0 nodes
  ✓ More like this ranking
```
**Exit codes:** `0` = all selected patches applied; `1` = nothing installed; `2` = installed with failed optional patches.

---

## 6. Extensions (Hydra "More like this" is the proof)

**Source and build.**
- Each app has one extension entry: `bundles/official/hydra/extension/index.tsx`, which imports the features.
- At bundle build time, esbuild compiles it to one ESM string, with CSS inlined and injected as a `<style>` on load.
- The string is embedded in the bundle file and exposed to patches as an import (`import hydraExtension from "revamp:extension/hydra"`).

**Loader (internal patch "Hydra extension loader").**
- `ctx.addFile("out/renderer/assets/revamp-hydra.js", hydraExtension)`.
- `ctx.file("out/renderer/index.html")` gets `<script type="module" src="./assets/revamp-hydra.js"></script>` inserted **before** the app's module script. Module scripts run in document order, so the extension registers before the app renders.

**Registry.** `globalThis.__revamp = { registry: {}, mounts: {}, mount(id, Original) }`.
- **Registry hooks** are internal patches, one per entry. Each inserts `(globalThis.__revamp ??= { registry: {}, mounts: {} }).registry.<Name> = <ident>;` right after a fingerprinted definition.
- **Hydra entries for "More like this"** (about 12):
  - `React` and the JSX runtime
  - `useTranslation` and `useNavigate`
  - `useAppDispatch`, `useAppSelector` and `setTags` (fewer if the port keeps tag state extension-local)
  - `VerticalCoverCard`, `buildGameDetailsPath`, `useLibrary`, `levelDBService` and `logger`
- **`window.electron.hydraApi`** is already global and needs no hook.
- **Failure scope:** feature patches `dependsOn` exactly the entries they use, so one broken hook only skips the features that need it.

**One React, via shims.**
- The extension source uses ordinary imports (`react`, `react/jsx-runtime`, `react-i18next`, `react-router-dom`, `@renderer/components`, `@renderer/hooks`, …).
- esbuild aliases each of these to a shim module that reads `globalThis.__revamp.registry` **lazily at call time**. Load order then never matters, and React is always the app's own.
- The generic React and JSX-runtime shims live in `@revamp/sdk/shims`. App-specific shims live next to the extension.
- **What gets compiled in:** pure libraries (`embla-carousel-react`, `react-loading-skeleton`, `@primer/octicons-react`, `lodash-es`) are compiled into the extension with `react` aliased to the shim.
- **Rule:** anything holding shared state or React context comes from the registry; anything self-contained is compiled in.

**Mounting UI.**
- The feature patch inserts `SimilarGames = globalThis.__revamp?.mount?.("hydra.similarGames", SimilarGames) ?? SimilarGames;` after `function SimilarGames(…) {…}`. The binding is mutable and only read at render time.
- `mount` returns a wrapper component. It renders the extension's replacement (registered in `mounts["hydra.similarGames"]`, which receives `Original` as a prop) inside an error boundary that falls back to `Original` on any render error.
- If the extension is missing or crashes, the stock UI shows.

**Types.**
- `bundles/official/hydra/extension/registry.d.ts` declares the registry entries. React types come from `@types/react` matching Hydra's React major; component props are hand-written.
- This is Morphe's "stub" role.

**Porting rule.**
- The fork's code (`similar-games.ts`, `use-similar-games.ts`, `use-similar-game-views.ts`, the `similar-games/` component) is ported close to verbatim; only imports are remapped.
- The fork's SCSS is converted once to CSS with the `sass` CLI and committed.
- Behavior parity with the fork build is the acceptance bar, not code parity.

---

## 7. Bundles and distribution

### 7.1 Bundle file
- **Output:** `bundles/official/dist/official.mjs`, a single self-contained ESM file. It contains the patches, inlined SDK helpers, extension code as strings and icons as base64.
- **Constraints:** no imports, and no top-level `await`.
- **Build** (`npm run build -w bundles/official`):
  1. esbuild the extensions.
  2. esbuild the bundle entry.
  3. Run the engine's sandboxed `describe` (§4.4) on the built bundle and write the result as `patches.json`: manifest, apps, and every named patch with its description, compatible apps and versions, options and default/required flags.
  4. Write `bundle.json`.
- **`bundle.json`:** `{ name, version, minEngine, created_at, changelog, download_url, sha256 }`.

### 7.2 Sources [M4]
- **Adding:** `revamp sources add <owner/repo | https-url | file>`.
  - GitHub: fetch `bundle.json` from the default branch (raw.githubusercontent.com, falling back to the API), download `download_url`, and verify `sha256`.
  - URL: a `bundle.json` URL.
  - File: a local `.mjs`.
- **Confirmation:** the CLI shows the manifest and hash; the user confirms, and the hash is pinned in `sources.json`.
- **Updates:** a source's new `bundle.json` version is downloaded, verified against its own `sha256`, and the pin moves. The source itself is the trust anchor (trust on first use). Url and file sources pin an exact hash.
- **Conflicts:** two enabled sources defining the same app id is a warning, and the first source wins.
- **Before M4:** the CLI takes `--bundle <file>`, defaulting to `bundles/official/dist/official.mjs` when run from the repo.

### 7.3 Check and update [M4]
- **`revamp check`** runs daily from `revamp-check.timer` (`OnCalendar=daily`, `Persistent=true`, `RandomizedDelaySec=1h`). For each installed app:
  1. Refresh the sources.
  2. Ask the GitHub API for the latest release.
  3. If it is newer than `current`, download it, verify it (bundle pin, or GitHub digest if unlisted) and dry-run the patch job: steps 1–4, no install.
  4. Record the result in `last-check.json`.
  5. `notify-send "Revamp" "Hydra 4.1.7 out, 5/5 patches apply"` (or "…, 4/5 apply: Recently downloaded sort fails" / "…, not yet in your bundles").
- **The user confirms.** `revamp update [app]` re-runs the job for that version with the saved selection. An unlisted or experimental version needs `--force`.
- **`revamp timer enable|disable`** writes the units and runs `systemctl --user enable --now` (or the disable equivalent).

### 7.4 CI [M4]
GitHub Actions on every push:
1. Build.
2. Run the unit tests.
3. Restore `~/.cache/revamp/releases` from the Actions cache (key: app and version).
4. Run `revamp patch <app> --version <v> --dry-run` for every app and version in the bundle.

Stable versions must apply 100%. Experimental versions report only.

---

## 8. CLI

| Command | Milestone |
|---|---|
| `revamp patch <app> [--version v] [--force] [--enable "<patch>"]… [--disable "<patch>"]… [--option "<patch>:<key>=<value>"]… [--bundle file] [--dry-run]` | M1 (flags as needed; `--option` M2) |
| `revamp list`: installed apps, versions, `current`, applied patches | M1 |
| `revamp rollback <app>`: point `current` at the previous version | M1 |
| `revamp uninstall <app>`: remove the installs, desktop entry and selection (confirm prompt) | M1 |
| `revamp patches <app> [--version v]`: patches, defaults, required, options, compatibility | M2 |
| `revamp sources add/list/remove`, `revamp check [--notify]`, `revamp update [app] [--force]`, `revamp timer enable/disable` | M4 |
| `revamp serve`: JSON-RPC 2.0 over stdio (§9) | M5 |

Flags passed to `patch` are saved into `~/.config/revamp/apps/<app>.json`, so `update` reproduces the last install.

## 9. GUI [M5]
- **Shell:** Tauri v2 window (system WebKitGTK) with a Vite + React + TypeScript UI.
- **Engine:** the `revamp` binary ships as a Tauri `externalBin` sidecar (`revamp-x86_64-unknown-linux-gnu`). It is spawned with `@tauri-apps/plugin-shell` `Command.sidecar("revamp", ["serve"])`.
- **Protocol:**
  - One JSON-RPC message per line on stdin/stdout, with stderr going to the log.
  - Methods mirror `engine/api`: `apps.list`, `patches.list`, `selection.get/set`, `job.patch`, `job.update`, `install.rollback`, `check.run`, `sources.*`.
  - Notifications: `job.progress {step, percent}`, `job.patchResult`, `job.done`.
- **Screens:**
  - **App list:** installed versions and an update badge.
  - **App detail:** version picker, patch toggles and options, a Patch/Update button with progress and per-patch results, and rollback.
- **Notifications:** `revamp check` notifications get an "Open Revamp" action that launches the GUI.
- **Packaging:** installed per-user without root, via `npm run gui:install`.
- **Rust:** rustup is installed only at M5, after asking the owner.
- **Size:** about 144 MB SEA plus about 10 MB Tauri on disk.

---

## 10. Official bundle contents

| Patch | Kind | Apps | Milestone | Mechanism |
|---|---|---|---|---|
| Disable self-update | universal, **required** for hydra and heroic | any electron-updater app | M1 | `updaterActive` fingerprint (scope `all`, count `many`): `$BODY.replace("{ return false; }")` |
| Side-by-side identity | universal, **required** | any | M1 | `package.json` `desktopName = "revamp-<app>.desktop"`; `desktopEntry.Name = "<App> (Revamped)"`, `StartupWMClass = revamp-<app>`, `Exec`/`Icon` set by install. Option `claimLinks` (bool, default true): when false, every `$X.setAsDefaultProtocolClient($$$)` call becomes `false` and `MimeType` is dropped. |
| Recently downloaded sort | hydra | 4.1.6 | M1 | Edits the five places the fork touched: a sort switch case (`download?.timestamp`), the sidebar sort menu entry (with the `DownloadIcon` component resolved by fingerprint), `SIDEBAR_SORT_OPTIONS`, the library filter options and the library sort list. M1 labels use `t(key, { defaultValue: "Recently downloaded" })`. |
| Hydra locales (internal) | hydra | 4.1.6 | M2 | Follows `resources` → locale → `library` namespace object via `resolve()` and adds keys for en, bg and pt-BR (the fork's strings). The sort patches depend on it from M2. |
| Recently added sort | hydra | 4.1.6 | M2 | Same five places; sorts on `addedToLibraryAt`, and games without it sort last. |
| Hide Deals link | heroic | 2.22.3 | M2 | `dealsLink.replace("null")` (demo patch on minified code; the owner may swap in a different one). |
| Hydra extension loader (internal) | hydra | 4.1.6 | M3 | §6 loader |
| Registry hooks (internal, about 12) | hydra | 4.1.6 | M3 | §6 registry |
| More like this ranking | hydra | 4.1.6 | M3 | Mount wrapper on `SimilarGames` + extension (four Steam-tag queries plus `/similar` in parallel, hit-count ranking, per-game session cache, shared tags and library badge on cards, limit 12) |

The Heroic app definition (`installDir`, `executable`, `desktopFile`) is filled in from the real `.deb` listing in the M2 plan.

## 11. Error handling summary
- **Download:** HTTP errors and hash mismatches stop the job before staging. A hash mismatch deletes the cached file and says so.
- **Extraction:** unsafe entries abort with the entry name.
- **Bundle load errors and engine-version errors** stop the job with the bundle name.
- **Patch failures:** §5.6. Required failures abort; optional failures are reported, and the job installs with exit code 2.
- **Re-parse failures** abort and name the file, position and editing patches.
- **Sandbox crash or timeout** aborts the job and keeps the child's stderr in the log.
- **Install failures** remove staging. `current` changes only by an atomic rename, so it never points at a half-written tree.
- **Warnings (do not fail):**
  - stock and Revamped share the single-instance lock
  - `apparmor_restrict_unprivileged_userns=1` (§14)
  - an untested version installed with `--force`

## 12. Testing strategy
- **TDD** for engine logic. Unit tests run under `node --test`, TS natively, with no network.
- **`deb`:**
  - committed tiny fixtures (built once with `dpkg-deb`) for gz, xz and zst
  - malicious tar fixtures (`../`, absolute path, symlink escape, device node, duplicate path), each rejected
- **`asar`:** build a fixture asar with `@electron/asar` (dev dependency), rewrite it with appended and changed files, then read it back with `@electron/asar` and compare every file byte-for-byte. Covers unpacked entries and header size changes.
- **`pattern`:** table tests over pattern + source → matches and captures, including excerpts of real Hydra and Heroic code (committed snippets).
- **`edits`:** list separators, overlaps, transactional discard, same-position order, re-parse failure.
- **`graph`:** ordering, dependency failure propagation, required-failure abort, finalize reverse order, option validation, `--force`.
- **`sandbox`:** the child cannot read outside staging, cannot spawn, and cannot `fetch`. The bundle loads via require(esm).
- **`install`:** atomic `current` swap, retention keeps two, a rename collision on re-patching the same version, and the desktop entry contents (written into a temp XDG root).
- **Integration** (`npm run test:integration`, opt-in):
  - Downloads the real Hydra 4.1.6 `.deb` once into `~/.cache/revamp/releases` (verifying the pinned hash).
  - Runs the M1 job into a temp XDG root.
  - Asserts: every selected patch applied; the asar reopens with `@electron/asar`; changed files parse and contain the inserted code; unchanged files are byte-identical; the receipt and desktop entry are correct.
  - Skips with a clear message when offline and uncached.
  - Later milestones extend it (Heroic, a mismatched version).
- **Manual (M1):** launch Revamped Hydra, see the sort work, and confirm `/opt/Hydra` is unchanged (`dpkg --verify hydralauncher`).

## 13. Milestones and acceptance

**M1: walking skeleton (CLI).**
- `revamp patch hydra` (with `--bundle` defaulting to the repo build):
  - downloads Hydra 4.1.6 (cached) and verifies the SHA-256
  - extracts, applies **Disable self-update**, **Side-by-side identity** and **Recently downloaded sort**
  - repacks and installs to `~/.local/share/revamp/apps/hydra/4.1.6/`
  - writes `revamp-hydra.desktop`
- `revamp list`, `rollback` and `uninstall` work.
- **Acceptance:**
  - The Revamped app launches from the menu as "Hydra (Revamped)" and doesn't group with stock in the panel.
  - The new sort works.
  - `/opt/Hydra` is unchanged.
  - A patch job with a cached `.deb` takes seconds, not minutes.
  - Unit tests plus the integration test pass.
- **Dev setup:** Node 26 in `~/.local/node-26`, used for this repo only.
- **SEA:** the M1 CLI runs from source (`node packages/cli/src/main.ts`, wrapped by `npm run revamp --`), and the sandbox uses dev mode. The SEA build and its sandbox spawn path land in M4, when `revamp` must run from a timer.

**M2: breadth.**
- Locale edits (Hydra locales).
- Recently added sort.
- Heroic app definition + Hide Deals link.
- `revamp patches <app>`.
- `--option`.
- **Acceptance:**
  - Fingerprint misses give §5.6 errors, tested by running the Hydra patches against a mismatched input: a modified fixture plus, when available, another real Hydra release forced with `--force`.
  - Heroic installs and the Deals link is gone.

**M3: extensions.**
- The extension build and loader, registry hooks, shims and mount wrapper.
- The similar-games port.
- **Done when** the owner switches daily use to Revamped Hydra and retires the fork. Behavior matches the fork build:
  - ranking order
  - shared tags and library badge
  - session cache
  - stock fallback when the extension fails

**M4: distribution.**
- Bundle build → `official.mjs` + `bundle.json` + `patches.json`.
- `revamp sources add/list/remove` with pinning.
- `revamp check` (timer, `notify-send`) and `revamp update`.
- SEA build of `revamp` installed to `~/.local/bin`.
- GitHub Actions that apply every patch to the real cached releases on every push.

**M5: GUI.**
- A Tauri app with the SEA sidecar.
- Screens: app list, patch toggles and options, patch/update with progress, rollback.
- Notification action.
- Installed on the owner's machine without root.

## 14. Risks and documented limitations
- **Electron sandbox on Ubuntu 24.04+** (`apparmor_restrict_unprivileged_userns=1`): a home-installed copy can't start its sandbox.
  - v1 detects this and prints the options: a root-installed AppArmor profile for the Revamped path, or adding `--no-sandbox` to `Exec` (a security trade-off, user's choice).
  - Not solved in v1.
- **Single-instance lock** is shared with stock, so only one Hydra runs at a time (warned at install).
- **Deep links** follow whichever copy started last (Revamped by default). `claimLinks=false` keeps them on stock.
- **`--allow-net` is experimental** in Node 26. If it changes, the sandbox loses network blocking. The sandbox test catches that on upgrade.
- **Untested versions** (`--force`) are verified only against GitHub's published digest.
- **Bundle trust** is the pinned hash plus the source repo. Bundle code runs only in the sandbox: no files outside the job, no network, no processes. It can still produce a malicious *patched app*, which is inherent to patching; users should add only sources they trust.
- **Heroic `.deb` data** isn't shared with the Flatpak install (§3.1).
- **Disk:** two installed versions of Hydra (several hundred MB each) plus cached `.deb` files.

## 15. Non-goals (v1)
- Non-Electron runtimes and plugin systems for them.
- AppImage, rpm, snap, Flatpak or tar.xz inputs; arm64; Windows; macOS.
- Runtime-injection loaders.
- Root installs or replacing the stock app.
- Bundle signatures beyond SHA-256 pinning.
- Distributing pre-patched builds.
- Hydra Big Picture mode.
- A public patch directory or website.
- Porting the fork's unreleased upstream work (§1).
