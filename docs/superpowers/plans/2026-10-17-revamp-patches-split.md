# Moving the official patches to xb00tt/revamp-patches: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp publishes `@revamp-app/{sdk,engine,cli}` to npm and comes with `xb00tt/revamp-patches` as its default source; the official patches leave `bundles/official` for their own repo, which builds, tests and releases them on those npm packages.

**Architecture:** Part A changes Revamp on one branch: a scope rename, a publish script that compiles only at publish time, the default source, and removing the bundle. Part B is the owner publishing 0.3.0. Part C builds revamp-patches next to Revamp (`/home/borislav/github/revamp-patches`) from the bundle's files, on the published packages. Part D is the owner-gated GitHub, release and machine steps.

**Tech Stack:** Node 26.12 (type stripping), npm 11 workspaces, TypeScript 7.0.2 (`tsc` emit for publishing only), esbuild 0.28, GitHub Actions, `gh`.

**Spec:** `docs/superpowers/specs/2026-10-16-revamp-patches-split-design.md` (read it with this plan). It amends `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`.

**Verified before hand-off (2026-10-17, scratch clone):**
- The `@revamp-app` rename passes all 305 tests.
- `tsc` emit with `rewriteRelativeImportExtensions` compiles all three packages in under a second.
- After the runner-path fix (Task 1), the packed packages install into a fresh project. `describe` runs its sandbox from `node_modules`, and `npx revamp patches demo --bundle …` works.
- `npm install --no-save ../revamp/packages/{sdk,engine,cli}` links the TypeScript sources and runs them, without touching `package.json` or the lockfile. `npm ci` restores the npm versions.
- revamp-patches laid out as in Task 7 builds and passes its typecheck, 98 of 99 unit tests (the one failure is the `download_url` expectation that Task 7 updates), and 4 of 4 integration tests against the real Hydra 4.1.6 and Heroic 2.22.3.
- Without `bundles/`, Revamp passes its typecheck and 202 of 203 tests. The SDK's `shims.test.ts` needs `react` and `react-test-renderer`, so those root dev dependencies stay.

## Global Constraints

- Node 26 and Rust come first on every shell: `export PATH="$HOME/.cargo/bin:$HOME/.local/node-26/bin:$PATH"`. Both repos have `.npmrc` with `engine-strict=true`.
- TypeScript runs by type stripping: erasable syntax only, `import type`, and `.ts` in relative imports.
- npm scope: `@revamp-app`. Package names: `@revamp-app/sdk`, `@revamp-app/engine`, `@revamp-app/cli`. The GUI (`@revamp-app/gui`) is renamed but never published.
- Version: the three packages and `ENGINE_VERSION` are all `0.3.0`. revamp-patches pins them exactly (no `^`).
- Default source: `xb00tt/revamp-patches`.
- First bundle release from the new repo: `0.4.1`, tag `bundle-v0.4.1`, `manifest.source: "github:xb00tt/revamp-patches"`. `minEngine` stays `"0.2.0"`.
- Engine runtime dependencies stay `acorn` and `xz-decompress`. No native addons.
- Unit tests never touch the network or the real home.
- Never listen on or connect to port 3000. Never read or modify `/opt/Hydra` or `/opt/Heroic`.
- The main checkout is shared: work in `.worktrees/split-patches` (branch `split-patches`). Don't switch branches or stash in the main checkout. `AGENTS.md` there is the owner's untracked file: leave it.
- Commits are conventional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Publishing to npm, creating or pushing the GitHub repo, `gh release`, `gh issue transfer`, merging, and anything on the owner's machine (`install:cli`, `sources`, `update`) each wait for the owner's go-ahead in chat. Claude never runs `npm login` and never handles npm credentials.

## Review Focus

1. **Offline first run:** adding the default source fails, so nothing is saved, the command still works (with `--bundle`, or with the usual "no bundle source" error), and the next run tries again. Tested in Task 3.
2. **The user removed the default source:** the empty `sources.json` must never be re-seeded. Tested in Task 3.
3. **A published engine run from a path with a space:** its sandbox still reads its own files and nothing outside. The packages test in Task 2 installs into a temp dir with a space.
4. **Deep imports into a published package fail:** `@revamp-app/engine/src/api.js` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, so patch code can only use the listed exports. Asserted in Task 2's packages test.
5. **A unit test that silently seeds from GitHub:** every CLI or serve test that starts from an empty home must write an empty `sources.json`. Task 3, Step 6 checks this with grep.

---

## Part A: Revamp (branch `split-patches`)

### Task 0: Worktree and docs

- [ ] **Step 1: Create the worktree and bring the two docs in**

```bash
cd /home/borislav/github/revamp
grep -qx '.worktrees/' .git/info/exclude || echo '.worktrees/' >> .git/info/exclude
git worktree add .worktrees/split-patches -b split-patches
cp -a node_modules .worktrees/split-patches/
cp docs/superpowers/specs/2026-10-16-revamp-patches-split-design.md .worktrees/split-patches/docs/superpowers/specs/
cp docs/superpowers/plans/2026-10-17-revamp-patches-split.md .worktrees/split-patches/docs/superpowers/plans/
```

- [ ] **Step 2: Mark the design approved and commit both docs.** In the worktree, change the design's `**Status:**` line to `approved by the owner 2026-10-17`. Then:

```bash
cd /home/borislav/github/revamp/.worktrees/split-patches
git add docs/superpowers/specs/2026-10-16-revamp-patches-split-design.md docs/superpowers/plans/2026-10-17-revamp-patches-split.md
git commit -m "docs: design and plan for moving the official patches to xb00tt/revamp-patches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Afterwards, delete the two untracked copies from the main checkout: `rm docs/superpowers/specs/2026-10-16-revamp-patches-split-design.md docs/superpowers/plans/2026-10-17-revamp-patches-split.md`, run in `/home/borislav/github/revamp`. Run every later step in the worktree.

### Task 1: Rename to `@revamp-app`, version 0.3.0, publishable entry points

**Files:**
- Modify: every file outside `docs/superpowers/plans/` and `docs/superpowers/specs/2026-10-1[46]-*` that contains `@revamp/`. Run `grep -rl "@revamp/" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=target --exclude-dir=.worktrees .` and skip the old plans and specs, which are history. `package-lock.json` is regenerated, not edited.
- Modify: `packages/{sdk,engine,cli}/package.json` (version `0.3.0`), `packages/engine/src/version.ts` (`ENGINE_VERSION = "0.3.0"`).
- Modify: `packages/cli/package.json` gets `"exports": { "./format": "./src/format.ts" }` and `"bin": { "revamp": "src/main.ts" }`.
- Modify: `packages/cli/src/main.ts`: the first line becomes `#!/usr/bin/env node`.
- Modify: `packages/engine/src/sandbox.ts:35`: the runner is `./runner.ts` next to a `.ts` sandbox and `./runner.js` next to a compiled one: `new URL(import.meta.url.endsWith(".ts") ? "./runner.ts" : "./runner.js", import.meta.url)`.

**Interfaces:**
- Produces: the workspace names `@revamp-app/sdk`, `@revamp-app/engine`, `@revamp-app/cli`, `@revamp-app/gui`, `@revamp-app/bundle-official`; `@revamp-app/cli/format` (which exports `formatPatchResult` and the rest of `format.ts`); `ENGINE_VERSION === "0.3.0"`.

- [ ] **Step 1: Rename**

```bash
grep -rl "@revamp/" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=target --exclude-dir=.worktrees . \
  | grep -v -e '^./docs/superpowers/plans/2026-10-1[4567]' -e '^./docs/superpowers/specs/2026-10-1[46]-.*-design.md$' \
  | xargs sed -i 's#@revamp/#@revamp-app/#g'
rm -rf node_modules/@revamp && npm install
```

Expected: `ls node_modules/@revamp-app` lists `bundle-official cli engine gui sdk`. (The `grep -v` keeps the dated plans and specs out of the rename: the old ones are history, this plan describes the rename itself, and Task 5 edits the v1 spec by hand.)

- [ ] **Step 2: Apply the version, `exports`/`bin`, shebang and runner-path edits listed under Files**

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: the typecheck prints nothing, and 305 tests pass, 0 fail.

- [ ] **Step 4: Commit**: `chore: rename the packages to @revamp-app and version them 0.3.0` (stage everything Step 1 and Step 2 touched, `package-lock.json` included).

### Task 2: Publish script

**Files:**
- Create: `tsconfig.publish.json` (root). It extends `./tsconfig.json` with `noEmit: false`, `declaration: true`, `rewriteRelativeImportExtensions: true`, `rootDir: "packages"` and `include: ["packages/sdk/src", "packages/engine/src", "packages/cli/src"]`, with `exclude: []`. `outDir` is passed on the command line.
- Create: `scripts/publish-manifest.ts`: pure functions, no I/O.
- Create: `scripts/publish-packages.ts`: the owner's command.
- Create: `test/publish-manifest.test.ts` (unit), `test/integration/packages.test.ts` (gated).
- Modify: root `package.json`. Add `"publish:packages": "node scripts/publish-packages.ts"`. The `test` script becomes `node --test "packages/*/test/*.test.ts" "bundles/*/test/*.test.ts" "test/*.test.ts"`. Add `"scripts"` to root `tsconfig.json`'s `include`.

**Interfaces:**
- Produces, in `scripts/publish-manifest.ts`:
  - `export const PUBLISHED = ["sdk", "engine", "cli"] as const`: the publish order.
  - `export function publishedManifest(pkg: Record<string, any>, version: string): Record<string, unknown>`. Returns `{ name, version, type: "module", license, exports, dependencies, bin? }`. Every `exports` value `./src/x.ts` becomes `{ types: "./src/x.d.ts", default: "./src/x.js" }`. Every `bin` value has `.ts` replaced by `.js`. Every `@revamp-app/*` dependency becomes exactly `version`. Other dependencies are copied as they are.
  - `export function versionProblem(versions: Record<string, string>, engineVersion: string): string | undefined`. It returns a message naming each package whose version differs from `engineVersion`, or `undefined` when they all match.
- Produces: `npm run publish:packages [-- --pack <dir>]`. With `--pack`, it compiles, stages and runs `npm pack --pack-destination <dir>` for each package. It publishes nothing, and the clean-tree, pushed-commit and npm-login guards are skipped.

- [ ] **Step 1: Write `test/publish-manifest.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedManifest, versionProblem } from "../scripts/publish-manifest.ts";

test("publishedManifest points exports and bin at the compiled files and pins the sibling packages", () => {
  const cli = { name: "@revamp-app/cli", version: "0.3.0", private: true, type: "module", license: "GPL-3.0-only",
    exports: { "./format": "./src/format.ts" }, bin: { revamp: "src/main.ts" }, scripts: { build: "x" },
    dependencies: { "@revamp-app/engine": "*", acorn: "^8.19.0" } };
  assert.deepEqual(publishedManifest(cli, "0.3.0"), {
    name: "@revamp-app/cli", version: "0.3.0", type: "module", license: "GPL-3.0-only",
    exports: { "./format": { types: "./src/format.d.ts", default: "./src/format.js" } },
    dependencies: { "@revamp-app/engine": "0.3.0", acorn: "^8.19.0" },
    bin: { revamp: "src/main.js" },
  });
});

test("versionProblem names each package that differs from ENGINE_VERSION", () => {
  assert.equal(versionProblem({ sdk: "0.3.0", engine: "0.3.0", cli: "0.3.0" }, "0.3.0"), undefined);
  assert.match(versionProblem({ sdk: "0.3.0", engine: "0.2.0", cli: "0.3.0" }, "0.3.0")!, /engine is 0\.2\.0/);
});
```

- [ ] **Step 2: Run it.** `node --test test/publish-manifest.test.ts`. Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement `scripts/publish-manifest.ts`** with the Interfaces above. `private` and `scripts` must not appear in the output (the test checks this).

- [ ] **Step 4: Run it.** Same command. Expected: PASS, 2 tests.

- [ ] **Step 5: Implement `scripts/publish-packages.ts`.** Its header comment says what it does, in the style of `bundles/official/scripts/release.ts`. In order:
  1. Read the three `packages/<name>/package.json` files and `ENGINE_VERSION`. Throw `versionProblem(...)` if it returns a message.
  2. Unless `--pack`:
     - throw `"commit your changes first: the packages must match a commit"` if `git status --porcelain` is non-empty;
     - throw `"push this branch first: the tag must be on a commit GitHub has"` if `@{u}` isn't `HEAD`;
     - throw `"run npm login first (as the owner of @revamp-app)"` if `npm whoami` fails;
     - throw `"v<version> is already tagged: raise the version first"` if `git rev-parse -q --verify refs/tags/v<version>` succeeds.
  3. Compile: `npx tsc -p tsconfig.publish.json --outDir <tmp>/compiled`, with `<tmp>` from `mkdtempSync`.
  4. For each name in `PUBLISHED`: copy `<tmp>/compiled/<name>/src` to `<tmp>/stage/<name>/src`, write `publishedManifest(pkg, version)` as `<tmp>/stage/<name>/package.json`, and copy the root `LICENSE` in.
  5. In each stage dir, in `PUBLISHED` order: with `--pack <dir>`, run `npm pack --pack-destination <abs dir>`; otherwise run `npm publish --access public`, using `stdio: "inherit"` so npm can ask for 2FA.
  6. Unless `--pack`: `git tag v<version>`, then `git push origin v<version>`. Print `Published @revamp-app/{sdk,engine,cli} <version> and pushed tag v<version>.`

- [ ] **Step 6: Write `test/integration/packages.test.ts`**, gated like the others: `skip` unless `REVAMP_INTEGRATION=1`. Steps:
  - `npm run publish:packages -- --pack <tmp>/packs`.
  - In `<tmp>/consumer project/` (the space is deliberate), write `{"name":"c","private":true,"type":"module"}` and `npm install` the three `.tgz` files.
  - Write a Demo bundle there with `writeDemoBundle` from `packages/engine/test/helpers/demo.ts`, using `sha256: "0".repeat(64)`.
  - Assertions, each by running `node` in that project:
    - `import { describe, ENGINE_VERSION } from "@revamp-app/engine"`, then `describe(<bundle>)` gives `manifest.name === "Demo bundle"` and `ENGINE_VERSION === "0.3.0"`.
    - `import("@revamp-app/cli/format")` exposes a `formatPatchResult` function.
    - `import("@revamp-app/engine/src/api.js")` rejects with code `ERR_PACKAGE_PATH_NOT_EXPORTED`.
    - With `HOME=<tmp>/home`, `node_modules/.bin/revamp patches demo --bundle <bundle>` exits 0 and its stdout starts with `Demo 1.0.0, from bundle "Demo bundle" 1.0.0`.

- [ ] **Step 7: Run it.** `REVAMP_INTEGRATION=1 node --test test/integration/packages.test.ts`. Expected: PASS, 1 test. This needs npm's registry for `acorn` and `xz-decompress`, like any install.

- [ ] **Step 8: Verify and commit.** Run `npm run typecheck && npm test` (expected: 307 pass). Commit with `feat: npm run publish:packages compiles and publishes @revamp-app/{sdk,engine,cli}`.

### Task 3: The default source

**Files:**
- Modify: `packages/engine/src/bundle-sources.ts` (+ export from `packages/engine/src/index.ts`)
- Modify: `packages/cli/src/main.ts`, `packages/cli/src/serve.ts`, `packages/cli/src/bundle-for.ts`, `packages/cli/src/format.ts:78`, `packages/engine/src/updates.ts:86`, `packages/gui/src/Sources.tsx:138`
- Test: `packages/engine/test/bundle-sources.test.ts`, `packages/cli/test/cli.test.ts`, `packages/cli/test/serve.test.ts`

**Interfaces:**
- Produces (engine):
  - `export const DEFAULT_SOURCE = "xb00tt/revamp-patches"`.
  - `export async function addDefaultSource(paths: Paths, o?: SourceFetchOptions): Promise<BundleSource | undefined>`:
    - `sources.json` exists, whatever its list: returns `undefined` and fetches nothing.
    - Otherwise: `prepareSource(paths, DEFAULT_SOURCE, o)`. If `sources.json` still doesn't exist, it saves `[source]` with the same temp-file-and-rename write and returns the source. If another process saved it meanwhile, it returns `undefined`.
    - Errors from `prepareSource` propagate, and nothing is saved.
    - `// ponytail:` comment: a check-then-rename, not a lock. Two first runs within the same millisecond can both write. Both write the same source, so this is harmless.
- Produces (cli), in `bundle-for.ts` next to `bundleFor`:
  - `export async function seedDefaultSource(paths: Paths, warn: (line: string) => void, o?: SourceFetchOptions): Promise<void>`.
  - It calls `addDefaultSource`. On success it warns `Added the default source xb00tt/revamp-patches: "<name>" <version> (sha256 <sha256>)`. On failure it warns `Warning: couldn't add the default source xb00tt/revamp-patches: <message>`. It never throws.

- [ ] **Step 1: Write the failing engine tests** in `bundle-sources.test.ts`. They use the existing local server, which already serves `/raw/example/bundles/HEAD/bundle.json`; add `/raw/xb00tt/revamp-patches/HEAD/bundle.json` serving the same `state.bundleJson`.
  - `addDefaultSource seeds xb00tt/revamp-patches when there is no sources.json`: the returned `location` is `"xb00tt/revamp-patches"`, and `loadSources(paths)` has exactly that one source.
  - `addDefaultSource never re-adds the default after the user emptied the list`: write `{"sources":[]}`, then expect `undefined`, no request to the server (count requests), and `loadSources(paths)` equal to `[]`.
  - `addDefaultSource saves nothing when it can't fetch`: set `state.rawStatus = 500` and make the API fail too. Expect a rejection matching `/couldn't fetch bundle.json from xb00tt\/revamp-patches/`, and `existsSync(sources.json) === false`. A second call after `state.rawStatus = 200` succeeds.

- [ ] **Step 2: Run them.** `node --test packages/engine/test/bundle-sources.test.ts`. Expected: the 3 new tests FAIL, because `addDefaultSource` isn't exported.

- [ ] **Step 3: Implement `DEFAULT_SOURCE` and `addDefaultSource`** as specified, and export both from the engine index.

- [ ] **Step 4: Run them again.** Expected: PASS.

- [ ] **Step 5: Wire it in.** It must reach the network only where design §5 lists:
  - CLI `main.ts`: `await seedDefaultSource(paths, printError)` runs first in the `patch` and `patches` branches when `values.bundle` is unset, in `sources list`, in `check`, and in `update`. No other command calls it.
  - `serve.ts`: `const seeded = seedDefaultSource(o.paths, o.log, o)` is a promise created on first use and reused after. `apps()` and the `sources.list` method await it before `loadSources`.
  - `bundle-for.ts`: drop the repo-build fallback and the `isSea`/`fileURLToPath` imports it needed. With no source, it throws `` `no bundle source has "${appId}"; add one, e.g. revamp sources add xb00tt/revamp-patches` ``. The doc comment says `--bundle, else the first bundle source with the app (spec §7.2)`.
  - The hints become `xb00tt/revamp-patches`: `format.ts:78` (`No bundle sources. Add one: revamp sources add xb00tt/revamp-patches`), the `main.ts:61` usage error, `updates.ts:86`, and `Sources.tsx:138` (`Add xb00tt/revamp-patches, the official patches for Hydra and Heroic.`).

- [ ] **Step 6: Keep the CLI and serve tests offline.**
  - In `cli.test.ts`, add `freshHome()`. It runs `mkdtempSync(join(tmpdir(), "revamp-cli-"))`, writes `<home>/.config/revamp/sources.json` as `{"sources":[]}\n`, and returns the home. The `cli()` default and every `const home = mkdtempSync(join(tmpdir(), "revamp-cli-"))` use it.
  - Do the same in `serve.test.ts` for the two spawned `revamp serve` tests (`revamp-serve-cli-`, `revamp-serve-epipe-`).
  - Update the expected strings that say `xb00tt/revamp`.
  - Check: `grep -n 'mkdtempSync(join(tmpdir(), "revamp-\(cli\|serve-cli\|serve-epipe\)-"))' packages/cli/test/*.ts` matches only inside the helpers.

- [ ] **Step 7: Verify.** Run `npm run typecheck && npm test`. Expected: 310 pass, 0 fail. Then check the window: `XDG_CACHE_HOME="$HOME/.cache" HOME=/tmp/rv-empty npm run dev -w @revamp-app/gui` with `/tmp/rv-empty/.config/revamp/sources.json` = `{"sources":[]}`, and look at the Sources screen in the browser pane. It shows the new hint. Stop the dev server afterwards.

- [ ] **Step 8: Commit**: `feat: Revamp comes with xb00tt/revamp-patches as its default source`.

### Task 4: Remove the official bundle from Revamp

**Files:**
- Delete: `bundles/`, `test/integration/hydra.test.ts`, `test/integration/heroic.test.ts`, `test/integration/hydra-mismatch.test.ts`.
- Modify root `package.json`:
  - `workspaces: ["packages/*"]`;
  - `test`: `node --test "packages/*/test/*.test.ts" "test/*.test.ts"`;
  - `typecheck`: `tsc -p . && tsc -p packages/gui`;
  - `test:integration`: `REVAMP_INTEGRATION=1 node --test "test/integration/*.test.ts"`.
  - Dev dependencies stay. `react`, `react-test-renderer`, `@types/react` and `esbuild` are still used: by the SDK tests, the GUI and the SEA build.
- Modify: `tsconfig.json`: drop the three `bundles/*` entries from `include` and `bundles/official/src/hydra/extension` from `exclude`.
- Modify: `.github/workflows/ci.yml`: keep one `test` job (checkout, setup-node 26 with npm cache, `npm ci`, `npm run typecheck`, `npm test`). Drop the bundle build, the `matrix` step and output, and the `dry-run` job. The header comment says the dry-run matrix runs in xb00tt/revamp-patches.
- Modify: `test/integration/sea.test.ts`: move it onto the Demo app.
- Keep: the root `bundle.json` (deleted in Part D).

- [ ] **Step 1: Note the last commit that still has the bundle.** Part C copies its files from here.

```bash
git rev-parse HEAD | tee /home/borislav/.config/Claude/side-session-notes/local_49365169-927f-4ffb-bab6-fc6055b1d4a5/bundle-source-commit.txt
```

- [ ] **Step 2: Delete and edit as listed under Files**, then `rm -rf node_modules/@revamp-app/bundle-official && npm install`.

- [ ] **Step 3: Rewrite `sea.test.ts` onto the Demo app.** It keeps the same checks: the space-in-path quoting, the evil bundle denied, the timer refusal and serve speaking JSON-RPC. The bundle and the release change:
  - `env.XDG_CACHE_HOME` becomes `join(dir, "cache")`, not the real cache.
  - Write `demoDeb()` (from `packages/engine/test/helpers/demo.ts`) to `<XDG_CACHE_HOME>/revamp/releases/demo/1.0.0/demo_1.0.0_amd64.deb`. Write `writeDemoBundle(join(dir, "demo bundle.mjs"), { sha256 })` with that file's SHA-256. The download then finds the cached file and never fetches.
  - Before the "no default bundle" check, write `<HOME>/.config/revamp/sources.json` as `{"sources":[]}\n`. That check now expects `revamp: no bundle source has "demo"; add one, e.g. revamp sources add xb00tt/revamp-patches\n`.
  - Expectations:
    - `patches demo --bundle <bundle>` stdout matches `/^Demo 1\.0\.0, from bundle "Demo bundle"/`;
    - serve's `patches.list` for `demo` gives `["Demo", "1.0.0", "Demo bundle"]`;
    - `patch demo --dry-run` stdout matches `/^Demo 1\.0\.0: 1\/1 patches apply \(dry run, nothing installed\)$/m`.
  - It's still gated on `REVAMP_INTEGRATION=1`, and it no longer needs `~/.cache/revamp/releases`.

- [ ] **Step 4: Verify.**
  - `npm run typecheck && npm test`: expected 208 pass (310 minus the bundle's 102).
  - `npm run test:integration`: expected 2 pass (`sea`, `packages`).
  - `grep -rn "bundles/official\|bundle-official" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs .`: expected no output.

- [ ] **Step 5: Commit**: `chore: remove the official bundle; it lives in xb00tt/revamp-patches`.

### Task 5: Docs

**Files:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`, `CLAUDE.md`, `README.md`.

- [ ] **Step 1: Amend the v1 spec** with exactly the edits in design §10. Each edited section gets `(changed 2026-10-17, see 2026-10-16-revamp-patches-split-design.md)`. Inside the edited sections, `@revamp/` becomes `@revamp-app/`.
- [ ] **Step 2: Update CLAUDE.md.**
  - The intro says the official patches are `xb00tt/revamp-patches`, added as the default source (`DEFAULT_SOURCE`).
  - Commands: drop the bundle build, release and integration-cache lines. Add `npm run publish:packages` (owner only, npm login, tags `v<version>`) and `npm run publish:packages -- --pack <dir>`, and say `test:integration` runs `sea` and `packages`.
  - The `--bundle` paragraph now says that without `--bundle` or a source there is no fallback.
  - Architecture: keep the sandbox, patch model, distribution and GUI sections. Rewrite "Bundle format" to one line. Move "Extensions" and "Fingerprinting rules" out (they go to revamp-patches' CLAUDE.md in Task 8), leaving one line: `The official bundle's own rules (extensions, fingerprinting on real releases) are in xb00tt/revamp-patches' CLAUDE.md.`
  - Distribution: publishing describes npm; the bundle release lives in revamp-patches.
  - Constraints: add `Published packages hold compiled JS: only scripts/publish-packages.ts compiles; nothing compiled is committed.`
- [ ] **Step 3: Update README.md.** "Develop" patches with `npm run revamp -- patch hydra` from the default source, or `--bundle <file>`. Add one paragraph: the official patches live in xb00tt/revamp-patches, and bundle authors install `@revamp-app/sdk`, `@revamp-app/engine` and `@revamp-app/cli` from npm.
- [ ] **Step 4: Verify.** `grep -n "bundles/official\|@revamp/" CLAUDE.md README.md` prints nothing. Commit with `docs: Revamp without the official bundle; npm packages; default source`.

### Task 6: Branch review and merge (owner go-ahead)

- [ ] **Step 1:** Run `npm run typecheck && npm test && npm run test:integration`. Expected: all pass.
- [ ] **Step 2:** Whole-branch review (subagent-driven: the final reviewer). Fix what it confirms.
- [ ] **Step 3 (owner go-ahead):** Push `split-patches` and open the PR. When the owner says so, merge it to main.

---

## Part B: Publish 0.3.0 (owner)

- [ ] **Step 1 (owner, by hand):** create an npm account if needed, create the free org `revamp-app` on npmjs.com, and run `npm login` in a terminal on this machine.
- [ ] **Step 2 (owner go-ahead):** from a clean checkout of main (use a fresh worktree, because `AGENTS.md` makes the main checkout dirty), run `npm run publish:packages`.
  - Expected: `Published @revamp-app/{sdk,engine,cli} 0.3.0 and pushed tag v0.3.0.`
  - `npm view @revamp-app/engine version` prints `0.3.0`.

---

## Part C: revamp-patches (`/home/borislav/github/revamp-patches`)

### Task 7: The repo from the bundle's files

**Files:** all new, in `/home/borislav/github/revamp-patches`.

**Interfaces:**
- Consumes: `@revamp-app/sdk@0.3.0`, `@revamp-app/engine@0.3.0` (`describe`, `runJob`, `memoryStore`, `patchApp`, `revampPaths`), `@revamp-app/cli@0.3.0` (`revamp` bin, `@revamp-app/cli/format`) from npm; the commit in `bundle-source-commit.txt` (Task 4 Step 1).
- Produces: `npm run build|test|typecheck|test:integration|release|revamp`; `dist/official.mjs` with manifest version `0.4.1`.

- [ ] **Step 1: Copy the files, with fresh history**

```bash
SRC=$(cat /home/borislav/.config/Claude/side-session-notes/local_49365169-927f-4ffb-bab6-fc6055b1d4a5/bundle-source-commit.txt)
R=/home/borislav/github/revamp; P=/home/borislav/github/revamp-patches
mkdir "$P" && cd "$P" && git init -q -b main
git config user.name xb00tt && git config user.email borislav.bg@gmail.com
git -C "$R" archive "$SRC" bundles/official/src bundles/official/scripts bundles/official/test bundles/official/CHANGELOG.md | tar -x --strip-components=2
mkdir -p test/integration
for t in hydra heroic hydra-mismatch; do git -C "$R" show "$SRC:test/integration/$t.test.ts" > test/integration/$t.test.ts; done
git -C "$R" show "$SRC:LICENSE" > LICENSE; git -C "$R" show "$SRC:.npmrc" > .npmrc
printf 'dist/\nnode_modules/\n' > .gitignore
```

- [ ] **Step 2: Fix the paths that pointed into Revamp**

```bash
sed -i 's#fileURLToPath(new URL(`../../../packages/sdk/src/shims/${name}.ts`, import.meta.url))#fileURLToPath(import.meta.resolve(`@revamp-app/sdk/shims/${name}`))#' scripts/extension.ts
sed -i 's#"../../../packages/cli/src/format.ts"#"@revamp-app/cli/format"#' test/patches.test.ts
sed -i 's#"../../packages/cli/src/format.ts"#"@revamp-app/cli/format"#' test/integration/hydra-mismatch.test.ts
sed -i 's#"../../bundles/official/dist/official.mjs"#"../../dist/official.mjs"#' test/integration/*.test.ts
sed -i 's#bundles/official/CHANGELOG.md#CHANGELOG.md#' test/metadata.test.ts
sed -i 's#const root = here("../../");#const root = here("");#; s#\["run", "build", "-w", "@revamp-app/bundle-official"\]#["run", "build"]#; s#bundles/official/src/index.ts#src/index.ts#' scripts/release.ts
sed -i 's#"extends": "../../../../../tsconfig.json"#"extends": "../../../tsconfig.json"#' src/hydra/extension/tsconfig.json
grep -rn "packages/\|bundles/official\|npm run build -w" src scripts test
```

Expected: the final grep prints nothing. Then fix the comments that still name `-w @revamp-app/bundle-official` (the headers of `scripts/build.ts` and `scripts/release.ts`): they become `npm run build` and `npm run release`.

- [ ] **Step 3: Write `package.json` and `tsconfig.json`.**
  - `package.json`: `{ "name": "revamp-patches", "private": true, "type": "module", "license": "GPL-3.0-only", "engines": { "node": ">=26" } }`, with these scripts:
    - `build`: `node scripts/build.ts`
    - `release`: `node scripts/release.ts`
    - `test`: `node --test "test/*.test.ts"`
    - `test:integration`: `npm run build && REVAMP_INTEGRATION=1 node --test "test/integration/*.test.ts"`
    - `typecheck`: `tsc -p . && tsc -p src/hydra/extension`
    - `revamp`: `revamp`
  - `tsconfig.json`: Revamp's root `compilerOptions`, copied unchanged, with `"include": ["src", "scripts", "test"]` and `"exclude": ["src/hydra/extension"]`.
  - Then install:

```bash
npm install -D -E @revamp-app/sdk@0.3.0 @revamp-app/engine@0.3.0 @revamp-app/cli@0.3.0
npm install -D esbuild@^0.28.2 react@18.3.1 react-test-renderer@18.3.1 @types/react@18.3.26 @types/node@^26.6.5 typescript@^7.0.2 @electron/asar@^4.3.1
```

- [ ] **Step 4: Version 0.4.1 and the new source.**
  - `src/index.ts`: `version: "0.4.1"` and `source: "github:xb00tt/revamp-patches"`.
  - `CHANGELOG.md` gets a new top section:

```markdown
## 0.4.1

- The official patches moved to their own repo, xb00tt/revamp-patches, which Revamp 0.3.0 adds as its default source. The patches are the same as in 0.4.0.
```

  - In `test/metadata.test.ts`, the expected `download_url` becomes `https://github.com/xb00tt/revamp-patches/releases/download/bundle-v…/official.mjs`, and any `xb00tt/revamp` source in that test becomes `xb00tt/revamp-patches`.

- [ ] **Step 5: Verify.**
  - `npm run typecheck && npm test`: expected 99 pass.
  - `npm run build`: expected `dist/official.mjs, patches.json and bundle.json written (bundle 0.4.1, Hydra extension: 28.1 kB)`.
  - `npm run test:integration`: expected 4 pass. It uses `~/.cache/revamp/releases`, so quit nothing; the mismatch test calls api.github.com unauthenticated, and a 403 means wait and rerun.
  - `HOME=/tmp/rp-x XDG_CACHE_HOME="$HOME/.cache" npm run revamp -- patch hydra --dry-run --bundle dist/official.mjs`: expected `Hydra 4.1.6: 7/7 patches apply (dry run, nothing installed)`.

- [ ] **Step 6: Commit.** `git add -A` (`.gitignore` keeps `dist/` and `node_modules/` out), then commit with `feat: the official Revamp patches, moved from xb00tt/revamp@<SRC>` followed by a body line: `Fresh history: see xb00tt/revamp for the history of bundles/official before this commit.` Use the attribution trailer.

### Task 8: CI, CLAUDE.md, README

**Files:** `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md` in revamp-patches.

- [ ] **Step 1: Write `ci.yml`.** Take Revamp's workflow from `$SRC` (`git -C $R show $SRC:.github/workflows/ci.yml`) and change:
  - `npm run build -w @revamp/bundle-official` becomes `npm run build`;
  - `bundles/official/dist/patches.json` becomes `dist/patches.json`;
  - the dry-run command becomes `npx revamp patch ${{ matrix.app }} --version ${{ matrix.version }} --dry-run --bundle dist/official.mjs ${{ matrix.experimental && '--force' || '' }}`.
  - The header comment keeps its spec reference and says it runs on the pinned `@revamp-app` packages.
- [ ] **Step 2: Write `CLAUDE.md`.**
  - What this repo is: the official bundle for Revamp (xb00tt/revamp), its default source.
  - Commands: the npm scripts above, plus `npm run revamp -- patches hydra --bundle dist/official.mjs`.
  - Taking a new engine: `npm install -D -E @revamp-app/{sdk,engine,cli}@<v>`, raise `minEngine` only when a patch needs the new engine, then commit.
  - Trying an unpublished one: `npm install --no-save ../revamp/packages/{sdk,engine,cli}`, then `npm ci` to go back.
  - Release: clean tree, pushed, a `## <version>` CHANGELOG section, `npm run release`, then push.
  - Copy over Revamp's CLAUDE.md sections "Extensions (spec §6, M3)" and "Fingerprinting rules learned on real releases" (taken from `$SRC`), with their paths changed from `bundles/official/` to the repo root.
  - Copy the still-true constraints from Revamp's CLAUDE.md: Node 26, erasable TS, no network in unit tests, never touch `/opt/Hydra`, `/opt/Heroic` or port 3000, inspecting real builds with `dpkg-deb` and `extractFile`, never evaluating app code, fixtures as trimmed real excerpts, and the git identity in `.git/config`.
  - Point to Revamp's specs (`2026-10-14-revamp-v1-design.md` §5, §6, §10 and `2026-10-16-more-like-this-rows-design.md`) as the patch model's source of truth.
- [ ] **Step 3: Write `README.md`.** What it is, `revamp sources add xb00tt/revamp-patches` for users who removed the default, the patches table from v1 spec §10 (names and apps), how to develop (Node 26, `npm ci`, `npm test`, `npm run build`), and GPL-3.0-only.
- [ ] **Step 4: Verify and commit.**
  - `npm ci && npm run typecheck && npm test`: expected 99 pass.
  - `node -e 'const y=require("fs").readFileSync(".github/workflows/ci.yml","utf8"); if(/bundles\/|-w @revamp/.test(y)) process.exit(1)'`: expected exit 0.
  - Commit with `docs: CLAUDE.md, README and CI for the official patches repo`.

---

## Part D: Publish and switch (each step needs the owner's go-ahead)

- [ ] **Step 1: The repo.** `gh repo create xb00tt/revamp-patches --public --source /home/borislav/github/revamp-patches --push`. Then watch the Actions run: the `test` job and dry-runs `hydra 4.1.6` and `heroic 2.22.3` pass.
- [ ] **Step 2: The release.** In `/home/borislav/github/revamp-patches`, run `npm run release`, then `git push`.
  - Expected: release `bundle-v0.4.1` with `official.mjs` and `patches.json`, and the root `bundle.json` committed with `"version": "0.4.1"`.
  - `curl -s https://raw.githubusercontent.com/xb00tt/revamp-patches/HEAD/bundle.json` shows it.
- [ ] **Step 3: A fresh home seeds the default.** `HOME=$(mktemp -d) npx --prefix /home/borislav/github/revamp-patches revamp sources list`. Expected: stderr says `Added the default source xb00tt/revamp-patches: "Revamp official" 0.4.1 (sha256 …)`, and the list shows it.
- [ ] **Step 4: The owner's machine (design §8).**
  - Quit Hydra.
  - In Revamp's main: `git pull`, then `npm run install:cli`.
  - `revamp sources remove xb00tt/revamp`
  - `revamp sources add xb00tt/revamp-patches` (confirm)
  - `revamp check`, then `revamp update --yes`.
  - Expected: `revamp list` shows Hydra 4.1.6 and Heroic 2.22.3 patched from "Revamp official" 0.4.1, and `revamp sources list` shows only `xb00tt/revamp-patches`.
- [ ] **Step 5: Cleanup in Revamp.**
  - On a fresh branch from main, `git rm bundle.json`. Commit with `chore: Revamp no longer publishes a bundle (it moved to xb00tt/revamp-patches)`, then PR and merge.
  - `gh issue transfer 2 xb00tt/revamp-patches --repo xb00tt/revamp`.
  - Update the memory note `revamp-installed-on-owner-machine.md`: the source is now `xb00tt/revamp-patches`, the packages are on npm as `@revamp-app/*` 0.3.0, and bundle releases run from `/home/borislav/github/revamp-patches`.

## Models for subagents

The owner asked on 2026-10-17 (execution start) to use the token allowance fully, so the cheapest-model rule is set aside for this plan:
- Task 1: sonnet. The rename is scripted, and the edits are listed.
- Every other implementer, every reviewer and the final whole-branch review: the session model (Fable 5.1), with two independent reviewers per task (spec compliance, code quality).
