# Revamp: kickoff prompt

You are starting **Revamp**, a new project in `~/github/revamp`. The repo is empty
except for `docs/`. Before you act, read this whole file and
`docs/research/morphe.md`.

The decisions below came out of an interview with the owner. Treat them as settled and
do not re-ask them. Your job is to resolve the open questions, write the v1 spec, and
plan the first milestone.

## What Revamp is

Revamp is Morphe for Linux desktop apps. Morphe, an Android project in the ReVanced
lineage, does this:
1. Takes the vendor's shipped APK.
2. Locates code with *fingerprints* (partial descriptions of code) instead of hardcoded
   offsets.
3. Applies patches from a downloadable *bundle*.
4. Reinstalls the result.

Revamp does the same for **open-source Linux Electron apps**:
1. Download the official release.
2. Modify the built files directly. No rebuild from source.
3. Install the patched copy next to the stock app.
4. Re-apply the same patches automatically when a new release ships.

**Why it exists.** The owner maintains a personal fork of the Hydra game launcher: 75
commits on top of upstream, rebuilt by hand. That workflow has four pains, and Revamp
must remove all four:
1. **Build toolchain.** yarn, electron-builder, cargo for a native module, minutes per
   build.
2. **Upstream churn.** Every release needs a merge and a re-check.
3. **Install plumbing.** The build runs from `dist/linux-unpacked` through a hand-made
   desktop entry.
4. **No sharing.** Others can't use the patches without cloning the fork and building
   it.

**Audience.** Personal first, community-ready. The patch format and bundles must let
other people publish bundles later. v1 serves the owner.

## Settled decisions (do not re-ask)

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Patching model | Patch the **released build, at rest**: rewrite files on disk once at patch time. Not source + rebuild. Not runtime injection (the Vencord-style loader that patches modules in memory every launch). | No toolchain, takes seconds, re-runs on each new release. Vite bundles (Hydra's) have no runtime module registry to hook anyway. |
| 2 | Scope | Open-source apps only. **Electron first** (`app.asar`). | Electron code is JavaScript, so it can be patched after release. Compiled C/Rust apps can't be patched cleanly. |
| 3 | Other runtimes | Not in v1. Build no plugin system for them; just don't hardwire asar into the bundle/manager layer. | YAGNI with an open door. |
| 4 | App source | Revamp **downloads official releases itself** (GitHub Releases) and verifies a SHA-256 the bundle pins per supported version. It never reads or touches the user's installed copy. | Reproducible input. Morphe pins the APK signer hash the same way. |
| 5 | Install | **Side-by-side** in the user's home, no root, own menu entry (e.g. "Hydra (Revamped)"). Shares settings and userData with the stock app; that's acceptable. | Stock app stays untouched. Rollback = launch stock. |
| 6 | Updates | Daily background check (systemd user timer) sends a desktop notification ("Hydra 4.1.7 out, 5/5 patches apply"), and the user confirms. The **app's own self-updater is disabled** in the patched copy. | Hydra's electron-updater can run `pkexec dpkg -i` on `.deb` installs and would overwrite stock `/opt/Hydra`. |
| 7 | Interface | **CLI + GUI both in v1.** GUI = **Tauri** window (system WebKitGTK) with a web UI. The engine runs as a **bundled Node sidecar** (Node single-executable app). | Electron rejected: the ~100 MB download was too big. Tauri + Node ≈ 45 MB, and the app works without Node installed. |
| 8 | Language | **TypeScript everywhere**: engine, CLI, GUI frontend, patch SDK, patches, extensions. Rust only for Tauri shell boilerplate. | Patch authors are patching JS apps; same move as Morphe writing Kotlin patches for JVM apps. |
| 9 | License | **GPLv3**, no extra §7 terms. | Same as Morphe. The extra §7 terms are what fueled Morphe's DMCA fights. |
| 10 | Repo | Private GitHub repo `xb00tt/revamp`. | |
| 11 | Distribution of patched apps | **Never** distribute pre-patched builds. Users always patch locally. | Keeps legal and GPL questions simple. Morphe's FAQ says the same. |

## Technical defaults (chosen during the interview)

Change one of these only with evidence, and tell the owner when you do.

- **Input format v1: `.deb`.** Both target apps ship it. Extract in pure TypeScript:
  `ar` → `data.tar.{xz,zst,gz}` → tar.
  - Node's zlib covers gzip and zstd. xz needs a small dependency.
  - **Never execute downloaded files** (no `--appimage-extract`).
  - AppImage and tar.xz come later.
- **x86_64 only.**
- **Fingerprints, two layers:**
  1. A cheap string/literal prefilter picks the candidate file(s). This is Vencord's
     `find` idea; Morphe also indexes strings → classes first.
  2. An AST structural pattern pins the exact node.

  Rules:
  - Every declared trait must match.
  - Exactly one match unless the fingerprint is declared multi.
  - The result is cached and shareable across patches.
  - Never rely on chunk file names: they contain content hashes that change every
    release.
  - Regex find/replace is allowed as an escape hatch.
- **Edits are surgical splices at node offsets** (magic-string style). Never reprint a
  whole file: Hydra's renderer bundle is 13.7 MB.
- **Sandbox.** Bundle code runs in a child Node process under the Node permission model
  (`--permission`). Filesystem access is limited to the job's work dir and child
  processes are blocked. Verify which permission flags exist in the chosen Node version,
  especially for network.
- **Universal patches in the first bundle:**
  - **Disable self-update.**
  - **Side-by-side identity:** desktop entry name and icon. Also the WM class, if the
    window would otherwise group with the stock app in the Cinnamon panel.
- **Retention.** Keep the current and previous patched version of each app for
  rollback; delete older ones. An installed Hydra is several hundred MB.

## Patch model

Mirror Morphe in TypeScript. The API sketch below is illustrative, not final:

```ts
export const recentlyDownloadedSort = definePatch({
  name: "Recently downloaded sort",
  description: "Adds a 'Recently downloaded' option to the library sort menu.",
  compatibleWith: [{ app: "hydra", versions: { "4.1.6": { sha256: "…" } } }],
  dependsOn: [hydraLocales],
  options: {},
  execute(ctx) {
    const sortSwitch = ctx.match(LibrarySortSwitch); // fingerprint → file + node
    sortSwitch.insertAfter(/* new case */);
  },
});
```

Concepts to carry over (details in `docs/research/morphe.md`):
- compatibility targets marked stable or experimental; the CLI enforces them unless
  `--force`
- `dependsOn` graph with failure propagation
- typed options with presets and validators
- universal patches, default-off
- a `finalize` phase
- generated patch-list JSON
- a bundle manifest with a minimum engine version

When a fingerprint misses, the error must name the patch, the fingerprint and the trait
that failed. That message is the whole "upstream released, what broke?" experience.

## Extensions (needed for big features)

Morphe ships precompiled helper code into the app and adds tiny hooks that call it.
Revamp's design target:
- **Source and build.** Extension source is TS/TSX in the bundle. esbuild compiles it to
  one file per app at bundle build time. It's added as a new file inside the asar and
  loaded by a hook patch.
- **Reaching app internals.** Hook patches publish internals into a registry,
  `globalThis.__revamp`: React, the store, i18n `t`, components, helpers. Each hook
  inserts an assignment next to a fingerprinted definition.
- **One React.** The extension **must use the app's own React instance** (esbuild alias
  to a shim that reads the registry). Two Reacts break hooks.
- **Types.** Type stubs for registry entries play the role of Morphe's "stub" modules.
- **Mounting UI.** Extension UI enters the app when a hook patch swaps or wraps a
  component reference (e.g. the "More like this" section).

## Verified facts about the targets (2026-10-14)

### Hydra 4.1.6
- **Releases:** github.com/hydralauncher/hydra. Linux assets are `.AppImage`, `.deb`
  (142 MB), `.rpm` and `.snap`. There is no tarball.
- **Install layout.** The stock `.deb` installs to `/opt/Hydra`. `resources/` contains:
  - `app.asar` (275 MB): the whole repo, including `node_modules` and the native module
    source
  - `app.asar.unpacked/`, `hydra-native/`, `app-update.yml`, `apparmor-profile`, `7zzs`
- **Built code inside the asar:**
  - `out/main/index.js` + chunks
  - `out/preload/index.mjs`
  - `out/renderer/index.html` + `out/renderer/assets/*.js`
- **The renderer bundle is not minified.** `out/renderer/assets/index-<hash>.js` is
  13.7 MB and 276k lines, and identifiers like `similarGamesSectionState` survive.
  Source maps (`.map`) ship inside the asar.
- **Translations are inlined** in the renderer bundle as object literals, one per
  namespace per locale: `const library$y = { "library": "Library", "hidden_games": "Concealed games", … }`.
  - A locale patch adds keys to those literals; there are no JSON files to edit.
  - The owner's languages are en, bg and pt-BR.
- **Sort code:**
  - A sort helper has `case "recently_played": {`.
  - Filter options are entries like `{ value: "recently_played", label: t2("recently_played", { ns: "library" }) }`.
- **Self-updater:** electron-updater `autoUpdater` in `out/main/index.js`.

### Heroic 2.22.3
- **Releases:** github.com/Heroic-Games-Launcher/HeroicGamesLauncher. Linux assets are
  `.deb`, `.tar.xz`, `.AppImage`, `.rpm` and `.pacman`.
- **The bundle is minified.** `app.asar` → `build/assets/*.js`; for example
  `index-DVySXrWT.js` is 678 KB on 1,265 lines and starts `function qd(e,n){…}`. This is
  the stress test for fingerprints on mangled identifiers.

### Unknowns to verify early
- Whether Electron's asar integrity validation fuse is enforced on Linux. Believed
  macOS/Windows only.
- Whether either app checks its own files or has fuses like `OnlyLoadAppFromAsar` set.
- How Hydra derives its userData path, and how its single-instance lock behaves when
  stock and Revamped both run.
- How to handle `app.asar.unpacked` and native modules when repacking.

### Electron sandbox (community-readiness risk)
- A user-owned copy can't have a setuid-root `chrome-sandbox`.
- On the owner's Mint 22.3, `kernel.apparmor_restrict_unprivileged_userns = 0`, so it
  runs fine. The owner's fork build already runs this way.
- Stock Ubuntu 24.04+ sets that sysctl to 1. There a side-by-side copy needs an AppArmor
  profile (root; Hydra ships `resources/apparmor-profile` for `/opt/Hydra`) or
  `--no-sandbox`.
- Document this for v1. Don't solve it.

## Hydra features to port (v1 acceptance)

**Where the code is.** The owner's fork is at `/home/borislav/github/hydra`, branch
`local/v4.1.6-recently-downloaded`. Read the diffs with `git show`.

**Skip Big Picture mode** (`src/big-picture`, commit `a5ff30d31`) entirely. The owner
doesn't use it.

1. **"Recently downloaded" library sort**, commit `288f38b0d` (+25 lines). Touches the
   sort helper in `helpers.ts`, `filter-options.tsx`, `sidebar-filter-menu.tsx`,
   `sidebar.tsx`, `library.tsx`, and the en/bg/pt-BR locales.
2. **"Recently added" library sort**, commit `ecad7c208` (+23 lines, same files). Sorts
   on `addedToLibraryAt`; games without that field sort last.
3. **"More like this" (similar-games) rework**, commits `cde6323c0` plus
   `5b623b713..3f098e9f8` (~1,245 added / 295 deleted lines).
   - **Files:** renderer hooks `similar-games.ts`, `use-similar-games.ts`,
     `use-similar-game-views.ts`, `use-catalogue.ts`, plus the
     `pages/game-details/similar-games/` component and scss.
   - **Design docs:** `docs/superpowers/specs/2026-10-14-similar-games-ranking-design.md`
     and `docs/superpowers/plans/2026-10-14-similar-games-ranking.md` in that repo.
   - **What it does:**
     - runs four Steam-tag queries plus `/similar` in parallel
     - ranks candidates by hit count
     - caches results per game for the session
     - shows shared tags and a library badge on cards
   - **Backend** (hydra-api, closed source): `GET /catalogue/{shop}/{id}/similar`
     (`take` ≤ 24), `GET /games/steam/{id}` (ordered tag ids), `POST /catalogue/search`
     (tags filter is AND; `take`/`skip` go in the body).
   - **This feature is the extensions proof.**

**What "ported" means.** Behavior parity between Revamped Hydra 4.1.6 and the fork
build. Code parity is not required. When Hydra 4.1.7 ships, each patch must either
apply or fail with a clear per-patch message.

## Milestones (v1 = all five)

1. **Walking skeleton (CLI).**
   - `revamp patch hydra` must:
     - download Hydra 4.1.6 `.deb` (cached), verify its SHA-256, extract it
     - apply Disable self-update + Recently downloaded sort
     - repack and install to `~/.local/share/revamp/apps/hydra/4.1.6/`
     - write a `.desktop` entry
   - The Revamped app launches, and the new sort works.
   - `/opt/Hydra` is unchanged.
   - Patching takes seconds, not minutes.
   - An integration test applies the patches to the real cached release.
2. **Breadth.**
   - Locale edits on object literals.
   - Recently added sort.
   - One small, visible patch on Heroic's minified bundle (pick it with the owner).
   - `revamp patches <app>` lists patches and compatibility.
   - Fingerprint misses produce clear errors; test against a mismatched version.
3. **Extensions.** Extension build and loading, the registry hooks, and the
   similar-games port. Done when the owner switches daily use from the fork build to
   Revamped Hydra. The fork is then retired.
4. **Distribution.**
   - The bundle builds to a single file plus a `bundle.json` pointer.
   - `revamp sources add <owner/repo | url | file>` adds a source; bundle SHA-256 is
     pinned.
   - `revamp check` runs from a systemd user timer and notifies via `notify-send`;
     `revamp update` applies the update.
   - GitHub Actions downloads the real releases (cached) and applies every patch on
     every push. Morphe has no such CI; this is cheap breakage detection.
5. **GUI.**
   - A Tauri app with a Node SEA sidecar.
   - Screens and actions: list of apps and installed versions, patch toggles and
     options, patch/update buttons with progress, update notifications.
   - Packaged for the owner's machine.

## Non-goals for v1

- Non-Electron runtimes.
- AppImage, rpm, snap or Flatpak as inputs; arm64; Windows; macOS.
- Runtime-injection loaders.
- Root installs or replacing the stock app.
- Bundle signatures beyond SHA-256 pinning (Sigstore later).
- Distributing pre-patched builds.
- Hydra's Big Picture mode.
- A public patch directory or website.

## Open questions for your spec

Decide each one with evidence, propose it to the owner, and record the choice.

1. **JS parser and AST matcher.** Candidates:
   - pure JS: acorn, meriyah
   - native: oxc-parser, `@ast-grep/napi`

   Native addons conflict with the permission-model sandbox (they need
   `--allow-addons`) and complicate Node SEA bundling. Requirements: parse 13.7 MB
   quickly and expose node offsets. Measure on the real Hydra bundle.
2. **Fingerprint API.** How patch authors express the string prefilter and the
   structural pattern. Write the Hydra sort and Heroic fingerprints in the candidate API
   before you settle it.
3. **Bundle file format.** One archive (manifest + compiled patches + extension assets)
   or a single ESM file. Manifest fields: name, version, engine range, author, license,
   source.
4. **Engine ↔ GUI IPC.** stdio JSON-RPC or localhost HTTP.
5. **State layout.** XDG paths: `~/.local/share/revamp` (apps), `~/.config/revamp`
   (sources, selections, options), `~/.cache/revamp` (downloaded releases).
6. **Extension ↔ app internals contract.** Registry shape, how stubs are typed, how UI
   is mounted.
7. **Repo layout.** npm workspaces with the fewest packages that keep engine, CLI, GUI
   and SDK separable. Where the first bundle lives (in-repo `bundles/` for v1 is
   fine).
8. **Node version floor.** The owner runs Node 24.

## Process

1. **Repo.** Create the private GitHub repo `xb00tt/revamp` and push an initial commit
   containing `docs/`. No global git identity is set on this machine, so first set a
   repo-local one: `git config user.name xb00tt` and
   `git config user.email borislav.bg@gmail.com` (same as the Hydra checkout).
2. **Brainstorm only the open questions above.**
   - The owner wants choices **explained in plain language**, with analogies when the
     concept is technical. Don't use jargon in option labels.
   - Ask one question at a time and give a recommendation.
   - When something can be measured (like parser speed), measure it instead of asking.
3. **Spec.** Write `docs/superpowers/specs/<date>-revamp-v1-design.md` covering all five
   milestones. The owner reviews it.
4. **Plan.** Write an implementation plan for **milestone 1 only**; the owner picks the
   execution method. Later milestones get their own plans.
5. **Testing.** Use TDD for engine logic (extraction, fingerprint matching, the patch
   graph, asar round-trip). The integration test downloads the real Hydra 4.1.6 `.deb`
   once (~142 MB) into a cache outside the repo.

## Subagent model choice

The owner wants subagents to run on the cheapest model that can do each job well, to
save tokens and time. On every `Agent` call, pass `model` explicitly; don't rely on the
agent type's default. Also pass `effort`; the owner explicitly asks for it here.

Prices per million tokens, input/output, as of 2026-10:

| Model | Price | Relative to Opus |
|---|---|---|
| Haiku 5.5 | $0.10 / $0.50 | ~40× cheaper |
| Sonnet 5.5 | $2 / $10 | half |
| Opus 5.5 | $4 / $20 | — |
| Fable 5.1 | $10 / $50 | 2.5× more |

| Task | Model | Effort |
|---|---|---|
| Read-only lookups: find files or symbols, grep sweeps, list release assets, read docs or changelogs and summarize, inspect an asar listing | `haiku` | `low` |
| Run a test suite or build and report pass/fail with the decisive error lines | `haiku` | `low` |
| Mechanical edits: renames, formatting, moving code with no logic change, updating fixtures from known values | `haiku` | `low` |
| Implement a well-specified plan task (TDD step with exact files and expected behavior), write tests, write a patch against a fingerprint already designed | `sonnet` | `medium` |
| Per-task review of a diff against its plan step (spec compliance, obvious bugs) | `sonnet` | `medium` |
| Library or approach research that needs judgment (parser candidates, Tauri sidecar setup, Node permission flags) | `sonnet` | `medium` |
| Design work: fingerprint engine and API, extension/registry mechanism, bundle format, Heroic minified fingerprints | `opus` | `high` |
| Debugging after the first fix attempt failed, or any failure whose cause isn't obvious | `opus` | `high` |
| Anything touching a trust boundary: download and hash verification, archive extraction, the patch sandbox, running bundle code | `opus` | `high` |
| Final whole-branch review before a milestone is declared done | `opus` | `high` |
| A problem Opus has failed twice, or the owner asks for it | `fable` | `high` |

Rules:
- **Don't delegate tiny jobs.** A single lookup where you already know the file is
  faster done yourself than by spawning an agent.
- **Escalate one tier on failure:** haiku → sonnet → opus. Never repeat the same model
  on the same failure.
- **Don't downgrade trust-boundary work** to save tokens. The table's opus rows for
  security stay opus.
- **Brief every subagent fully** (exact files, the plan step, the acceptance check).
  Cheaper models need precise briefs; a vague brief wastes more tokens than the price
  difference saves.
- **Background, in parallel.** Run independent subagents in the background and
  concurrently; don't poll them.

## Owner environment

- Linux Mint 22.3, Cinnamon, X11, x86_64.
- Node 24.18 at `~/.local/node-default/bin`.
- **No Rust toolchain yet.** Tauri development needs rustup; ask the owner before
  installing it.
- Flatpak is installed. Heroic is installed via Flatpak, which doesn't matter because
  Revamp downloads releases itself.
- Stock Hydra is in `/opt/Hydra`; never modify it. The owner's fork build launches from
  `~/Desktop/hydra-patched.desktop`.
