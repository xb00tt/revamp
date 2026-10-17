# Moving the official patches to xb00tt/revamp-patches: design

- **Date:** 2026-10-16
- **Status:** approved by the owner 2026-10-17
- **Changes:** the v1 design (`2026-10-14-revamp-v1-design.md`) §4.1, §4.2, §7, §10 and §12, as listed in §10 below.
- **Inputs:** the brainstorm with the owner on 2026-10-16; `docs/research/morphe.md`; the build files of
  MorpheApp/morphe-patches (read 2026-10-16); npm registry lookups on 2026-10-16.

## 1. Intent

Revamp is the app: the SDK, the engine, the CLI and the window. The official patches are one bundle among many that the
app can load. Morphe works the same way: `morphe-patches` holds the patches and depends on versioned releases of
`morphe-patcher`, while `morphe-manager` is the app. Today the official patches sit inside the app's repo
(`bundles/official`), and the app's repo also publishes them (root `bundle.json`, `bundle-v*` releases). This change
moves them into their own repo, **`xb00tt/revamp-patches`**. To the app, that repo is a source like any other that
someone else might create. The one difference is that Revamp comes with it already added.

Revamp publishes its SDK, engine and CLI to npm. revamp-patches, and anyone else writing a patches repo, installs them
like any library.

The official patches stay the real product: they get their own releases, tests, CI and changelog. They are not test
material, and the move doesn't demote them to an example.

## 2. Goals, non-goals, anti-goals

**Goals**
- Revamp publishes `@revamp-app/sdk`, `@revamp-app/engine` and `@revamp-app/cli` to npm (§4).
- `xb00tt/revamp-patches` builds, tests and releases the official bundle on its own, installing those packages from
  npm, with the same checks it has today: unit tests, the extension render tests, real-release integration tests, and
  a CI dry-run of every app version.
- `xb00tt/revamp` contains no real patches and no copy of them. Its tests use the made-up "Demo" app that the engine
  tests already use (`packages/engine/test/helpers/demo.ts`).
- A fresh Revamp install comes with `xb00tt/revamp-patches` as its one source (§5).
- The owner's machine ends up on the new source, with Hydra and Heroic re-patched from it.

**Non-goals**
- No changes to the patches themselves. The first release from the new repo is the same patches as 0.4.0.
- No publishing from CI, and no npm provenance attestations. The owner publishes by hand for now (§4.4).
- No template or example bundle repo for community authors (Morphe has `morphe-patches-template`). It can come later.
- No automatic "this source moved" redirect in the engine. Nobody but the owner uses the old source (0 stars, 0 forks,
  0 recorded release downloads on 2026-10-16), so the owner switches by hand once (§8).
- Issue xb00tt/revamp#2 (Hydra 4.2.0, Heroic 2.22.4) is not part of this work. It moves to the new repo and becomes
  that repo's next release.

**Anti-goals** (would make this a failure even if it technically works)
- Two copies of the patches that can drift: one in revamp-patches, and one left in Revamp or in a published package.
- The official source gets a code path that other sources can't use, beyond being added by default.
- revamp-patches tests run against an engine version nobody pinned. A Revamp push or publish must never silently
  break the patches' CI.
- Development inside Revamp gets slower or gains a build step: Revamp's own tests, CLI from source and the window in
  dev keep running the TypeScript directly, as today.
- The owner's daily Hydra breaks during the move: the old pinned bundle must keep working until the new one is installed.

## 3. What lives where

| | `xb00tt/revamp` (the app) | `xb00tt/revamp-patches` (official patches) |
|---|---|---|
| Code | `packages/{sdk,engine,cli,gui}` | `src/` (apps.ts, hydra/*, heroic/*, universal/*, the Hydra extension, the Steam bridge), `scripts/` (build, extension, release, metadata) |
| Gets the other's code | — | `@revamp-app/{sdk,engine,cli}` from npm, exact versions |
| Tests | engine, CLI, GUI and SDK unit tests; the SEA integration test, moved onto the Demo app | the bundle's unit tests and fixtures (`test/`), the real-release integration tests now in Revamp's `test/integration/{hydra,heroic,hydra-mismatch}.test.ts` |
| CI | typecheck and unit tests | typecheck, unit tests, build, and the dry-run of every app version in `patches.json`. The integration tests stay local-only (`npm run test:integration`), as today. |
| Publishes | the three npm packages. Old `bundle-v0.3.0` and `bundle-v0.4.0` releases stay as they are. | root `bundle.json` and `bundle-v<version>` releases |
| Docs | the v1 spec (amended, §10), plans, research, CLAUDE.md for the app | CLAUDE.md for patch work (fingerprinting rules, extensions, bundle format), README, CHANGELOG.md |
| License | GPL-3.0-only | GPL-3.0-only |

The patch-specific design and plan docs already in Revamp (`2026-10-16-more-like-this-rows-*`, the M1–M5 plans) stay
there as history. The new repo's CLAUDE.md points to them. Fresh history (owner's choice): revamp-patches' first
commit copies the files and names the Revamp commit they came from.

## 4. The npm packages (owner: npm from the start, scope `@revamp-app`)

The `@revamp` scope on npm already belongs to someone else: it exists with no public packages, checked 2026-10-16.
The owner chose **`@revamp-app`**, a free npm organization the owner creates.

### 4.1 What's published and why
- **`@revamp-app/sdk`**: `defineApp`, `definePatch`, fingerprints, types, and the extension shims (`./shims/*`).
- **`@revamp-app/engine`**: the patches' build writes `patches.json` by running the bundle through the engine's sandbox
  (`describe`), the patch tests run patches on fixtures in-process (`runJob`, `memoryStore`), and the integration tests
  call `patchApp`.
- **`@revamp-app/cli`** (my call): the `revamp` command as an npm `bin`. revamp-patches' CI dry-run and a patch
  author's local `npx revamp patch hydra --bundle dist/official.mjs` then run the same command users run. It also
  exports `formatPatchResult`, the §5.6 report the patch tests print.
- The GUI is not published.
- The packages are renamed from `@revamp/*` to `@revamp-app/*` everywhere, in both repos. That's a mechanical rename
  of imports and workspace names.

### 4.2 Running TypeScript inside Revamp, JavaScript when published
- Node refuses to strip types from `.ts` files under `node_modules` (checked on Node 26.12:
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the published packages hold compiled JavaScript plus `.d.ts`
  type declarations.
- Inside Revamp nothing changes: the workspace `package.json` files keep pointing at `src/*.ts`, and tests, the CLI
  from source, the window in dev and the SEA build all run the TypeScript as today. Only the publish step compiles,
  into a staging folder whose `package.json` points at the JavaScript (my call). Nothing compiled is committed.
- Each package exposes only what it lists in `exports`. Patch code can't reach into a package's internal files.
- The published engine's sandbox must still work from `node_modules`. Today in dev mode the child may read the repo
  (the folder three levels above `sandbox.ts`). From an npm install, the same rule gives it the `node_modules` folder
  that holds the engine. That's the same kind of allowance, and the bundle still sees nothing outside it and the job's
  paths. revamp-patches' build catches it at once if this breaks, because `describe` runs in the sandbox.

### 4.3 Versions
- All three packages share one version number, equal to `ENGINE_VERSION` (my call). A bundle's `minEngine` is then an
  npm version too.
- First publish: **0.3.0**. The CLI's behavior changes (the default source, §5) and the package names change.
  `ENGINE_VERSION` moves to 0.3.0 with it. The official bundle's `minEngine` stays 0.2.0, which is still true.
- The publish script refuses when the three `package.json` versions and `ENGINE_VERSION` disagree.
- revamp-patches depends on exact versions (no `^`). Taking a newer engine is a version change plus `npm install`, in
  a commit that CI checks.

### 4.4 Publishing (by hand, like the bundle release)
- `npm run publish:packages` at Revamp's root, run by the owner. It refuses a dirty tree or an unpushed commit,
  compiles the three packages, and runs `npm publish --access public` for each (sdk, then engine, then cli). It then
  tags the commit `v<version>` and pushes the tag, so every npm version maps to a Revamp commit.
- The owner creates the npm account and the `@revamp-app` org, and runs `npm login` on this machine. Claude never
  handles npm credentials. npm may ask the owner for a 2FA code while publishing.
- Publishing from GitHub Actions with npm's trusted publishing and provenance can come later.

### 4.5 Working on the engine and the patches together
To try an unpublished engine change against the patches before publishing, revamp-patches installs Revamp's local
package folders instead of the npm versions (`npm install --no-save ../revamp/packages/{sdk,engine,cli}`). npm links
them, their real paths are outside `node_modules`, so the TypeScript runs directly. `npm ci` returns to the pinned npm
versions. This is the npm counterpart of Morphe's "use `../morphe-patcher` if it's there". The plan verifies the exact
commands.

## 5. The default source (owner: Revamp comes with revamp-patches added)

- When Revamp needs its sources and `~/.config/revamp/sources.json` doesn't exist, it adds `xb00tt/revamp-patches`
  (my call: through the same fetch, verify, cache, sandboxed describe and engine-version check as `sources add`),
  saves `sources.json`, and says so in one line, with the bundle's name, version and SHA-256.
- **No confirmation prompt for the default** (my reading of "comes with it added"). This doesn't weaken trust:
  Revamp already moves a GitHub source's pin to a new version without asking (§7.2, "the source itself is the trust
  anchor"). The default is the one repo the Revamp release itself names.
- **Seeded once** (my call): once `sources.json` exists, Revamp never adds the default again, even if the user removed
  it and the list is empty. The user adds it back like any source (`revamp sources add xb00tt/revamp-patches`). Other
  sources are always added by hand, as today.
- **Offline first run** (my call): if adding the default fails, nothing is saved, the command reports why (the same
  message `sources add` would give), and the next run tries again.
- Only things that read sources trigger it: `patch`/`patches` without `--bundle`, `sources list`, `check`, `update`, and
  the window's app list and Sources screen (`revamp serve`). Commands like `--help`, `list`, `rollback` and
  `uninstall` never touch the network for it.
- My calls on how it's built:
  - `loadSources` stays a plain read of the file with no network, so storage cleanup and every other existing reader
    never seed.
  - Seeding is one separate async engine function, called at the start of the entry points above. It takes the same
    `SourceFetchOptions` as `prepareSource`, so a unit test can point it at a local server.
  - "Exists" means the file exists, even with an empty list. A corrupt file fails as it does today.
  - Two first runs at once (the timer and the window): each one writes only if `sources.json` still doesn't exist
    right before it saves, using the same temp-file-and-rename write as today. The second one keeps what the first
    saved.
  - The window shows its usual loading state while the first `serve` request seeds.
- The hints that today say `revamp sources add xb00tt/revamp` (CLI messages, the window's empty Sources screen) name
  `xb00tt/revamp-patches`.
- The CLI's "running from the repo, use `bundles/official/dist/official.mjs`" fallback (`packages/cli/src/bundle-for.ts`)
  goes away: there is no bundle in the repo any more.
- Unit tests must stay off the network: tests that start from an empty home and want no sources write an empty
  `sources.json` first, or point the fetch at a local server, as the bundle-sources tests do now. The SEA integration
  test writes an empty `sources.json` too, then checks the "no bundle source" message, which now names
  `xb00tt/revamp-patches`. So Revamp's tests never depend on revamp-patches existing.

## 6. revamp-patches layout (my call)

The bundle package becomes the repo root:
- `src/`, `scripts/`, `test/` (unit tests and fixtures), `test/integration/`
- `CHANGELOG.md`, `bundle.json`
- `package.json`, `package-lock.json`, `.npmrc` (`engine-strict=true`), `tsconfig.json` plus the extension's own
  tsconfig
- `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md`, `LICENSE` (GPL-3.0)

The dev dependencies are the `@revamp-app` packages plus whatever the patches use today: esbuild, react and
react-test-renderer 18.3.1, @types/react, @types/node, typescript, and @electron/asar for the integration tests.
`npm run revamp -- …` runs the npm-installed CLI.

## 7. Releases of the bundle

- `npm run release` runs at the root of revamp-patches (it is the bundle's own repo now). It still refuses a dirty tree or
  an unpushed commit, still creates the GitHub release `bundle-v<version>` with `official.mjs` and `patches.json` (my
  call: keep the tag name, so the release script and `bundleJson()` change only in their paths), and still commits
  `bundle.json` at the repo root, which is what GitHub sources read.
- `manifest.source` becomes `github:xb00tt/revamp-patches`, so `download_url` points at the new repo's releases.
- First release: **0.4.1**, the same patches as 0.4.0, with a CHANGELOG entry saying the bundle moved to its own repo.
  Its bytes differ from 0.4.0 (the source line changed), so installed apps show as "patches" in `revamp check` until
  they're re-patched. That is expected.
- Revamp's root `bundle.json` is deleted once the owner's machine is on the new source (§8). Anyone still on
  `xb00tt/revamp` then sees "not refreshed, still using 0.4.0" from `check`, and their cached pinned bundle keeps working.

## 8. The owner's machine

Today: `~/.config/revamp/sources.json` holds `xb00tt/revamp` pinned at 0.4.0, `~/.local/bin/revamp` is the installed
SEA, the daily `revamp-check.timer` is on, and the window comes from `npm run gui:install`.

After revamp-patches 0.4.1 is released and Revamp's split is merged:
1. Install the new CLI from Revamp's main (`npm run install:cli`; the window shares that binary).
2. `revamp sources remove xb00tt/revamp`, then `revamp sources add xb00tt/revamp-patches` (or the same in the
   window's Sources screen). Because `sources.json` exists, the default isn't seeded on this machine. The switch is by
   hand, as for any source.
3. `revamp check`, then `revamp update` for Hydra and Heroic (quit Hydra first).
4. `revamp list` shows both apps patched from "Revamp official" 0.4.1.

## 9. Order of work

Each step that publishes or changes the owner's machine waits for the owner's go-ahead.

1. **Revamp, on a branch in a worktree:** the `@revamp-app` rename, the publish script (§4), the default source and
   hint changes (§5), the SEA test moved to the Demo app, removal of `bundles/official`, the moved integration tests,
   the bundle CI jobs and the repo-build fallback, and the doc updates (§10). Root `bundle.json` stays for now. Before
   merging, a dry run checks the compiled packages from a local `npm pack` in a scratch project: install, import, run
   the sandbox, run `revamp`. Merge to main.
2. **Owner:** create the npm account and the `@revamp-app` org, then `npm login`.
3. **Owner go-ahead:** `npm run publish:packages` (0.3.0).
4. **revamp-patches, built locally:** files copied from Revamp at the commit before step 1 removed them, laid out as in
   §6, on `@revamp-app/*` 0.3.0 from npm, with CI, CLAUDE.md, README and version 0.4.1. All tests, the typecheck, the
   build and the integration tests pass locally.
5. **Owner go-ahead:** create the public GitHub repo `xb00tt/revamp-patches`, push, and see CI pass.
6. **Owner go-ahead:** `npm run release` there (`bundle-v0.4.1`, root `bundle.json`), then push.
7. **Owner go-ahead:** switch the owner's machine (§8).
8. **Owner go-ahead:** delete Revamp's root `bundle.json` (one commit), and transfer issue #2 to revamp-patches
   (`gh issue transfer`).

Until step 7 the owner's Hydra keeps running on the cached 0.4.0 bundle pinned from `xb00tt/revamp`.

## 10. Doc changes

**Revamp:**
- v1 spec: a line at the top pointing here.
- §4.1 layout: no `bundles/`, and a note that the official bundle is `xb00tt/revamp-patches`.
- §4.2: drop the `bundles/official` row.
- §7.1: the build and outputs belong to revamp-patches.
- §7.2: add the default source, and replace the "Before M4: defaults to the repo build" line.
- §7.4: CI's dry-run matrix runs in revamp-patches.
- §10: now lives in revamp-patches.
- §12: the integration bullets split per repo.
- §2 Q7 ("keeps the SDK separable for community bundles") gains the npm packages.
- CLAUDE.md: loses the patch-side sections (fingerprinting rules, extensions, bundle build/release commands) and gains
  the publish command and a short "the official patches are xb00tt/revamp-patches; Revamp adds it as the default
  source" note. README likewise.

**revamp-patches:**
- A CLAUDE.md with the bundle commands, how to take a new engine version (§4.3) and try an unpublished one (§4.5),
  the extension and fingerprinting rules carried over from Revamp's CLAUDE.md, and the constraints that still apply
  (Node 26, erasable TS, no network in unit tests, never touch `/opt/Hydra`, `/opt/Heroic` or port 3000).

## 11. Left to the builder

- The compile tool for publishing (tsc with `rewriteRelativeImportExtensions` and declarations, or esbuild for the
  JavaScript plus tsc for the declarations), as long as §4.2 holds.
- Where the default-source seeding hook sits in the engine and CLI, as long as §5's behavior holds.
- The exact `package.json`, `exports` and `tsconfig.json` of revamp-patches and of the published packages.
- How the SEA test feeds the Demo release to the binary without the network (for example, by pre-filling the release
  cache with the Demo `.deb` whose hash the Demo bundle pins).
- Which root dev dependencies Revamp can drop once the extension tests leave (react, react-test-renderer and
  @types/react, if the GUI doesn't need them at the root).
