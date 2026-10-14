# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Revamp is "Morphe for Linux Electron apps": it downloads an official release `.deb` (Hydra, Heroic), verifies its SHA-256, edits the built JavaScript inside `app.asar` at rest, and installs "<App> (Revamped)" next to the stock app in `~/.local/share/revamp`. TypeScript on Node 26, npm workspaces: `packages/{sdk,engine,cli}` and `bundles/official`.

**Source of truth:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md` (binding design, milestones in §13) and one implementation plan per milestone in `docs/superpowers/plans/`. Read the spec section and the latest plan before changing behavior. Plan code blocks were run on a fresh clone before hand-off: implementers copy them exactly, and a failure usually means a typo or the wrong Node.

## Commands

Node 26 is installed only at `~/.local/node-26`; every command needs it first (`.npmrc` has `engine-strict=true`):

```bash
export PATH="$HOME/.local/node-26/bin:$PATH"
npm test                                    # all unit tests (node --test, TS runs natively, no network)
npm run typecheck                           # tsc --noEmit over packages, bundles and tests
node --test packages/engine/test/api.test.ts                       # one test file
node --test --test-name-pattern='unlisted version' packages/engine/test/api.test.ts   # one test
npm run build -w @revamp/bundle-official    # esbuild → bundles/official/dist/official.mjs
npm run test:integration                    # builds the bundle, then patches the REAL releases into temp homes
npm run revamp -- patches hydra             # CLI from source; also: patch <app> [--version v --force]
                                            #   [--enable/--disable "<patch>"] [--option "<patch>:<key>=<value>"]
                                            #   [--bundle file] [--dry-run], list, rollback <app>, uninstall <app>
```

- The CLI and integration tests use `bundles/official/dist/official.mjs`. Rebuild it after changing bundle sources, or the CLI runs the old patches.
- The integration tests (`REVAMP_INTEGRATION=1`) reuse the real download cache `~/.cache/revamp/releases`: Hydra 4.1.6, Heroic 2.22.3, and Hydra 4.0.6 forced as the deliberate mismatch. Without the cache that is about 430 MB of downloads. With it, a run takes about a minute.
- Passing tests install nothing for the owner: integration runs use temp homes. To refresh the real menu entries, quit the app, then `npm run revamp -- patch <app>`; `npm run revamp -- list` shows what is installed.
- The forced Hydra 4.0.6 test calls api.github.com unauthenticated (60 requests/hour); HTTP 403 there means wait and rerun.
- Inspect a real build in a scratch dir: `dpkg-deb --fsys-tarfile <cached .deb> | tar -x`, then `extractFile` from `@electron/asar` (repo node_modules). Never eval app code; parse with acorn or regex.
- Unit tests must not touch the network or the real home. Use temp dirs, local HTTP servers on port 0, or a stub `fetch`.

## Architecture (the parts that span files)

**Parent and sandbox split (spec §4.4).** The parent process never runs bundle code. `engine/api.ts` `patchApp` runs the job:
1. Describe: `sandbox.ts` spawns `runner.ts` under `node --permission` (bundle readable only). It returns plain JSON (`BundleDescription`).
2. The parent checks the engine version, app, version and selection (`config.ts` `resolveSelection`) before any download.
3. Download with SHA-256 verification (`download.ts`). The hash comes from the bundle; for unlisted versions with `--force`, from GitHub's release API `digest` (labeled "untested").
4. Safe streaming `.deb` extraction into `apps/<app>/.staging-*` (`deb.ts`).
5. Patch in the sandboxed child: reads staging and the bundle, writes only `.revamp-out/`.
6. The parent appends the changed files to `app.asar` (`asar.ts`, copy data region + append + new header).
7. Install: atomic rename, `current` symlink, receipt, `.desktop` entry (`install.ts`).

All network, hashing, extraction and installing happen in the parent.

**Patch model (`@revamp/sdk` declares, the engine does the work).**
- Bundles define apps (`defineApp`: release pins per version, `installDir`, `executable`, `desktopFile`, required patches), patches (`definePatch`) and fingerprints.
- A fingerprint runs `strings` (indexOf prefilter) → by-example `pattern` (acorn AST matcher in `pattern.ts`: `$X` captures one node, `$$$` a list, object patterns match unordered subsets) → named `where` checks → `count`. Each failure throws `FingerprintError` naming the fingerprint and the step; the CLI prints these as the spec §5.6 report.
- Matches (`match.ts`) edit by splices against the original text: `replace` / `insertBefore` / `insertAfter` / `remove`, with list commas added automatically, plus `find`, `findAll` and `resolve()` (identifier → top-level declaration).
- `edits.ts` buffers edits per patch, so a throwing patch leaves nothing behind. Overlapping edits fail, naming both patches. Every changed JS file is re-parsed.
- `graph.ts`: patches run in topological order with ties by name, so inserts at the same position follow patch-name order. `finalize` runs in reverse. A failed dependency marks dependents `skipped`. Internal patches have no `name`, are reached via `dependsOn`, and are labeled by their `description`.

**Bundle format.** One self-contained ESM file with no imports and no top-level `await`. The runner loads it with `require(esm)`, because `import()` from disk fails inside a Node SEA.

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
