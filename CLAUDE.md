# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Revamp is "Morphe for Linux Electron apps": it downloads an official release `.deb` (Hydra, Heroic), verifies its SHA-256, edits the built JavaScript inside `app.asar` at rest, and installs "<App> (Revamped)" next to the stock app in `~/.local/share/revamp`. TypeScript on Node 26, npm workspaces `packages/{sdk,engine,cli,gui}` (the GUI is Tauri v2 + React). The official patches are the separate repo `xb00tt/revamp-patches`: Revamp adds it as the default bundle source (`DEFAULT_SOURCE` in `engine/bundle-sources.ts`), and it runs on `@revamp-app/{sdk,engine,cli}` from npm at exact versions.

**Source of truth:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md` (binding design, milestones in §13; amended by `2026-10-16-revamp-patches-split-design.md`) and one implementation plan per milestone in `docs/superpowers/plans/`. Read the spec section and the latest plan before changing behavior. Plan code blocks were run on a fresh clone before hand-off: implementers copy them exactly, and a failure usually means a typo or the wrong Node.

## Commands

Node 26 (`~/.local/node-26`) and Rust (`~/.cargo`, for the GUI's Tauri shell) are installed per-user only; every command needs them first (`.npmrc` has `engine-strict=true`):

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/node-26/bin:$PATH"
npm test                                      # all unit tests (node --test, TS runs natively, no network)
npm run typecheck                             # two tsc --noEmit projects: the repo and the GUI
node --test packages/engine/test/api.test.ts  # one test file
node --test --test-name-pattern='unlisted version' packages/engine/test/api.test.ts   # one test
npm run build -w @revamp-app/cli              # packages/cli/dist/revamp, the single executable (SEA)
npm run install:cli                           # builds the SEA and installs it; ~/.local/bin/revamp links to it
npm run dev -w @revamp-app/gui                # the window's screens in a browser at localhost:1420, on `revamp serve` from source
npm run tauri:dev -w @revamp-app/gui          # the real window (Tauri) with reload; tauri:build makes target/release/revamp-gui
npm run gui:install                           # installs the CLI, builds the window, puts "Revamp" in the menu
npm run test:integration                      # test/integration: sea (the SEA on the Demo app) and packages (the packed npm packages)
npm run revamp -- patches hydra               # CLI from source; also: patch <app> [--version v --force]
                                              #   [--enable/--disable "<patch>"] [--option "<patch>:<key>=<value>"] [--yes]
                                              #   [--bundle file] [--dry-run], list, rollback <app>, uninstall <app>,
                                              #   sources add/list/remove, check [--notify], update [app] [--force] [--yes],
                                              #   timer enable|disable, self-install (SEA only), serve
npm run publish:packages                      # owner only, from a worktree at origin/main after npm login: compiles and publishes @revamp-app/{sdk,engine,cli}, tags v<version>
npm run publish:packages -- --pack <dir>      # the same compile, but only writes the three .tgz files there: only the version check runs, nothing published
npm run release:app                           # owner only: after publish:packages; GitHub release v<version> with the Linux binaries (--pack <dir> = dry run)
```

- Without `--bundle`, the CLI takes an app's bundle from the first source that has it (`~/.config/revamp/sources.json`, bundles cached as `~/.cache/revamp/bundles/<sha256>.mjs`). There is no other fallback: without `--bundle` and without a source for the app it fails with `no bundle source has "<app>"; add one, e.g. revamp sources add xb00tt/revamp-patches`. A source's pinned bundle is what runs, so a bundle under development needs `--bundle <file>`.
- The default source: when `~/.config/revamp/sources.json` doesn't exist, `patch`/`patches` without `--bundle`, `sources list`, `sources add`, `check`, `update` and `revamp serve`'s app list and Sources screen first add `xb00tt/revamp-patches` (`seedDefaultSource` in `cli/src/bundle-for.ts` over the engine's `addDefaultSource`: the same fetch, verify, cache and describe as `sources add`, no prompt) and print `Added the default source xb00tt/revamp-patches: "<name>" <version> (sha256 …)` on stderr. Offline: a warning, nothing saved, the next run retries. Once `sources.json` exists, even empty, nothing seeds again; `revamp sources add xb00tt/revamp-patches` on a fresh home is itself the seed. `--help`, `list`, `rollback` and `uninstall` never touch the network.
- `npm run dev -w @revamp-app/gui` acts on the real home (installs, sources). For experiments start it as `XDG_CACHE_HOME="$HOME/.cache" HOME=/tmp/x npm run dev -w @revamp-app/gui`: cache first, because bash applies `HOME=… XDG_CACHE_HOME=$HOME/…` left to right.
- Integration runs (`REVAMP_INTEGRATION=1`) use temp homes and the engine tests' Demo app (`packages/engine/test/helpers/demo.ts`): they install nothing for the owner and need no release cache. `sea` runs offline; `packages` needs the npm registry for `acorn` and `xz-decompress`, because its temp home has no npm cache. The real-release tests (Hydra, Heroic, the forced mismatch) live in revamp-patches. To refresh the real menu entries, quit the app, then `npm run revamp -- patch <app>`; `npm run revamp -- list` shows what is installed.
- `npm run publish:packages` refuses a dirty tree, a commit that is on no remote-tracking branch, a missing `npm login` or an existing `v<version>` tag, and needs the three `package.json` versions to equal `ENGINE_VERSION` (`engine/src/version.ts`). The owner's untracked `AGENTS.md` makes the main checkout dirty, so the publish runs from a worktree at `origin/main`: `git fetch origin && git worktree add .worktrees/publish origin/main`, `cp -a node_modules` into it, run there. `-- --pack <dir>` still runs the version check but skips the git-clean, pushed-commit, npm-login and existing-tag guards; it is how `test/integration/packages.test.ts` gets its tarballs. When compiling, packing or publishing fails, the temp dir stays and the script prints `left <tmp> for inspection`.
- Unit tests must not touch the network or the real home. Use temp dirs, local HTTP servers on port 0, or a stub `fetch`. Tests that spawn the CLI start from `freshHome()` (`cli/test/cli.test.ts`), which writes an empty `sources.json` so nothing seeds from GitHub.

## Architecture (the parts that span files)

**Parent and sandbox split (spec §4.4).** The parent process never runs bundle code. `engine/api.ts` `patchApp` runs the job:
1. Describe: `sandbox.ts` spawns `runner.ts` under `node --permission` (bundle readable only). It returns plain JSON (`BundleDescription`). Inside the SEA, the binary is its own runner (`revamp --sandbox-runner`, entry `cli/src/sea.ts`) and the permission flags travel in `--node-options`, because a SEA ignores Node flags in argv. Outside the SEA the child may also read the folder three levels above `sandbox.ts`: the repo in dev, `node_modules` from an npm install.
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

**Bundle format.** One self-contained ESM file with no imports and no top-level `await`, loaded by the runner with `createRequire(bundle)(bundle)` (require(esm)) because `import()` from disk fails inside a Node SEA. Revamp's own tests patch the Demo app, a bundle `packages/engine/test/helpers/demo.ts` writes in that shape.

**Distribution (spec §7, M4).**
- `engine/bundle-sources.ts`: a source is a GitHub repo (`bundle.json` from its default branch), a `bundle.json` URL or a `.mjs` file. `sources add` verifies, caches and describes the bundle, shows it, and pins its SHA-256 once the user confirms. `addDefaultSource` does the same for `DEFAULT_SOURCE` without the prompt, only while `sources.json` is missing. `refreshSources` moves only GitHub pins, to a new `bundle.json` version. The first source with an app wins.
- `engine/updates.ts`: `checkUpdates` (refresh, newest GitHub release per installed app, dry run, `~/.local/state/revamp/last-check.json`) and `updateApp`. `cli/src/timer.ts` writes the systemd user timer that runs the installed binary's `check --notify` daily.
- Publishing is npm: `npm run publish:packages` (`scripts/publish-packages.ts`; pure helpers in `scripts/publish-manifest.ts`, tested in `test/`) compiles sdk, engine and cli with `tsconfig.publish.json` into a temp dir (JavaScript plus `.d.ts`, relative import extensions rewritten), writes each a `package.json` whose `exports` and `bin` point at the compiled files and whose `@revamp-app/*` dependencies are the exact version, runs `npm publish --access public` in that order, then tags and pushes `v<version>`. Inside Revamp nothing changes: the workspace manifests keep pointing at `src/*.ts`. The GUI is never published.
- The bundle release (GitHub release `bundle-v<version>` with `official.mjs` and `patches.json`, root `bundle.json`, CHANGELOG) is revamp-patches' `npm run release`. Revamp publishes no bundle: its old `bundle-v0.3.0` and `bundle-v0.4.0` releases stay as history, and a machine still on the `xb00tt/revamp` source keeps its cached pin until it switches to `xb00tt/revamp-patches`.
- CI (`.github/workflows/ci.yml`) runs the typecheck and the unit tests. The dry-run of every app version in `patches.json` against the real release runs in revamp-patches' CI.
- Bundle text is untrusted on screen too: the CLI prints everything through `printable()`, so control characters can't rewrite the trust prompt.

**GUI (spec §9, M5).** The window is a Tauri v2 shell around `revamp serve`; it holds no engine logic.
- `cli/serve.ts`: JSON-RPC 2.0, one message per line on stdin/stdout, logs on stderr. `createHandler` is tested in-process. Jobs stream `job.progress` from `patchApp`'s `progress` option; the sandboxed child reports each patch start as a `revamp-event {…}` stderr line. `sources.add` takes only a `sources.prepare` token from the same session. `patches.list` also returns `ask`, the new patches the window must ask about. The first request that reads the sources seeds the default source; after a failure (offline) the next sources request tries again, and `sources.add` of the default itself is the seed.
- `packages/gui/src`: Vite + React 18 + TypeScript with its own tsconfig (the root project excludes it). Screen logic lives in `model.ts` and `rpc.ts`, which Node tests cover; the TSX screens are checked in the browser pane through `npm run dev -w @revamp-app/gui`. `platform.ts` picks the transport: the Tauri sidecar, or Vite's websocket bridged to `revamp serve` in dev.
- `packages/gui/src-tauri`: shell and notification plugins; the capability allows spawning only `revamp serve` from beside the window. The installed window's `revamp` is a link to `~/.local/share/revamp/bin/revamp`, so the window and the timer run one binary.
- Check statuses: `update` (newer release, dry-run), `patches` (the source now pins another bundle than the install was patched with; `revamp update` re-patches), `skipped` (`<state>/skipped.json`). Storage (`engine/storage.ts`) removes only what it lists without a keep reason.

The official bundle's own rules (extensions, fingerprinting on real releases) are in xb00tt/revamp-patches' CLAUDE.md.

## Constraints

- TypeScript is run by type stripping. Erasable syntax only: no `enum`, `namespace`, constructor parameter properties or `import x = require()`. Use `import type`, and include `.ts` in relative imports.
- Published packages hold compiled JS: only scripts/publish-packages.ts compiles; nothing compiled is committed.
- Runtime dependencies stay at `acorn` and `xz-decompress` (engine). No native addons. `@electron/asar` is a test oracle only.
- Names from bundles and `.deb` files are untrusted on the parent side: run them through `assertSafeName` / `assertSafeRelativePath` before they reach paths or URLs.
- A production server runs on port 3000 on this machine: never listen on or connect to it. Never read or modify `/opt/Hydra` or `/opt/Heroic`.
- The main checkout is shared with other Claude sessions: don't switch branches or stash there. Do branch work in a worktree: `git worktree add .worktrees/<name> -b <name>` (`.worktrees/` isn't in .gitignore; add it to `.git/info/exclude`), then `cp -a node_modules` into it.
- The git identity (xb00tt) lives in this repo's `.git/config`, not globally: a scratch `git clone` needs `git config user.name/user.email` before it can commit.
- Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`), ending with a `Co-Authored-By: Claude …` trailer.
- The owner (xb00tt) prefers plain-language explanations, one plan per milestone, and subagents on the cheapest model that can do the job.
