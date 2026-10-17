# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Revamp is "Morphe for Linux Electron apps": it downloads an official release `.deb` (Hydra, Heroic), verifies its SHA-256, edits the built JavaScript inside `app.asar` at rest, and installs "<App> (Revamped)" next to the stock app in `~/.local/share/revamp`. TypeScript on Node 26, npm workspaces: `packages/{sdk,engine,cli,gui}` (the GUI is Tauri v2 + React) and `bundles/official`.

**Source of truth:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md` (binding design, milestones in §13) and one implementation plan per milestone in `docs/superpowers/plans/`. Read the spec section and the latest plan before changing behavior. Plan code blocks were run on a fresh clone before hand-off: implementers copy them exactly, and a failure usually means a typo or the wrong Node.

## Commands

Node 26 (`~/.local/node-26`) and Rust (`~/.cargo`, for the GUI's Tauri shell) are installed per-user only; every command needs them first (`.npmrc` has `engine-strict=true`):

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/node-26/bin:$PATH"
npm test                                    # all unit tests (node --test, TS runs natively, no network)
npm run typecheck                           # three tsc --noEmit projects: the repo, the TSX extension, the GUI
node --test packages/engine/test/api.test.ts                       # one test file
node --test --test-name-pattern='unlisted version' packages/engine/test/api.test.ts   # one test
npm run build -w @revamp-app/bundle-official    # scripts/build.ts: the extensions, then dist/official.mjs, patches.json, bundle.json
npm run build -w @revamp-app/cli                # packages/cli/dist/revamp, the single executable (SEA)
npm run install:cli                         # builds the SEA and installs it; ~/.local/bin/revamp links to it
npm run dev -w @revamp-app/gui                  # the window's screens in a browser at localhost:1420, on `revamp serve` from source
npm run tauri:dev -w @revamp-app/gui            # the real window (Tauri) with reload; tauri:build makes target/release/revamp-gui
npm run gui:install                         # installs the CLI, builds the window, puts "Revamp" in the menu
npm run test:integration                    # builds the bundle, patches the REAL releases into temp homes, tests the SEA
npm run revamp -- patches hydra             # CLI from source; also: patch <app> [--version v --force]
                                            #   [--enable/--disable "<patch>"] [--option "<patch>:<key>=<value>"] [--yes]
                                            #   [--bundle file] [--dry-run], list, rollback <app>, uninstall <app>,
                                            #   sources add/list/remove, check [--notify], update [app] [--force] [--yes],
                                            #   timer enable|disable, serve
npm run release -w @revamp-app/bundle-official  # owner only: GitHub release bundle-v<version>, then commits bundle.json
```

- Without `--bundle`, the CLI takes an app's bundle from the first source that has it (`~/.config/revamp/sources.json`, bundles cached as `~/.cache/revamp/bundles/<sha256>.mjs`). Only when no source has the app and it runs from the repo does it use `bundles/official/dist/official.mjs`. When a source has the app, the CLI uses that source's pinned bundle and rebuilding changes nothing: while developing patches, pass `--bundle bundles/official/dist/official.mjs` or remove the source.
- `npm run dev -w @revamp-app/gui` acts on the real home (installs, sources). For experiments start it as `XDG_CACHE_HOME="$HOME/.cache" HOME=/tmp/x npm run dev -w @revamp-app/gui`: cache first, because bash applies `HOME=… XDG_CACHE_HOME=$HOME/…` left to right.
- The integration tests use `bundles/official/dist/official.mjs` directly. Rebuild it after changing bundle sources.
- The integration tests (`REVAMP_INTEGRATION=1`) reuse the real download cache `~/.cache/revamp/releases`: Hydra 4.1.6, Heroic 2.22.3, and Hydra 4.0.6 forced as the deliberate mismatch. Without the cache that is about 430 MB of downloads. With it, a run takes about a minute.
- Passing tests install nothing for the owner: integration runs use temp homes. To refresh the real menu entries, quit the app, then `npm run revamp -- patch <app>`; `npm run revamp -- list` shows what is installed.
- The forced Hydra 4.0.6 test calls api.github.com unauthenticated (60 requests/hour); HTTP 403 there means wait and rerun.
- Inspect a real build in a scratch dir: `dpkg-deb --fsys-tarfile <cached .deb> | tar -x`, then `extractFile` from `@electron/asar` (repo node_modules). Never eval app code; parse with acorn or regex.
- Unit tests must not touch the network or the real home. Use temp dirs, local HTTP servers on port 0, or a stub `fetch`.

## Architecture (the parts that span files)

**Parent and sandbox split (spec §4.4).** The parent process never runs bundle code. `engine/api.ts` `patchApp` runs the job:
1. Describe: `sandbox.ts` spawns `runner.ts` under `node --permission` (bundle readable only). It returns plain JSON (`BundleDescription`). Inside the SEA, the binary is its own runner (`revamp --sandbox-runner`, entry `cli/src/sea.ts`) and the permission flags travel in `--node-options`, because a SEA ignores Node flags in argv.
2. The parent checks the engine version, app, version and selection (`config.ts` `resolveSelection`) before any download.
3. Download with SHA-256 verification (`download.ts`). The hash comes from the bundle; for unlisted versions with `--force`, from GitHub's release API `digest` (labeled "untested").
4. Safe streaming `.deb` extraction into `apps/<app>/.staging-*` (`deb.ts`).
5. Patch in the sandboxed child: reads staging and the bundle, writes only `.revamp-out/`.
6. The parent appends the changed files to `app.asar` (`asar.ts`, copy data region + append + new header).
7. Install: atomic rename, `current` symlink, receipt, `.desktop` entry (`install.ts`).

All network, hashing, extraction and installing happen in the parent.

**Patch model (`@revamp-app/sdk` declares, the engine does the work).**
- Bundles define apps (`defineApp`: release pins per version, `installDir`, `executable`, `desktopFile`, required patches), patches (`definePatch`) and fingerprints.
- A fingerprint runs `strings` (indexOf prefilter) → by-example `pattern` (acorn AST matcher in `pattern.ts`: `$X` captures one node, `$$$` a list, object patterns match unordered subsets) → named `where` checks → `count`. Each failure throws `FingerprintError` naming the fingerprint and the step; the CLI prints these as the spec §5.6 report.
- Matches (`match.ts`) edit by splices against the original text: `replace` / `insertBefore` / `insertAfter` / `remove`, with list commas added automatically, plus `find`, `findAll` and `resolve()` (identifier → top-level declaration).
- `edits.ts` buffers edits per patch, so a throwing patch leaves nothing behind. Overlapping edits fail, naming both patches. Every changed JS file is re-parsed.
- `graph.ts`: patches run in topological order with ties by name, so inserts at the same position follow patch-name order. `finalize` runs in reverse. A failed dependency marks dependents `skipped`. Internal patches have no `name`, are reached via `dependsOn`, and are labeled by their `description`.

**Bundle format.** One self-contained ESM file with no imports and no top-level `await`. The runner loads it with `createRequire(bundle)(bundle)` (require(esm)), because `import()` from disk fails inside a Node SEA.

**Distribution (spec §7, M4).**
- `engine/bundle-sources.ts`: a source is a GitHub repo (`bundle.json` from its default branch), a `bundle.json` URL or a `.mjs` file. `sources add` verifies, caches and describes the bundle, shows it, and pins its SHA-256 once the user confirms. `refreshSources` moves only GitHub pins, to a new `bundle.json` version. The first source with an app wins.
- `engine/updates.ts`: `checkUpdates` (refresh, newest GitHub release per installed app, dry run, `~/.local/state/revamp/last-check.json`) and `updateApp`. `cli/src/timer.ts` writes the systemd user timer that runs the installed binary's `check --notify` daily.
- Publishing: `npm run release` puts `official.mjs` and `patches.json` on the GitHub release `bundle-v<version>`, and commits the root `bundle.json` that points at it. `bundles/official/CHANGELOG.md` needs a `## <version>` section (a unit test checks this).
- CI (`.github/workflows/ci.yml`) runs the unit tests, then dry-runs every app version in `patches.json` against the real release, cached per app and version.
- Bundle text is untrusted on screen too: the CLI prints everything through `printable()`, so control characters can't rewrite the trust prompt.

**GUI (spec §9, M5).** The window is a Tauri v2 shell around `revamp serve`; it holds no engine logic.
- `cli/serve.ts`: JSON-RPC 2.0, one message per line on stdin/stdout, logs on stderr. `createHandler` is tested in-process. Jobs stream `job.progress` from `patchApp`'s `progress` option; the sandboxed child reports each patch start as a `revamp-event {…}` stderr line. `sources.add` takes only a `sources.prepare` token from the same session. `patches.list` also returns `ask`, the new patches the window must ask about.
- `packages/gui/src`: Vite + React 18 + TypeScript with its own tsconfig (the root project excludes it). Screen logic lives in `model.ts` and `rpc.ts`, which Node tests cover; the TSX screens are checked in the browser pane through `npm run dev -w @revamp-app/gui`. `platform.ts` picks the transport: the Tauri sidecar, or Vite's websocket bridged to `revamp serve` in dev.
- `packages/gui/src-tauri`: shell and notification plugins; the capability allows spawning only `revamp serve` from beside the window. The installed window's `revamp` is a link to `~/.local/share/revamp/bin/revamp`, so the window and the timer run one binary.
- Check statuses: `update` (newer release, dry-run), `patches` (the source now pins another bundle than the install was patched with; `revamp update` re-patches), `skipped` (`<state>/skipped.json`). Storage (`engine/storage.ts`) removes only what it lists without a keep reason.

**Extensions (spec §6, M3).** New UI ships as an extension: `bundles/official/src/hydra/extension/` (its own tsconfig with JSX and DOM types). Node tests may import its plain `.ts` files but never a `.tsx` file or anything that imports one, because Node can't strip JSX.
- `scripts/build.ts` compiles it with esbuild into a string and embeds it in the bundle through `define` (`__REVAMP_HYDRA_EXTENSION__`). Unit tests import bundle sources directly and get a placeholder.
- A second esbuild output, the Steam bridge (`__REVAMP_HYDRA_STEAM_BRIDGE__`), runs in Hydra's main process.
- The internal "Hydra extension loader" patch adds it as `out/renderer/assets/revamp-hydra.js`, loaded before Hydra's module script.
- Registry patches (`src/hydra/registry.ts`) capture Hydra internals from the stock code that uses them. Each name is `resolve()`-checked as top-level, and they are assigned to `globalThis.__revamp.registry` just before the root render call.
- Extension code reaches them only at call time through `@revamp-app/sdk/shims/*` and the extension's `app.ts`, because the extension loads before Hydra's module runs.
- A feature patch routes a stock component through `mount()`: the extension's replacement renders inside an error boundary that falls back to the stock component.
- `bundles/official/test/extension.test.ts` builds the extension and renders it with real React 18.3.1 (Hydra's version) through `react-test-renderer`.

**Fingerprinting rules learned on real releases:**
- Anchor on behavior strings (case labels, i18n keys, route paths), never on minified or `$1`-suffixed names.
- Never identify a language by translated text ("Most played" appears in 23 Hydra locales). Hydra locales walks `resources` → locale → `library` namespace with `resolve()`.
- Hydra's main process has its own copy of the translations, hence the `where: in the renderer` check.
- Hydra release builds load their UI from the web unless the "Use the bundled UI" patch applies, so every Hydra renderer patch depends on it.
- Test fixtures (`bundles/official/test/fixtures/<app>-<version>/`) are trimmed excerpts of the real built files, decoys included.

## Constraints

- TypeScript is run by type stripping. Erasable syntax only: no `enum`, `namespace`, constructor parameter properties or `import x = require()`. Use `import type`, and include `.ts` in relative imports.
- Runtime dependencies stay at `acorn` and `xz-decompress` (engine). No native addons. `@electron/asar` is a test oracle only.
- Names from bundles and `.deb` files are untrusted on the parent side: run them through `assertSafeName` / `assertSafeRelativePath` before they reach paths or URLs.
- A production server runs on port 3000 on this machine: never listen on or connect to it. Never read or modify `/opt/Hydra` or `/opt/Heroic`.
- The main checkout is shared with other Claude sessions: don't switch branches or stash there. Do branch work in a worktree: `git worktree add .worktrees/<name> -b <name>` (`.worktrees/` isn't in .gitignore; add it to `.git/info/exclude`), then `cp -a node_modules` into it.
- The git identity (xb00tt) lives in this repo's `.git/config`, not globally: a scratch `git clone` needs `git config user.name/user.email` before it can commit.
- Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`), ending with a `Co-Authored-By: Claude …` trailer.
- The owner (xb00tt) prefers plain-language explanations, one plan per milestone, and subagents on the cheapest model that can do the job.
