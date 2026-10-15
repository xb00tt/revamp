# Revamp M4 (distribution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp runs without the repo. A single `revamp` binary in `~/.local/bin` gets its patches from pinned bundle sources, checks daily for new app releases and says whether the patches still apply, and installs the update when the owner says so. CI dry-runs every patch against the real releases on every push.

**In plain words, what M4 adds:**
- **Published bundles.** The bundle build also writes `patches.json` (what the bundle contains) and `bundle.json` (version, notes, download link, SHA-256). A release script puts the bundle on a GitHub release and commits `bundle.json`, which is where other machines find it.
- **Sources.** `revamp sources add xb00tt/revamp` downloads that bundle, checks its hash, shows what it contains, and remembers the hash once you say yes. From then on `revamp patch hydra` needs no `--bundle` and no repo.
- **Check and update.** `revamp check` looks for a newer Hydra or Heroic on GitHub and tries the patches on it without installing ("Hydra 4.1.7 out, 6/6 patches apply"). `revamp update` installs it with your saved choices. `revamp timer enable` runs the check daily and shows a desktop notification.
- **One binary.** `npm run install:cli` builds `revamp` as a Node single executable and links `~/.local/bin/revamp` to it. The same binary also runs as its own sandbox.
- **CI.** Every push runs the unit tests, then tries every bundled app version against its real release.

**Architecture:**
- **Bundle (`bundles/official`):** `scripts/metadata.ts` builds `bundle.json`; `scripts/build.ts` adds `patches.json` (the sandboxed `describe`) and `bundle.json` to `dist/`; `scripts/release.ts` publishes; `CHANGELOG.md` holds the notes per version.
- **Engine:**
  - `sandbox.ts` spawns the SEA as its own runner (`--sandbox-runner`) with the permission flags quoted in `--node-options`; `runner.ts` loads bundles with `createRequire(bundle)(bundle)` and refuses to run without the permission model.
  - `bundle-sources.ts`: fetch, verify, cache, describe and pin sources; refresh GitHub pins; choose an app's bundle.
  - `updates.ts`: `checkUpdates`, `checkMessage`, `updateApp`, `latestRelease`; `api.ts` gains `patchCounts` and exports `findApp`.
- **CLI:** `sea.ts` (SEA entry), `scripts/build-sea.ts`, `scripts/install.ts`, `timer.ts`; `main.ts` gains `sources`, `check`, `update`, `timer` and takes bundles from sources; `format.ts` gains the source views and `printable()`.
- **CI:** `.github/workflows/ci.yml`.

**Tech Stack:** unchanged (Node 26.12, TypeScript by type stripping, acorn, xz-decompress, esbuild). New tools used, not added as dependencies: `node --build-sea`, `systemctl --user`, `notify-send`, `gh` (release script only), GitHub Actions (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4`).

**Spec:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`. This plan implements §7.1–7.4, the M4 rows of §8 and §4.5, the SEA half of §3.3 and §4.4, and §13 M4. The M1–M3 plans in `docs/superpowers/plans/` describe the code it builds on.

**Validated before hand-off.** Every code block in this plan was extracted into a fresh clone of `main` (`d41c02c`), applied task by task, and run on Node 26.12.0 with TypeScript 7.0.2:
- Each task's "verify it fails" step failed as described, and each "verify it passes" step passed with the stated count: 200, 202, 208, 210, 214, 217, 217 and 217 unit tests after Tasks 1–8. Both `tsc` projects were clean after every task.
- Each task's commit left a clean tree, and the final tree is identical to the build the plan was written from.
- The SEA (about 150 MB, built in about 3 s) ran from a temp dir with spaces in its path: it listed Hydra's patches, its sandbox denied a bundle reading `/etc/hostname`, it refused to run without a source, and it dry-ran the real Hydra 4.1.6 from a file source with 6/6 patches applying (about 25 s).
- `npm run test:integration`: 4/4 against the real cached releases in about 80 s (Heroic 2.22.3, Hydra 4.0.6 forced, Hydra 4.1.6, the SEA).
- The CI matrix command and the exact CI dry-run command for Heroic 2.22.3 ran locally (exit 0, 3/3 patches apply).
- **Not validated here, because each one publishes or changes the owner's machine:** the GitHub Actions run itself, `npm run release` past its guards, `npm run install:cli`, `revamp sources add xb00tt/revamp` (needs the public repo and a published `bundle.json`), and the systemd timer with `notify-send`. These are the owner's checks in Task 8, step 6.

Executors should transcribe the code, not redesign it. A failure most likely means a typo, a wrong Node version, or a step applied out of order.

**Decisions (the owner's two, then the planner's rulings):**
1. **The repo goes public** (owner, 2026-10-15). GitHub sources and release downloads need no token, so M4 has no token handling. Until the repo is public, `revamp sources add <file.mjs>` works offline.
2. **Publishing is a local script** (owner, 2026-10-15): `npm run release -w @revamp/bundle-official` creates the GitHub release `bundle-v<version>` with `official.mjs` and `patches.json`, then commits the root `bundle.json` that points at it; the owner pushes. It is named `release`, not `publish`, because npm treats a `publish` script as a hook of `npm publish`.
3. **Only GitHub sources move their pin** (§7.2: "Url and file sources pin an exact hash"). Refreshing a GitHub source moves the pin when its `bundle.json` has a new version, after verifying the new bundle against that `bundle.json`. URL and file sources keep the hash the user confirmed; to trust a changed file, remove and add it again.
4. **`update` asks GitHub afresh** instead of reading `last-check.json`, so it installs the newest release even if the last check is a day old. The selection is the saved one, as §7.3 says.
5. **`check` dry-runs releases the bundle doesn't list, too** (forced and labeled untested), so the notification can say "Hydra 4.1.7 out, not yet in your bundles (untested: 5/6 patches apply)". Installing one still needs `revamp update --force`.
6. **The job still goes to the sandbox child on stdin.** §4.4 says a job file; M1 chose stdin and the SEA changes nothing about that.
7. **Running from the repo keeps working.** With no `--bundle` and no source for the app, the CLI run from source uses `bundles/official/dist/official.mjs` as before. The SEA has no such fallback and says to add a source.
8. **The runner refuses to run without the permission model.** The SEA is its own sandbox runner, so `revamp --sandbox-runner` typed by hand would otherwise run bundle code unconfined.
9. **Bundle text can't rewrite the screen.** Everything the CLI prints goes through `printable()`, which shows control characters as `\xNN`. Without it a bundle's name or notes could clear the line and fake the trust prompt (found by a security review while this plan was built).
10. **The timer runs the installed binary.** `revamp timer enable` only works from the SEA, and its service runs that binary's path (`~/.local/share/revamp/bin/revamp`, which `~/.local/bin/revamp` links to).

**Deliberately not in this plan:** the GUI (M5); private repos and tokens; updating the `revamp` binary itself (rebuild with `npm run install:cli`); a `bundle.json` signature beyond the pinned hash (§14: the source is the trust anchor).

**Model per task** (cheapest adequate): implementers `sonnet` / `medium`, because every task's code is given and was run. Reviewers `opus` / `high` for Task 2 (the sandbox inside the SEA) and Task 3 (what gets trusted and pinned), `sonnet` / `medium` for the rest. The final whole-branch review is `opus` / `high`.

## Global Constraints

- **Node:** Node ≥ 26 at `~/.local/node-26` (v26.12.0). Every shell command assumes `export PATH="$HOME/.local/node-26/bin:$PATH"` first; the system `node` is 24 and has no `--build-sea`.
- **TypeScript runs natively:** erasable syntax only (no `enum`, `namespace`, parameter properties, `import x = require()`); `import type`; `.ts` in relative imports.
- **Dependencies:** none added. Runtime stays `acorn` + `xz-decompress` (its WASM is embedded as a base64 data URL, so it works inside the SEA). No native addons.
- **Versions:** `ENGINE_VERSION` stays `"0.2.0"` and the bundle manifest stays `"0.3.0"` (M4 changes no patch). The first published bundle is 0.3.0.
- **Paths (§4.5):** `~/.config/revamp/sources.json`, `~/.cache/revamp/bundles/<sha256>.mjs`, `~/.local/state/revamp/last-check.json`, `~/.config/systemd/user/revamp-check.{service,timer}`, `~/.local/share/revamp/bin/revamp` with the symlink `~/.local/bin/revamp`. All derive from `revampPaths()` (XDG variables honored).
- **Timer (§7.3):** `OnCalendar=daily`, `Persistent=true`, `RandomizedDelaySec=1h`; the service runs `check --notify`.
- **SEA config:** `{ main, output, disableExperimentalSEAWarning: true, execArgvExtension: "cli" }`, built with `node --build-sea`. The binary is about 150 MB.
- **Tests:** `node:test` + `node:assert/strict`. Unit tests never touch the network, the real home or port 3000: temp dirs, local HTTP servers on port 0. `npm test` and `npm run typecheck` stay clean after every task.
- **Never run `npm run release`, `revamp timer enable` or `npm run install:cli` while implementing.** They publish to GitHub or change the owner's machine; they are the owner's steps in Task 8.
- **Port 3000** is a production server on this machine: never listen on or connect to it. Never read or modify `/opt/Hydra` or `/opt/Heroic`.
- **Commits:** conventional (`feat:`, `fix:`, `test:`, `docs:`, `ci:`), ending with a blank line and a `Co-Authored-By: Claude …` trailer.

## Review Focus

Inputs the spec implies that ordinary feature tests would miss. Each names the expected behavior and the task that pins it:

1. **A bundle reaching outside its job inside the SEA** (the timer's real environment) must fail the job with Node's permission error. Pinned in Task 2's SEA integration test, from a temp dir with spaces in every path.
2. **A `bundle.json` that doesn't match its bundle** (wrong SHA-256, another name or version, a plain-http URL) must be refused before anything is saved. Pinned in Task 3.
3. **A file source edited after it was added** must be refused, not re-pinned silently, even when the cache was cleared. Pinned in Task 3.
4. **Bundle text with terminal control sequences** must print escaped, so the trust prompt shows what will really be pinned. Pinned in Task 4.
5. **GitHub unreachable or answering oddly during a check** must keep every pin, report per app, and install nothing. Pinned in Tasks 3 (refresh failure) and 5 (a tag that doesn't fit the app's template; a newer release only dry-runs).

## File Structure

```
.github/workflows/ci.yml                 unit tests, then a dry run per app version (cache per app+version)
package.json                             + install:cli
tsconfig.json                            includes packages/*/scripts
CLAUDE.md                                commands and the distribution architecture
bundles/official/
  CHANGELOG.md                           ## <version> notes → bundle.json changelog
  package.json                           + release
  scripts/metadata.ts                    bundleJson(), changelogFor()
  scripts/build.ts                       + dist/patches.json and dist/bundle.json
  scripts/release.ts                     gh release bundle-v<version>, commit root bundle.json
  test/metadata.test.ts
packages/engine/
  package.json                           exports "./runner"
  src/sandbox.ts                         SEA spawn: --node-options + --sandbox-runner; nodeOptions()
  src/runner.ts                          createRequire(bundle); refuses without --permission
  src/bundle-sources.ts                  sources: prepare, add, remove, refresh, bundleForApp
  src/updates.ts                         checkUpdates, checkMessage, updateApp, latestRelease
  src/api.ts                             + patchCounts, export findApp
  src/index.ts                           exports the above
  test/bundle-sources.test.ts  test/updates.test.ts  test/sandbox.test.ts  test/helpers/demo.ts (version option)
packages/cli/
  package.json                           build: the SEA
  scripts/build-sea.ts  scripts/install.ts
  src/sea.ts                             SEA entry: CLI, or the runner with --sandbox-runner
  src/main.ts                            sources, check, update, timer; bundles from sources; print via printable()
  src/format.ts                          formatSourceCandidate, formatSources, printable; header via patchCounts
  src/timer.ts                           systemd user units, enable/disable
  test/cli.test.ts  test/timer.test.ts
test/integration/sea.test.ts             builds the SEA and runs it outside the repo
```

---

### Task 1: The bundle build writes `patches.json` and `bundle.json`

**Model:** `sonnet` / `medium`

**Files:**
- Create: `bundles/official/scripts/metadata.ts`, `bundles/official/CHANGELOG.md`
- Modify: `bundles/official/scripts/build.ts` (whole file)
- Test: `bundles/official/test/metadata.test.ts`

**Interfaces:**
- Consumes: `describe(bundlePath)` from `@revamp/engine` (M1: runs the bundle in the sandbox and returns `BundleDescription`); `Manifest` from `@revamp/sdk` (`source` is `"github:xb00tt/revamp"`).
- Produces:
  - `interface BundleJson { name; version; minEngine; created_at; changelog; download_url; sha256 }` (all strings), the §7.1 format.
  - `changelogFor(markdown: string, version: string): string`: the text under `## <version>`, trimmed, or `""`.
  - `bundleJson(manifest: Manifest, sha256: string, changelog: string, now?: Date): BundleJson`. `download_url` is `https://github.com/<owner>/<repo>/releases/download/bundle-v<version>/official.mjs`, from `manifest.source`; any other `source` throws.
  - `npm run build -w @revamp/bundle-official` now writes `dist/official.mjs`, `dist/patches.json` (the sandboxed describe, pretty JSON) and `dist/bundle.json`, and prints `dist/official.mjs, patches.json and bundle.json written (bundle 0.3.0, Hydra extension: 22.0 kB)`. Task 7's CI reads `patches.json`; Task 8's release script reads `bundle.json`.

- [ ] **Step 1: Write the failing test**

Create `bundles/official/test/metadata.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundleJson, changelogFor } from "../scripts/metadata.ts";
import { manifest } from "../src/index.ts";

const md = "# Changelog\n\n## 0.4.0\n\n- New: thing.\n- Fixed: other.\n\n## 0.3.0\n\nOlder.\n";

test("changelogFor returns one version's notes, or nothing", () => {
  assert.equal(changelogFor(md, "0.4.0"), "- New: thing.\n- Fixed: other.");
  assert.equal(changelogFor(md, "0.3.0"), "Older.");
  assert.equal(changelogFor(md, "0.3"), "");
  assert.equal(changelogFor("# Changelog\n", "0.4.0"), "");
});

test("bundleJson points at the release asset of the manifest's GitHub source", () => {
  const sha = "a".repeat(64);
  assert.deepEqual(bundleJson(manifest, sha, "Notes.", new Date("2026-10-15T08:00:00Z")), {
    name: "Revamp official",
    version: manifest.version,
    minEngine: manifest.minEngine,
    created_at: "2026-10-15T08:00:00.000Z",
    changelog: "Notes.",
    download_url: `https://github.com/xb00tt/revamp/releases/download/bundle-v${manifest.version}/official.mjs`,
    sha256: sha,
  });
  assert.throws(() => bundleJson({ ...manifest, source: "https://example.com/x" }, sha, ""), /manifest\.source must be "github:<owner>\/<repo>"/);
});

test("CHANGELOG.md has notes for the bundle's version", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.notEqual(changelogFor(changelog, manifest.version), "", `add a "## ${manifest.version}" section to bundles/official/CHANGELOG.md`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test bundles/official/test/metadata.test.ts`
Expected: FAIL with `Cannot find module '…/bundles/official/scripts/metadata.ts'`.

- [ ] **Step 3: Implement**

Create `bundles/official/scripts/metadata.ts`:

```ts
// bundle.json: what a bundle source fetches to find, verify and describe a published bundle (spec §7.1).
import type { Manifest } from "@revamp/sdk";

export interface BundleJson {
  name: string;
  version: string;
  minEngine: string;
  created_at: string;
  changelog: string;
  download_url: string;
  sha256: string;
}

/** The notes under `## <version>` in a CHANGELOG.md, or "" when it has no such section. */
export function changelogFor(markdown: string, version: string): string {
  const section = markdown.split(/^## /m).slice(1).find((s) => s.slice(0, s.indexOf("\n")).trim() === version);
  return section ? section.slice(section.indexOf("\n") + 1).trim() : "";
}

/** The bundle is published as release `bundle-v<version>` of the repo in `manifest.source`. */
export function bundleJson(manifest: Manifest, sha256: string, changelog: string, now = new Date()): BundleJson {
  const repo = /^github:([\w.-]+\/[\w.-]+)$/.exec(manifest.source)?.[1];
  if (!repo) throw new Error(`manifest.source must be "github:<owner>/<repo>" (it is "${manifest.source}")`);
  return {
    name: manifest.name,
    version: manifest.version,
    minEngine: manifest.minEngine,
    created_at: now.toISOString(),
    changelog,
    download_url: `https://github.com/${repo}/releases/download/bundle-v${manifest.version}/official.mjs`,
    sha256,
  };
}
```

Create `bundles/official/CHANGELOG.md`:

```markdown
# Changelog

Each `## <version>` section becomes the `changelog` field of `bundle.json` when that version is published.

## 0.3.0

- Hydra 4.1.6: **More like this ranking**. The game page's "More like this" ranks games by shared Steam tags, shows the shared tags and an "Already in library" badge, and caches results for the session.

## 0.2.0

- Hydra 4.1.6: **Recently added sort**, and the Hydra locale strings the sorts need.
- Heroic 2.22.3: **Hide Deals link**.

## 0.1.0

- Hydra 4.1.6: **Disable self-update**, **Side-by-side identity** and **Recently downloaded sort**.
```

Replace the whole of `bundles/official/scripts/build.ts` with:

```ts
// npm run build -w @revamp/bundle-official: the extensions first, then the bundle with each one embedded as a string,
// then patches.json and bundle.json (spec §7.1).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe } from "@revamp/engine";
import { buildExtension } from "./extension.ts";
import { bundleJson, changelogFor } from "./metadata.ts";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const hydraExtension = await buildExtension(here("src/hydra/extension/index.tsx"));
const out = here("dist/official.mjs");
await build({
  entryPoints: [here("src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2024",
  outfile: out,
  define: { __REVAMP_HYDRA_EXTENSION__: JSON.stringify(hydraExtension) },
});
// describe runs the built bundle in the sandbox, like every engine read of a bundle.
const description = await describe(out);
writeFileSync(here("dist/patches.json"), json(description));
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
const changelog = changelogFor(readFileSync(here("CHANGELOG.md"), "utf8"), description.manifest.version);
writeFileSync(here("dist/bundle.json"), json(bundleJson(description.manifest, sha256, changelog)));
console.log(`dist/official.mjs, patches.json and bundle.json written (bundle ${description.manifest.version}, Hydra extension: ${(hydraExtension.length / 1024).toFixed(1)} kB)`);
```

- [ ] **Step 4: Run the tests and the build**

Run: `node --test bundles/official/test/metadata.test.ts && npm test && npm run typecheck && npm run build -w @revamp/bundle-official && node -e 'const b = require("./bundles/official/dist/bundle.json"), p = require("./bundles/official/dist/patches.json"); console.log(b.version, b.download_url, p.apps.map((a) => a.id).join(","), p.patches.length)'`
Expected: PASS. 3 metadata tests; `npm test` reports 200 tests, 0 failures; both `tsc` runs print nothing; the build prints `dist/official.mjs, patches.json and bundle.json written (bundle 0.3.0, Hydra extension: 22.0 kB)`; the last command prints `0.3.0 https://github.com/xb00tt/revamp/releases/download/bundle-v0.3.0/official.mjs hydra,heroic 7`.

- [ ] **Step 5: Commit**

```bash
git add bundles/official/scripts/metadata.ts bundles/official/scripts/build.ts bundles/official/CHANGELOG.md bundles/official/test/metadata.test.ts
git commit -m "feat(bundle): build writes patches.json and bundle.json

patches.json is the sandboxed describe of the built bundle. bundle.json
carries the version, the CHANGELOG.md notes for it, the sha256 and the
release asset URL derived from manifest.source.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The single executable and its sandbox

**Model:** `sonnet` / `medium`; reviewer `opus` / `high` (this is the sandbox the daily timer runs bundles in)

**Files:**
- Modify: `packages/engine/src/sandbox.ts` (whole file), `packages/engine/src/runner.ts`, `packages/engine/package.json` (export `./runner`)
- Create: `packages/cli/src/sea.ts`, `packages/cli/scripts/build-sea.ts`, `packages/cli/scripts/install.ts`
- Modify: `packages/cli/src/main.ts` (the repo default becomes a function), `packages/cli/package.json` (`build`), `package.json` (`install:cli`), `tsconfig.json` (include `packages/*/scripts`)
- Test: `packages/engine/test/sandbox.test.ts`, `test/integration/sea.test.ts`

**Interfaces:**
- Consumes: `runSandboxed(job, access, { entry?, timeoutMs? })` (M1). The runner reads the job on stdin and writes JSON to stdout.
- Produces:
  - `nodeOptions(flags: string[]): string`, exported from `sandbox.ts`: flags joined by spaces, each `=value` wrapped in double quotes with `\` and `"` escaped (NODE_OPTIONS syntax, which `--node-options` shares).
  - In a SEA (`isSea()` from `node:sea`), `runSandboxed` spawns `process.execPath` with `["--node-options=--permission --allow-fs-read=\"…\" … --allow-fs-write=\"…\"", "--sandbox-runner"]`. No repo read access, and `entry` is ignored. Dev mode is unchanged.
  - `@revamp/engine/runner` (package export) is `runner.ts`. It loads bundles with `createRequire(path)(path)` and exits 1 with `the sandbox runner only runs under Node's permission model` when `process.permission` is missing.
  - `packages/cli/src/sea.ts`: `revamp --sandbox-runner` loads the runner, and anything else loads `main.ts`.
  - `npm run build -w @revamp/cli` writes `packages/cli/dist/revamp` (and `revamp.cjs`, `sea.json`) in about 3 s. `npm run install:cli` builds, then installs `~/.local/share/revamp/bin/revamp` and the symlink `~/.local/bin/revamp`. Task 6's timer runs that binary.

**Why `--node-options`:** a SEA ignores Node flags in its argv (§3.3), so the permission flags only reach the child through `--node-options`, which `execArgvExtension: "cli"` enables. Values are quoted because real paths can contain spaces. The SEA test runs from a temp dir named `revamp sea …` to prove this.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/test/sandbox.test.ts`, replace:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
```

with:

```ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
```

In `packages/engine/test/sandbox.test.ts`, replace:

```ts
import { runSandboxed, SandboxError } from "../src/sandbox.ts";
```

with:

```ts
import { nodeOptions, runSandboxed, SandboxError } from "../src/sandbox.ts";
```

Append to `packages/engine/test/sandbox.test.ts`:

```ts

test("nodeOptions quotes values so Node reads them back unchanged", () => {
  const value = 'C:\\a b/"c"';
  assert.equal(nodeOptions(["--permission", `--title=${value}`]), '--permission --title="C:\\\\a b/\\"c\\""');
  const r = spawnSync(process.execPath, ["-p", "process.title"], { encoding: "utf8", env: { NODE_OPTIONS: nodeOptions([`--title=${value}`]) } });
  assert.equal(r.stdout.trim(), value, r.stderr);
});

test("the runner refuses to run outside the permission model", () => {
  const runner = fileURLToPath(new URL("../src/runner.ts", import.meta.url));
  const r = spawnSync(process.execPath, [runner], { input: "{}", encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "the sandbox runner only runs under Node's permission model");
});
```

Create `test/integration/sea.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { revampPaths } from "@revamp/engine";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const SEA = fileURLToPath(new URL("../../packages/cli/dist/revamp", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "the SEA runs the CLI and its sandbox outside the repo",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    execFileSync("npm", ["run", "build", "-w", "@revamp/cli"], { stdio: "ignore" });
    // A space in every path checks the --node-options quoting; the cwd is outside the repo, like the timer's.
    const dir = mkdtempSync(join(tmpdir(), "revamp sea "));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const bundle = join(dir, "official bundle.mjs");
    copyFileSync(BUNDLE, bundle);
    const env = { PATH: process.env.PATH, HOME: join(dir, "home"), XDG_CACHE_HOME: join(revampPaths().cache, "..") };
    const revamp = (...args: string[]) => spawnSync(SEA, args, { cwd: dir, env, encoding: "utf8" });

    const listing = revamp("patches", "hydra", "--bundle", bundle);
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /^Hydra 4\.1\.6, from bundle "Revamp official"/);

    // The bundle runs in the SEA's sandbox: reading a file it wasn't given fails the job.
    const evil = join(dir, "evil.mjs");
    writeFileSync(evil, 'process.getBuiltinModule("node:fs").readFileSync("/etc/hostname");\nexport const manifest = {}, apps = [], patches = [];\n');
    const denied = revamp("patches", "hydra", "--bundle", evil);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Access to this API has been restricted/);

    const dryRun = revamp("patch", "hydra", "--dry-run", "--bundle", bundle);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /^Hydra 4\.1\.6: 6\/6 patches apply \(dry run, nothing installed\)$/m);
  },
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/engine/test/sandbox.test.ts`
Expected: FAIL with `SyntaxError: The requested module '../src/sandbox.ts' does not provide an export named 'nodeOptions'`.

- [ ] **Step 3: Implement**

Replace the whole of `packages/engine/src/sandbox.ts` with:

```ts
import { spawn } from "node:child_process";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 180_000;

export class SandboxError extends Error {}

export interface SandboxAccess {
  read: string[];
  write: string[];
}

/** Flags in NODE_OPTIONS syntax, which `--node-options` shares: each value in double quotes, backslashes and quotes escaped. */
export function nodeOptions(flags: string[]): string {
  return flags
    .map((flag) => {
      const eq = flag.indexOf("=");
      return eq < 0 ? flag : `${flag.slice(0, eq + 1)}"${flag.slice(eq + 1).replace(/[\\"]/g, "\\$&")}"`;
    })
    .join(" ");
}

function childArgs(access: SandboxAccess, entry: string | undefined): string[] {
  const writes = access.write.map((p) => `--allow-fs-write=${p}`);
  // A SEA ignores Node flags in argv, so they go in --node-options, and the binary itself is the runner (spec §4.4).
  if (isSea()) {
    const flags = ["--permission", ...access.read.map((p) => `--allow-fs-read=${p}`), ...writes];
    return [`--node-options=${nodeOptions(flags)}`, "--sandbox-runner"];
  }
  // Dev mode runs this repo's TypeScript in the child, so it may read the repo (sources and node_modules).
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const runner = entry ?? fileURLToPath(new URL("./runner.ts", import.meta.url));
  return ["--permission", ...[repo, ...access.read].map((p) => `--allow-fs-read=${p}`), ...writes, runner];
}

/**
 * Runs `entry` (default: the bundle runner; a SEA always runs itself as the runner) in a child Node process under
 * the permission model. Reads are limited to access.read (plus the repo in dev mode) and writes to access.write.
 * There is no network, no child processes, workers, addons or WASI, and the environment holds only PATH.
 * The job goes in on stdin; the child's stdout must be JSON.
 */
export function runSandboxed<T>(job: unknown, access: SandboxAccess, o: { entry?: string; timeoutMs?: number } = {}): Promise<T> {
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = childArgs(access, o.entry);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", REVAMP_SANDBOX: "1" },
      timeout,
      killSignal: "SIGKILL",
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.stdin.on("error", () => {}); // the child may exit before reading all of stdin
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const stderr = Buffer.concat(err).toString().trim();
      if (signal) {
        return reject(new SandboxError(`the sandboxed run timed out or was killed (${signal}, limit ${timeout} ms)${stderr ? `: ${stderr}` : ""}`));
      }
      if (code !== 0) return reject(new SandboxError(stderr || `the sandboxed run failed with exit code ${code}`));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString()) as T);
      } catch {
        reject(new SandboxError(`the sandboxed run returned invalid output${stderr ? `: ${stderr}` : ""}`));
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}
```

In `packages/engine/src/runner.ts`, replace:

```ts
  const mod = createRequire(import.meta.url)(path);
```

with:

```ts
  const mod = createRequire(path)(path);
```

In `packages/engine/src/runner.ts`, replace:

```ts
async function main(): Promise<string> {
```

with:

```ts
async function main(): Promise<string> {
  // The SEA runs itself as the runner, so `revamp --sandbox-runner` must not run bundle code unconfined.
  if (!process.permission) throw new Error("the sandbox runner only runs under Node's permission model");
```

In `packages/engine/package.json`, replace:

```json
    ".": "./src/index.ts"
```

with:

```json
    ".": "./src/index.ts",
    "./runner": "./src/runner.ts"
```

Create `packages/cli/src/sea.ts`:

```ts
// The SEA's entry point (spec §4.4): the same binary is the CLI and, run with --sandbox-runner, the sandbox child.
if (process.argv[2] === "--sandbox-runner") void import("@revamp/engine/runner");
else void import("./main.ts");
```

Create `packages/cli/scripts/build-sea.ts`:

```ts
// npm run build -w @revamp/cli: esbuild packs the CLI and the sandbox runner into one CommonJS file, and
// `node --build-sea` turns that into the single executable dist/revamp (spec §3.3, §4.4).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

await build({
  entryPoints: [here("src/sea.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node26",
  outfile: here("dist/revamp.cjs"),
  // import.meta.url only feeds the dev-mode paths (the repo's runner.ts and bundle build), which a SEA never takes.
  logOverride: { "empty-import-meta": "silent" },
});
const config = { main: here("dist/revamp.cjs"), output: here("dist/revamp"), disableExperimentalSEAWarning: true, execArgvExtension: "cli" };
writeFileSync(here("dist/sea.json"), JSON.stringify(config, null, 2));
execFileSync(process.execPath, ["--build-sea", here("dist/sea.json")], { stdio: ["ignore", "ignore", "inherit"] });
console.log("dist/revamp written");
```

Create `packages/cli/scripts/install.ts`:

```ts
// npm run install:cli: installs dist/revamp as ~/.local/share/revamp/bin/revamp and points ~/.local/bin/revamp at it (spec §4.5).
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { revampPaths } from "@revamp/engine";

const bin = join(revampPaths().data, "bin", "revamp");
const link = join(process.env.HOME || homedir(), ".local/bin/revamp");

// Each file is written beside its target and renamed over it, so a running `revamp check` keeps its old binary.
mkdirSync(dirname(bin), { recursive: true });
copyFileSync(fileURLToPath(new URL("../dist/revamp", import.meta.url)), `${bin}.new`);
chmodSync(`${bin}.new`, 0o755);
renameSync(`${bin}.new`, bin);
mkdirSync(dirname(link), { recursive: true });
rmSync(`${link}.new`, { force: true });
symlinkSync(bin, `${link}.new`);
renameSync(`${link}.new`, link);
console.log(`Installed ${bin}; ${link} points to it.`);
```

In `packages/cli/src/main.ts`, replace:

```ts
// M1 runs from the repo; M4 replaces this with bundle sources.
const DEFAULT_BUNDLE = fileURLToPath(new URL("../../../bundles/official/dist/official.mjs", import.meta.url));
```

with:

```ts
// Running from the repo, the bundle defaults to the repo build. A function, because a SEA has no import.meta.url.
const defaultBundle = () => fileURLToPath(new URL("../../../bundles/official/dist/official.mjs", import.meta.url));
```

In `packages/cli/src/main.ts`, replace:

```ts
        bundlePath: values.bundle ?? DEFAULT_BUNDLE,
```

with:

```ts
        bundlePath: values.bundle ?? defaultBundle(),
```

In `packages/cli/src/main.ts`, replace:

```ts
      console.log(formatPatchList(await listPatches(values.bundle ?? DEFAULT_BUNDLE, needApp(), values.version)));
```

with:

```ts
      console.log(formatPatchList(await listPatches(values.bundle ?? defaultBundle(), needApp(), values.version)));
```

In `packages/cli/package.json`, replace:

```json
  "license": "GPL-3.0-only",
  "dependencies"
```

with:

```json
  "license": "GPL-3.0-only",
  "scripts": {
    "build": "node scripts/build-sea.ts"
  },
  "dependencies"
```

In `package.json`, replace:

```json
    "revamp": "node packages/cli/src/main.ts"
```

with:

```json
    "revamp": "node packages/cli/src/main.ts",
    "install:cli": "npm run build -w @revamp/cli && node packages/cli/scripts/install.ts"
```

In `tsconfig.json`, replace:

```json
  "include": ["packages/*/src", "packages/*/test", "bundles/*/src", "bundles/*/scripts", "bundles/*/test", "test"],
```

with:

```json
  "include": ["packages/*/src", "packages/*/scripts", "packages/*/test", "bundles/*/src", "bundles/*/scripts", "bundles/*/test", "test"],
```

- [ ] **Step 4: Run the tests, then the SEA against the real Hydra release**

Run: `node --test packages/engine/test/sandbox.test.ts && npm test && npm run typecheck && npm run build -w @revamp/cli`
Expected: PASS. 8 sandbox tests; `npm test` reports 202 tests, 0 failures; both `tsc` runs print nothing; the SEA build prints `dist/revamp written`.

Run: `npm run build -w @revamp/bundle-official && REVAMP_INTEGRATION=1 node --test test/integration/sea.test.ts`
Expected: PASS, 1 test in about 25 s with Hydra 4.1.6 cached in `~/.cache/revamp/releases` (otherwise it downloads 149 MB first). It lists Hydra's patches with the SEA, sees the sandbox deny a bundle that reads `/etc/hostname`, and dry-runs Hydra 4.1.6 with all 6 patches applying.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/sandbox.ts packages/engine/src/runner.ts packages/engine/package.json packages/engine/test/sandbox.test.ts packages/cli/src/sea.ts packages/cli/src/main.ts packages/cli/scripts packages/cli/package.json package.json tsconfig.json test/integration/sea.test.ts
git commit -m "feat(cli): single executable build with its sandbox through --node-options

The SEA is the CLI and, with --sandbox-runner, its own sandbox child:
permission flags reach it quoted in --node-options. The runner loads
bundles with createRequire(bundle) and refuses to run without the
permission model. npm run install:cli puts it in ~/.local/bin.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bundle sources, pinned to SHA-256

**Model:** `sonnet` / `medium`; reviewer `opus` / `high` (this decides which code gets trusted)

**Files:**
- Create: `packages/engine/src/bundle-sources.ts`
- Modify: `packages/engine/src/index.ts` (exports), `packages/engine/test/helpers/demo.ts` (a `version` option)
- Test: `packages/engine/test/bundle-sources.test.ts`

**Interfaces:**
- Consumes: `describe` (M1, sandboxed); `downloadVerified` and `fileSha256` from `download.ts` (M1: `downloadVerified` keeps a cached file whose hash matches, else downloads to `.part` and renames only after the hash matches); `compareVersions` and `ENGINE_VERSION`; `Paths`.
- Produces (all exported from `@revamp/engine`):
  - `type SourceKind = "github" | "url" | "file"`; `sourceKind(location)`: `.mjs` → file, `http(s)://` → url, `owner/repo` → github, anything else throws `is not a bundle source`.
  - `interface BundleSource { location; kind; name; version; sha256; downloadUrl?; apps: string[] }`. `location` is absolute for files. `sha256` is the pin, and the bundle is cached as `<cache>/bundles/<sha256>.mjs`.
  - `interface SourceFetchOptions { fetch?; rawBaseUrl?; apiBaseUrl? }` (tests point the URLs at a local server).
  - `interface SourceCandidate { source; bundlePath; description: BundleDescription; changelog }`.
  - `prepareSource(paths, location, o?): Promise<SourceCandidate>`: fetch `bundle.json` (GitHub: `<raw>/<repo>/HEAD/bundle.json`, then `<api>/repos/<repo>/contents/bundle.json` with `accept: application/vnd.github.raw+json`), check it, download and verify the bundle into the cache, describe it in the sandbox, and check that the manifest name and version match `bundle.json` and that `minEngine` is met. File sources are copied into the cache and hashed. Nothing is saved.
  - `loadSources(paths)`, `addSource(paths, source)` (refuses duplicates), `removeSource(paths, location): BundleSource`; they keep `<config>/sources.json` as `{ "sources": [...] }`.
  - `refreshSources(paths, o?): Promise<string[]>`: GitHub sources whose `bundle.json` version changed are re-prepared and their pin moves (`example/bundles: "Demo bundle" 1.0.0 → 1.1.0` plus the changelog). A failure keeps the pin (`…: not refreshed, still using 1.1.0: <why>`).
  - `bundleForApp(paths, appId, o?): Promise<{ bundlePath; source; warnings } | undefined>`: the first source whose `apps` has the app, with a warning when several do. The cache is checked against the pin: re-downloaded from `downloadUrl`, or re-copied from a file source only while that file still has the pinned hash.
- Only `http://` on loopback (`127.0.0.1`, `localhost`, `[::1]`) is accepted besides `https://`, for the tests' local servers.

- [ ] **Step 1: Write the failing test**

In `packages/engine/test/helpers/demo.ts`, replace:

```ts
export function writeDemoBundle(path: string, o: { sha256: string; minEngine?: string; extra?: string }): void {
```

with:

```ts
export function writeDemoBundle(path: string, o: { sha256: string; minEngine?: string; extra?: string; version?: string }): void {
```

In `packages/engine/test/helpers/demo.ts`, replace:

```ts
export const manifest = { name: "Demo bundle", version: "1.0.0", minEngine:
```

with:

```ts
export const manifest = { name: "Demo bundle", version: "${o.version ?? "1.0.0"}", minEngine:
```

Create `packages/engine/test/bundle-sources.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSource, bundleForApp, loadSources, prepareSource, refreshSources, removeSource, sourceKind, type SourceFetchOptions } from "../src/bundle-sources.ts";
import { revampPaths } from "../src/paths.ts";
import { writeDemoBundle } from "./helpers/demo.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A fake GitHub: raw.githubusercontent.com under /raw, the API under /api, release downloads under /dl. */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "revamp-sources-"));
  const bundleBytes = (version: string) => {
    const file = join(root, `demo-${version}.mjs`);
    writeDemoBundle(file, { sha256: "a".repeat(64), version });
    return readFileSync(file);
  };
  const downloads = new Map<string, Buffer>();
  const state = { rawStatus: 200, apiStatus: 200, bundleJson: {} as Record<string, unknown>, requests: [] as string[] };
  const server = createServer((req, res) => {
    state.requests.push(req.url!);
    const send = (status: number, body: string | Buffer) => {
      res.statusCode = status;
      res.end(body);
    };
    if (req.url === "/raw/example/bundles/HEAD/bundle.json" || req.url === "/url/bundle.json") send(state.rawStatus, JSON.stringify(state.bundleJson));
    else if (req.url === "/api/repos/example/bundles/contents/bundle.json") {
      assert.equal(req.headers.accept, "application/vnd.github.raw+json");
      send(state.apiStatus, JSON.stringify(state.bundleJson));
    } else if (downloads.has(req.url!)) send(200, downloads.get(req.url!)!);
    else send(404, "");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  /** Publishes a version: its bytes at /dl/demo-<version>.mjs and a bundle.json pointing at them. */
  const publish = (version: string, changelog = "", bytes = bundleBytes(version)) => {
    downloads.set(`/dl/demo-${version}.mjs`, bytes);
    state.bundleJson = { name: "Demo bundle", version, minEngine: "0.1.0", created_at: "2026-10-15T00:00:00.000Z", changelog, download_url: `${base}/dl/demo-${version}.mjs`, sha256: sha(bytes) };
    return sha(bytes);
  };
  const paths = revampPaths({ HOME: join(root, "home") });
  const o: SourceFetchOptions = { rawBaseUrl: `${base}/raw`, apiBaseUrl: `${base}/api` };
  return { root, base, paths, o, state, publish, bundleBytes, close: () => server.close() };
}

test("sourceKind tells repos, bundle.json URLs and files apart", () => {
  assert.equal(sourceKind("xb00tt/revamp"), "github");
  assert.equal(sourceKind("https://example.com/bundle.json"), "url");
  assert.equal(sourceKind("./dist/official.mjs"), "file");
  assert.equal(sourceKind("/abs/official.mjs"), "file");
  for (const bad of ["revamp", "../x", "a/b/c", "a/.."]) assert.throws(() => sourceKind(bad), /is not a bundle source/, bad);
});

test("a GitHub source is fetched from the default branch, verified, described and pinned", async (t) => {
  const s = await setup();
  t.after(s.close);
  const pin = s.publish("1.0.0", "First.");
  const c = await prepareSource(s.paths, "example/bundles", s.o);
  assert.deepEqual(c.source, {
    location: "example/bundles",
    kind: "github",
    name: "Demo bundle",
    version: "1.0.0",
    sha256: pin,
    downloadUrl: `${s.base}/dl/demo-1.0.0.mjs`,
    apps: ["demo"],
  });
  assert.equal(c.changelog, "First.");
  assert.equal(c.description.manifest.name, "Demo bundle");
  assert.equal(c.bundlePath, join(s.paths.cache, "bundles", `${pin}.mjs`));
  assert.deepEqual(loadSources(s.paths), [], "nothing is saved before the user confirms");

  addSource(s.paths, c.source);
  assert.deepEqual(loadSources(s.paths), [c.source]);
  assert.throws(() => addSource(s.paths, c.source), /example\/bundles is already a source/);
  assert.equal((await bundleForApp(s.paths, "demo", s.o))?.bundlePath, c.bundlePath);
  assert.equal(await bundleForApp(s.paths, "other", s.o), undefined);

  // A cleared cache is filled again from the pinned download, checked against the pin.
  rmSync(c.bundlePath);
  assert.deepEqual(await bundleForApp(s.paths, "demo", s.o), { bundlePath: c.bundlePath, source: c.source, warnings: [] });

  assert.deepEqual(removeSource(s.paths, "example/bundles"), c.source);
  assert.deepEqual(loadSources(s.paths), []);
  assert.throws(() => removeSource(s.paths, "example/bundles"), /example\/bundles is not a source/);
});

test("bundle.json comes from the GitHub API when raw.githubusercontent.com fails", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0");
  s.state.rawStatus = 503;
  assert.equal((await prepareSource(s.paths, "example/bundles", s.o)).source.version, "1.0.0");
  s.state.apiStatus = 404;
  await assert.rejects(
    prepareSource(s.paths, "example/bundles", s.o),
    /^Error: couldn't fetch bundle\.json from example\/bundles \(raw\.githubusercontent\.com: HTTP 503; GitHub API: HTTP 404\)$/,
  );
});

test("a bundle that doesn't match its bundle.json is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0", "", s.bundleBytes("1.0.0"));
  s.state.bundleJson.sha256 = "b".repeat(64);
  await assert.rejects(prepareSource(s.paths, "example/bundles", s.o), /SHA-256 mismatch/);
  s.publish("1.0.0", "", s.bundleBytes("1.2.0"));
  await assert.rejects(prepareSource(s.paths, "example/bundles", s.o), /bundle\.json describes "Demo bundle" 1\.0\.0, but the bundle is "Demo bundle" 1\.2\.0/);
  s.state.bundleJson.download_url = "http://example.com/demo.mjs";
  await assert.rejects(prepareSource(s.paths, "example/bundles", s.o), /download_url "http:\/\/example\.com\/demo\.mjs" must use https/);
  await assert.rejects(prepareSource(s.paths, "http://example.com/bundle.json", s.o), /bundle\.json URL "http:\/\/example\.com\/bundle\.json" must use https/);
  assert.deepEqual(loadSources(s.paths), []);
});

test("refresh moves a GitHub pin to a new version; URL and file sources keep theirs", async (t) => {
  const s = await setup();
  t.after(s.close);
  s.publish("1.0.0");
  addSource(s.paths, (await prepareSource(s.paths, "example/bundles", s.o)).source);
  const url = (await prepareSource(s.paths, `${s.base}/url/bundle.json`, s.o)).source;
  addSource(s.paths, url);
  const file = join(s.root, "local.mjs");
  writeDemoBundle(file, { sha256: "a".repeat(64), version: "0.9.0" });
  const local = (await prepareSource(s.paths, file, s.o)).source;
  assert.deepEqual([local.location, local.kind, local.version, local.downloadUrl], [file, "file", "0.9.0", undefined]);
  addSource(s.paths, local);

  const pin = s.publish("1.1.0", "Second.");
  assert.deepEqual(await refreshSources(s.paths, s.o), ['example/bundles: "Demo bundle" 1.0.0 → 1.1.0\nSecond.']);
  assert.deepEqual(loadSources(s.paths).map((x) => [x.kind, x.version, x.sha256 === pin]), [
    ["github", "1.1.0", true],
    ["url", "1.0.0", false],
    ["file", "0.9.0", false],
  ]);
  assert.deepEqual(await refreshSources(s.paths, s.o), []);

  s.state.rawStatus = s.state.apiStatus = 500;
  assert.deepEqual(await refreshSources(s.paths, s.o), [
    "example/bundles: not refreshed, still using 1.1.0: couldn't fetch bundle.json from example/bundles (raw.githubusercontent.com: HTTP 500; GitHub API: HTTP 500)",
  ]);
});

test("the first source with an app wins, and a changed file source is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  const file = join(s.root, "local.mjs");
  writeDemoBundle(file, { sha256: "a".repeat(64) });
  const local = (await prepareSource(s.paths, file, s.o)).source;
  addSource(s.paths, local);
  s.publish("1.0.0");
  addSource(s.paths, (await prepareSource(s.paths, "example/bundles", s.o)).source);
  const choice = await bundleForApp(s.paths, "demo", s.o);
  assert.equal(choice?.source.location, file);
  assert.deepEqual(choice?.warnings, [`"demo" is in 2 bundle sources (${file}, example/bundles); using ${file}`]);

  // The cache is refilled from the file only while the file still has the pinned hash.
  rmSync(choice!.bundlePath);
  assert.equal((await bundleForApp(s.paths, "demo", s.o))?.bundlePath, choice!.bundlePath);
  writeFileSync(file, `${readFileSync(file, "utf8")}\n// changed\n`);
  rmSync(choice!.bundlePath);
  await assert.rejects(bundleForApp(s.paths, "demo", s.o), new RegExp(`${file} changed since it was added as a source`));
  assert.equal(existsSync(choice!.bundlePath), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/engine/test/bundle-sources.test.ts`
Expected: FAIL with `Cannot find module '…/packages/engine/src/bundle-sources.ts'`.

- [ ] **Step 3: Implement**

Create `packages/engine/src/bundle-sources.ts`:

```ts
// Bundle sources (spec §7.2): where bundles come from, each pinned to the SHA-256 the user confirmed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe } from "./api.ts";
import { downloadVerified, fileSha256 } from "./download.ts";
import type { BundleDescription } from "./job.ts";
import type { Paths } from "./paths.ts";
import { compareVersions, ENGINE_VERSION } from "./version.ts";

export type SourceKind = "github" | "url" | "file";

export interface BundleSource {
  /** What the user added: "owner/repo", the URL of a bundle.json, or the absolute path of a .mjs file. */
  location: string;
  kind: SourceKind;
  name: string;
  version: string;
  /** The pin. The bundle is cached as bundles/<sha256>.mjs and checked against it before each use. */
  sha256: string;
  /** Where the pinned bundle came from (github and url sources), to fetch it again if the cache was cleared. */
  downloadUrl?: string;
  /** The app ids the bundle defines, so choosing a bundle for an app needs no sandbox run. */
  apps: string[];
}

export interface SourceFetchOptions {
  fetch?: typeof fetch;
  /** Tests point these at a local server; they default to https://raw.githubusercontent.com and https://api.github.com. */
  rawBaseUrl?: string;
  apiBaseUrl?: string;
}

/** A bundle fetched, verified, cached and described, but not yet trusted: what `sources add` shows before asking. */
export interface SourceCandidate {
  source: BundleSource;
  bundlePath: string;
  description: BundleDescription;
  changelog: string;
}

interface BundleJson {
  name: string;
  version: string;
  sha256: string;
  download_url: string;
  changelog: string;
}

const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;

export function sourceKind(location: string): SourceKind {
  if (location.endsWith(".mjs")) return "file";
  if (/^https?:\/\//.test(location)) return "url";
  if (GITHUB_REPO.test(location) && !location.split("/").some((p) => p === "." || p === "..")) return "github";
  throw new Error(`"${location}" is not a bundle source: use owner/repo, the https URL of a bundle.json, or a .mjs file`);
}

/** https only; plain http just for loopback, which is what tests serve. */
function assertHttps(what: string, url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${what} "${url}" is not a URL`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))) {
    throw new Error(`${what} "${url}" must use https`);
  }
  return url;
}

async function getJson(url: string, o: SourceFetchOptions, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await (o.fetch ?? fetch)(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** A GitHub source's bundle.json is on its default branch: raw.githubusercontent.com first, then the API (spec §7.2). */
async function fetchBundleJson(source: Pick<BundleSource, "kind" | "location">, o: SourceFetchOptions): Promise<BundleJson> {
  let data: unknown;
  if (source.kind === "url") {
    data = await getJson(assertHttps("bundle.json URL", source.location), o).catch((e: Error) => {
      throw new Error(`couldn't fetch ${source.location}: ${e.message}`);
    });
  } else {
    const raw = `${o.rawBaseUrl ?? "https://raw.githubusercontent.com"}/${source.location}/HEAD/bundle.json`;
    const api = `${o.apiBaseUrl ?? "https://api.github.com"}/repos/${source.location}/contents/bundle.json`;
    data = await getJson(raw, o).catch((rawError: Error) =>
      getJson(api, o, { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28" }).catch((apiError: Error) => {
        throw new Error(`couldn't fetch bundle.json from ${source.location} (raw.githubusercontent.com: ${rawError.message}; GitHub API: ${apiError.message})`);
      }),
    );
  }
  const j = data as Partial<Record<keyof BundleJson, unknown>> | null;
  if (typeof j?.name !== "string" || typeof j.version !== "string" || typeof j.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(j.sha256) || typeof j.download_url !== "string") {
    throw new Error(`the bundle.json of ${source.location} needs name, version, sha256 and download_url`);
  }
  return { name: j.name, version: j.version, sha256: j.sha256, download_url: assertHttps("download_url", j.download_url), changelog: typeof j.changelog === "string" ? j.changelog : "" };
}

const cachePath = (paths: Paths, sha256: string) => join(paths.cache, "bundles", `${sha256}.mjs`);

/** Copies a local bundle into the cache and returns the SHA-256 of the copy, the bytes that will be used. */
async function cacheFile(paths: Paths, file: string): Promise<string> {
  const part = join(paths.cache, "bundles", `.${process.pid}.part`);
  mkdirSync(join(paths.cache, "bundles"), { recursive: true });
  try {
    copyFileSync(file, part);
    const sha256 = await fileSha256(part);
    renameSync(part, cachePath(paths, sha256));
    return sha256;
  } finally {
    rmSync(part, { force: true });
  }
}

/** Fetches, verifies, caches and describes a source's bundle (in the sandbox). Nothing is saved. */
export async function prepareSource(paths: Paths, location: string, o: SourceFetchOptions = {}): Promise<SourceCandidate> {
  const kind = sourceKind(location);
  let source: BundleSource;
  let changelog = "";
  if (kind === "file") {
    const file = resolve(location);
    if (!existsSync(file)) throw new Error(`${file} doesn't exist`);
    const sha256 = await cacheFile(paths, file);
    source = { location: file, kind, name: "", version: "", sha256, apps: [] };
  } else {
    const j = await fetchBundleJson({ kind, location }, o);
    await downloadVerified({ url: j.download_url, dest: cachePath(paths, j.sha256), sha256: j.sha256, fetch: o.fetch });
    source = { location, kind, name: j.name, version: j.version, sha256: j.sha256, downloadUrl: j.download_url, apps: [] };
    changelog = j.changelog;
  }
  const bundlePath = cachePath(paths, source.sha256);
  const description = await describe(bundlePath);
  const { name, version, minEngine } = description.manifest;
  if (kind !== "file" && (name !== source.name || version !== source.version)) {
    throw new Error(`${location}: bundle.json describes "${source.name}" ${source.version}, but the bundle is "${name}" ${version}`);
  }
  if (compareVersions(minEngine, ENGINE_VERSION) > 0) throw new Error(`bundle "${name}" needs Revamp ${minEngine} or newer (this is ${ENGINE_VERSION})`);
  return { source: { ...source, name, version, apps: description.apps.map((a) => a.id) }, bundlePath, description, changelog };
}

const sourcesFile = (paths: Paths) => join(paths.config, "sources.json");

export function loadSources(paths: Paths): BundleSource[] {
  const file = sourcesFile(paths);
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as { sources?: BundleSource[] };
  if (!Array.isArray(data.sources)) throw new Error(`${file} has no "sources" list`);
  return data.sources;
}

function saveSources(paths: Paths, sources: BundleSource[]): void {
  mkdirSync(paths.config, { recursive: true });
  const file = sourcesFile(paths);
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ sources }, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

const sameLocation = (s: BundleSource, location: string) => s.location === (sourceKind(location) === "file" ? resolve(location) : location);

export function addSource(paths: Paths, source: BundleSource): void {
  const sources = loadSources(paths);
  if (sources.some((s) => sameLocation(s, source.location))) throw new Error(`${source.location} is already a source; remove it first to add it again`);
  saveSources(paths, [...sources, source]);
}

export function removeSource(paths: Paths, location: string): BundleSource {
  const sources = loadSources(paths);
  const found = sources.find((s) => sameLocation(s, location));
  if (!found) throw new Error(`${location} is not a source (see revamp sources list)`);
  saveSources(paths, sources.filter((s) => s !== found));
  return found;
}

/**
 * Moves the pin of each GitHub source whose bundle.json has a new version, after verifying the new bundle against
 * that bundle.json (the repo is the trust anchor). URL and file sources stay pinned to the exact hash the user added.
 * A source that can't be refreshed keeps its pin; the returned lines say what changed or failed.
 */
export async function refreshSources(paths: Paths, o: SourceFetchOptions = {}): Promise<string[]> {
  const sources = loadSources(paths);
  const lines: string[] = [];
  for (const [i, s] of sources.entries()) {
    if (s.kind !== "github") continue;
    try {
      const j = await fetchBundleJson(s, o);
      if (j.version === s.version) continue;
      const next = (await prepareSource(paths, s.location, o)).source;
      sources[i] = next;
      lines.push(`${s.location}: "${s.name}" ${s.version} → ${next.version}${j.changelog ? `\n${j.changelog}` : ""}`);
    } catch (e) {
      lines.push(`${s.location}: not refreshed, still using ${s.version}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  saveSources(paths, sources);
  return lines;
}

export interface SourceChoice {
  bundlePath: string;
  source: BundleSource;
  warnings: string[];
}

/** The pinned bundle of the first source that defines the app (spec §7.2: first wins), checked against its pin. */
export async function bundleForApp(paths: Paths, appId: string, o: SourceFetchOptions = {}): Promise<SourceChoice | undefined> {
  const matches = loadSources(paths).filter((s) => s.apps.includes(appId));
  const source = matches[0];
  if (!source) return undefined;
  const warnings = matches.length > 1 ? [`"${appId}" is in ${matches.length} bundle sources (${matches.map((s) => s.location).join(", ")}); using ${source.location}`] : [];
  const bundlePath = cachePath(paths, source.sha256);
  if (source.downloadUrl) {
    await downloadVerified({ url: source.downloadUrl, dest: bundlePath, sha256: source.sha256, fetch: o.fetch });
  } else if (!existsSync(bundlePath) || (await fileSha256(bundlePath)) !== source.sha256) {
    rmSync(bundlePath, { force: true });
    if (!existsSync(source.location) || (await cacheFile(paths, source.location)) !== source.sha256) {
      throw new Error(`${source.location} changed since it was added as a source; add it again (revamp sources remove, then add) to trust the new file`);
    }
  }
  return { bundlePath, source, warnings };
}
```

In `packages/engine/src/index.ts`, replace:

```ts
export { listInstalls,
```

with:

```ts
export {
  addSource,
  bundleForApp,
  loadSources,
  prepareSource,
  refreshSources,
  removeSource,
  sourceKind,
  type BundleSource,
  type SourceCandidate,
  type SourceFetchOptions,
} from "./bundle-sources.ts";
export { listInstalls,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/engine/test/bundle-sources.test.ts && npm test && npm run typecheck`
Expected: PASS. 6 bundle-source tests; `npm test` reports 208 tests, 0 failures; both `tsc` runs print nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/bundle-sources.ts packages/engine/src/index.ts packages/engine/test/bundle-sources.test.ts packages/engine/test/helpers/demo.ts
git commit -m "feat(engine): bundle sources pinned to SHA-256

A source is a GitHub repo (bundle.json from the default branch, raw
first, then the API), a bundle.json URL or a local file. Its bundle is
verified, cached as bundles/<sha256>.mjs and described in the sandbox
before the user trusts it. Refresh moves a GitHub pin to a new version;
URL and file pins never move. The first source with an app wins.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `revamp sources`, and bundles from sources

**Model:** `sonnet` / `medium`

**Files:**
- Modify: `packages/cli/src/main.ts` (whole file), `packages/cli/src/format.ts` (whole file)
- Test: `packages/cli/test/cli.test.ts`, `test/integration/sea.test.ts`

**Interfaces:**
- Consumes: Task 3's `prepareSource`, `addSource`, `loadSources`, `removeSource`, `bundleForApp`, `BundleSource`, `SourceCandidate`; Task 2's SEA.
- Produces:
  - `revamp sources add <owner/repo | https-url-of-bundle.json | file.mjs> [--yes]` prints `formatSourceCandidate` and asks `Trust this bundle and add the source? [y/N]`. Only `y` or `yes` (or `--yes`) saves it and prints `Added <location>.`; anything else exits 1 with nothing saved.
  - `revamp sources list` prints `formatSources(loadSources())`; `revamp sources remove <source>` prints `Removed <location> ("<name>" <version>).`.
  - `bundleFor(paths, appId, flag)` in `main.ts`: `--bundle`, else `bundleForApp` (warnings printed as `Warning: …`), else, only when not a SEA, the repo build. Otherwise it throws `no bundle source has "<app>"; add one, e.g. revamp sources add xb00tt/revamp`. `patch` and `patches` use it.
  - `format.ts`: `formatSourceCandidate(c)`, `formatSources(list)` (exact text in the tests) and `printable(text)`, which shows every control character except newline and tab as `\xNN`. `main.ts` prints only through `print`/`printError`, which apply it. Task 5 and 6 add their output the same way.
  - `confirm(question)` in `main.ts` serves both `sources add` and `uninstall`.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/test/cli.test.ts`, replace:

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
```

with:

```ts
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
```

In `packages/cli/test/cli.test.ts`, replace:

```ts
import { formatInstalls, formatPatchList, formatPatchResult } from "../src/format.ts";
```

with:

```ts
import { formatInstalls, formatPatchList, formatPatchResult, printable } from "../src/format.ts";
```

In `packages/cli/test/cli.test.ts`, replace:

```ts
const cli = (args: string[], home = mkdtempSync(join(tmpdir(), "revamp-cli-"))) =>
  spawnSync(process.execPath, [MAIN, ...args], { encoding: "utf8", env: { ...process.env, HOME: home, XDG_DATA_HOME: "", XDG_CONFIG_HOME: "" } });
```

with:

```ts
const cli = (args: string[], home = mkdtempSync(join(tmpdir(), "revamp-cli-")), input = "") =>
  spawnSync(process.execPath, [MAIN, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, HOME: home, XDG_DATA_HOME: "", XDG_CONFIG_HOME: "", XDG_CACHE_HOME: "", XDG_STATE_HOME: "" },
  });
```

Append to `packages/cli/test/cli.test.ts`:

```ts

test("revamp sources adds a file source once confirmed, patches use it, and remove drops it", () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-"));
  const bundle = join(home, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const sha256 = createHash("sha256").update(readFileSync(bundle)).digest("hex");

  const declined = cli(["sources", "add", bundle], home, "n\n");
  assert.equal(declined.status, 1);
  assert.equal(
    declined.stdout,
    `Bundle "Demo bundle" 1.0.0 by test (GPL-3.0-only), from ${bundle}\n  Apps: Demo 1.0.0, 2.0.0\n  SHA-256: ${sha256}\nTrust this bundle and add the source? [y/N] `,
  );
  assert.equal(cli(["sources", "list"], home).stdout, "No bundle sources. Add one: revamp sources add xb00tt/revamp\n");

  assert.match(cli(["sources", "add", bundle, "--yes"], home).stdout, new RegExp(`\nAdded ${bundle}\\.\n$`));
  assert.equal(cli(["sources", "list"], home).stdout, `${bundle}\n  "Demo bundle" 1.0.0 (file), apps: demo\n  SHA-256: ${sha256}\n`);
  const listing = cli(["patches", "demo"], home);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /^Demo 1\.0\.0, from bundle "Demo bundle" 1\.0\.0\n/);

  assert.equal(cli(["sources", "remove", bundle], home).stdout, `Removed ${bundle} ("Demo bundle" 1.0.0).\n`);
  assert.equal(cli(["sources", "list"], home).stdout, "No bundle sources. Add one: revamp sources add xb00tt/revamp\n");
  assert.match(cli(["sources", "nope"], home).stderr, /^Unknown sources command "nope"\./);
});

test("bundle text can't move the cursor or clear the screen before the trust prompt", () => {
  assert.equal(printable("a\x1b[2Kb\rc\u009b\nd\te"), "a\\x1b[2Kb\\x0dc\\x9b\nd\te");
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-"));
  const bundle = join(home, "evil.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  writeFileSync(bundle, readFileSync(bundle, "utf8").replace('name: "Demo bundle"', 'name: "Demo\\u001b[2K\\r bundle"'));
  const r = cli(["sources", "add", bundle], home, "n\n");
  assert.match(r.stdout, /^Bundle "Demo\\x1b\[2K\\x0d bundle" 1\.0\.0/);
  assert.doesNotMatch(r.stdout, /\x1b|\r/);
});
```

In `test/integration/sea.test.ts`, replace:

```ts
    const dryRun = revamp("patch", "hydra", "--dry-run", "--bundle", bundle);
```

with:

```ts
    // Outside the repo there is no default bundle: it comes from a source.
    const none = revamp("patches", "hydra");
    assert.equal(none.status, 1);
    assert.equal(none.stderr, 'revamp: no bundle source has "hydra"; add one, e.g. revamp sources add xb00tt/revamp\n');
    const added = revamp("sources", "add", bundle, "--yes");
    assert.equal(added.status, 0, added.stderr);

    const dryRun = revamp("patch", "hydra", "--dry-run");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/cli/test/cli.test.ts`
Expected: FAIL with `SyntaxError: The requested module '../src/format.ts' does not provide an export named 'printable'`.

- [ ] **Step 3: Implement**

Replace the whole of `packages/cli/src/format.ts` with:

```ts
import type { BundleSource, InstalledApp, PatchAppResult, PatchListing, PatchStatus, SourceCandidate } from "@revamp/engine";

const MARK: Record<PatchStatus, string> = { applied: "✓", failed: "✗", skipped: "–", incompatible: " ", disabled: " " };

export function formatPatchResult(r: PatchAppResult): string {
  const shown = r.results.filter((x) => !x.internal || x.status === "failed");
  // The count is of the patches users choose; a failed internal patch is listed, but as the reason others were skipped.
  const ran = shown.filter((x) => !x.internal && x.status !== "disabled" && x.status !== "incompatible");
  const applied = ran.filter((x) => x.status === "applied").length;
  const outcome = r.aborted
    ? `nothing installed: ${r.aborted}`
    : r.installed
      ? `installed to ${r.installDir}`
      : r.dryRun
        ? "dry run, nothing installed"
        : "not installed";
  const lines = [`${r.appName} ${r.version}${r.untested ? " (untested)" : ""}: ${applied}/${ran.length} patches apply (${outcome})`];
  for (const x of shown) {
    const tag = x.status === "disabled" || x.status === "incompatible" ? ` [${x.status}]` : "";
    lines.push(`  ${MARK[x.status]} ${x.name}${x.required ? " (required)" : ""}${tag}`);
    if (x.message && x.status !== "applied" && x.status !== "incompatible") {
      lines.push(...x.message.split("\n").map((l) => `      ${l}`));
    }
  }
  for (const l of r.logs) lines.push(`  ${l}`);
  for (const w of r.warnings) lines.push(`Note: ${w}`);
  return lines.join("\n");
}

export function formatInstalls(apps: InstalledApp[]): string {
  if (apps.length === 0) return "No Revamped apps installed.";
  const lines: string[] = [];
  for (const a of apps) {
    for (const v of a.versions) {
      // Receipts store UTC; "sv-SE" formats local time as YYYY-MM-DD HH:MM.
      const when = new Date(v.receipt.installedAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
      const patches = v.receipt.patches.filter((p) => p.status === "applied" && !p.internal && !p.required).map((p) => p.name);
      const tags = `${v.version === a.current ? " (current)" : ""}${v.receipt.release.untested ? " (untested)" : ""}`;
      lines.push(`${a.appId} ${v.version}${tags}  installed ${when}  ${patches.join(", ")}`.trimEnd());
    }
  }
  return lines.join("\n");
}

export function formatPatchList(l: PatchListing): string {
  const lines = [
    `${l.app.name} ${l.version}${l.listed ? "" : " (not in this bundle: patching it needs --force)"}, from bundle "${l.bundle.name}" ${l.bundle.version}`,
  ];
  for (const p of l.patches) {
    const versions = (p.apps ?? []).filter((a) => a.app === l.app.id).flatMap((a) => a.versions ?? []);
    const state = p.required ? "required" : !p.compatible ? `only for ${versions.join(", ")}` : p.default ? "on by default" : "off by default";
    lines.push(`  ${p.name}  [${state}]`);
    if (p.description) lines.push(`      ${p.description}`);
    for (const [key, o] of Object.entries(p.options)) {
      const preset = o.default === null ? "" : `, default ${JSON.stringify(o.default)}`;
      lines.push(`      --option "${p.name}:${key}=<${o.type}>"  ${o.title}${preset}`);
      if (o.description) lines.push(`          ${o.description}`);
    }
  }
  return lines.join("\n");
}

/** What `revamp sources add` shows before asking: the manifest, the apps and versions, and the hash to pin. */
export function formatSourceCandidate(c: SourceCandidate): string {
  const m = c.description.manifest;
  const apps = c.description.apps.map((a) => `${a.name} ${Object.keys(a.versions).join(", ")}`).join("; ");
  return [
    `Bundle "${m.name}" ${m.version} by ${m.author} (${m.license}), from ${c.source.location}`,
    `  Apps: ${apps}`,
    `  SHA-256: ${c.source.sha256}`,
    ...(c.changelog ? ["", ...c.changelog.split("\n").map((l) => `  ${l}`)] : []),
  ].join("\n");
}

export function formatSources(sources: BundleSource[]): string {
  if (sources.length === 0) return "No bundle sources. Add one: revamp sources add xb00tt/revamp";
  return sources.map((s) => `${s.location}\n  "${s.name}" ${s.version} (${s.kind}), apps: ${s.apps.join(", ")}\n  SHA-256: ${s.sha256}`).join("\n");
}

/** Text with terminal control characters (all but newline and tab) shown as \xNN, so bundle text can't rewrite the screen. */
export function printable(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}
```

Replace the whole of `packages/cli/src/main.ts` with:

```ts
import { createInterface } from "node:readline/promises";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  addSource,
  bundleForApp,
  listInstalls,
  listPatches,
  loadSources,
  patchApp,
  prepareSource,
  removeSource,
  revampPaths,
  rollback,
  uninstall,
  type Paths,
} from "@revamp/engine";
import { formatInstalls, formatPatchList, formatPatchResult, formatSourceCandidate, formatSources, printable } from "./format.ts";

// Bundles supply names, notes and messages, and the trust prompt follows them: print nothing that moves the cursor.
const print = (text: string) => console.log(printable(text));
const printError = (text: string) => console.error(printable(text));

const USAGE = `Usage:
  revamp patch <app> [--version <v>] [--force] [--enable <patch>]... [--disable <patch>]...
               [--option "<patch>:<key>=<value>"]... [--bundle <file>] [--dry-run]
  revamp patches <app> [--version <v>] [--bundle <file>]
  revamp list
  revamp rollback <app>
  revamp uninstall <app> [--yes]
  revamp sources add <owner/repo | https-url-of-bundle.json | file.mjs> [--yes]
  revamp sources list
  revamp sources remove <source>

Without --bundle, an app's bundle comes from the first source that has it.`;

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** --bundle, else the first bundle source with the app (spec §7.2), else, running from the repo, the repo build. */
async function bundleFor(paths: Paths, appId: string, flag: string | undefined): Promise<string> {
  if (flag) return flag;
  const choice = await bundleForApp(paths, appId);
  if (choice) {
    for (const w of choice.warnings) printError(`Warning: ${w}`);
    return choice.bundlePath;
  }
  if (!isSea()) return fileURLToPath(new URL("../../../bundles/official/dist/official.mjs", import.meta.url));
  throw new Error(`no bundle source has "${appId}"; add one, e.g. revamp sources add xb00tt/revamp`);
}

async function sources(paths: Paths, sub: string | undefined, location: string | undefined, yes: boolean): Promise<number> {
  const needLocation = () => {
    if (!location) throw new Error(`"sources ${sub}" needs a source, e.g. revamp sources ${sub} xb00tt/revamp`);
    return location;
  };
  switch (sub) {
    case "add": {
      const candidate = await prepareSource(paths, needLocation());
      print(formatSourceCandidate(candidate));
      if (!yes && !(await confirm("Trust this bundle and add the source?"))) return 1;
      addSource(paths, candidate.source);
      print(`Added ${candidate.source.location}.`);
      return 0;
    }
    case "list":
      print(formatSources(loadSources(paths)));
      return 0;
    case "remove": {
      const removed = removeSource(paths, needLocation());
      print(`Removed ${removed.location} ("${removed.name}" ${removed.version}).`);
      return 0;
    }
    default:
      printError(`Unknown sources command "${sub ?? ""}".\n${USAGE}`);
      return 1;
  }
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "string" },
      force: { type: "boolean" },
      enable: { type: "string", multiple: true },
      disable: { type: "string", multiple: true },
      option: { type: "string", multiple: true },
      bundle: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, appId] = positionals;
  if (values.help) {
    print(USAGE);
    return 0;
  }
  if (!command) {
    printError(USAGE);
    return 1;
  }
  const paths = revampPaths();
  const needApp = () => {
    if (!appId) throw new Error(`"${command}" needs an app, e.g. revamp ${command} hydra`);
    return appId;
  };
  switch (command) {
    case "patch": {
      const result = await patchApp({
        appId: needApp(),
        bundlePath: await bundleFor(paths, needApp(), values.bundle),
        version: values.version,
        force: values.force,
        enable: values.enable,
        disable: values.disable,
        options: values.option,
        dryRun: values["dry-run"],
        paths,
        log: (line) => printError(line),
      });
      print(formatPatchResult(result));
      return result.exitCode;
    }
    case "patches":
      print(formatPatchList(await listPatches(await bundleFor(paths, needApp(), values.bundle), needApp(), values.version)));
      return 0;
    case "list":
      print(formatInstalls(listInstalls(paths)));
      return 0;
    case "rollback":
      print(`${needApp()}: now using ${rollback(paths, needApp())}`);
      return 0;
    case "uninstall": {
      const id = needApp();
      if (!values.yes && !(await confirm(`Remove Revamped ${id} (all versions, its menu entry and saved choices)?`))) return 1;
      uninstall(paths, id);
      print(`Removed Revamped ${id}.`);
      return 0;
    }
    case "sources":
      return sources(paths, positionals[1], positionals[2], values.yes ?? false);
    default:
      printError(`Unknown command "${command}".\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    printError(`revamp: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/cli/test/cli.test.ts && npm test && npm run typecheck`
Expected: PASS. 7 CLI tests; `npm test` reports 210 tests, 0 failures; both `tsc` runs print nothing.

Run: `npm run build -w @revamp/bundle-official && REVAMP_INTEGRATION=1 node --test test/integration/sea.test.ts`
Expected: PASS, 1 test in about 25 s. Without a source the SEA refuses with the message above; with the file source it dry-runs Hydra 4.1.6 with all 6 patches applying.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/main.ts packages/cli/src/format.ts packages/cli/test/cli.test.ts test/integration/sea.test.ts
git commit -m "feat(cli): revamp sources add/list/remove; bundles come from sources

add shows the manifest, apps and SHA-256 and pins it once confirmed.
Without --bundle, patch and patches use the first source with the app,
falling back to the repo build only when run from the repo. Everything
the CLI prints goes through printable(), so bundle text can't rewrite
the trust prompt with terminal control sequences.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `revamp check` and `revamp update`

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/engine/src/updates.ts`
- Modify: `packages/engine/src/api.ts` (export `findApp`, add `patchCounts`), `packages/engine/src/index.ts`, `packages/cli/src/format.ts`, `packages/cli/src/main.ts`
- Test: `packages/engine/test/updates.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 3's `refreshSources`, `bundleForApp`, `SourceFetchOptions`; `patchApp` (M1: `releaseBaseUrl`, `apiBaseUrl` and `fetch` for tests; `force` lets an unlisted version through, verified by GitHub's digest); `listInstalls`; `describe`.
- Produces:
  - `patchCounts(results): { applied; total; failing: string[] }` in `api.ts`: named patches that ran (not disabled or incompatible). The report header now uses it, so the header and the notification always agree.
  - `findApp` is exported from `api.ts` (not from the package).
  - `updates.ts`, exported from `@revamp/engine`:
    - `interface UpdateOptions extends SourceFetchOptions { paths; releaseBaseUrl?; log? }`.
    - `latestRelease(app, o?)`: `GET <api>/repos/<github>/releases/latest`, then `tag_name` → version by the app's tag template. A tag that doesn't fit throws.
    - `interface AppCheck { appId; appName; current; latest?; status: "up to date" | "update" | "failed"; listed?; applied?; total?; failing?; aborted?; error? }` and `interface CheckResult { checkedAt; sources: string[]; apps: AppCheck[] }`.
    - `checkUpdates(o)`: refresh the sources, then for each installed app take its source's bundle and latest release. A newer release is dry-run with `force` (nothing installed). Writes `<state>/last-check.json`. One app failing doesn't stop the others.
    - `checkMessage(c)`: the line shown and notified, worded as in §7.3 (exact strings in the test).
    - `updateApp(appId, o & { force? }): Promise<{ appId; appName; current; latest; result?: PatchAppResult }>`: refresh, then `patchApp` the newest release with the saved selection; `result` is absent when up to date.
  - CLI: `revamp check [--notify]` prints the refresh lines and one `checkMessage` per app, runs `notify-send Revamp <line>` for each app that isn't up to date when `--notify` is set, and exits 1 if any check failed. `revamp update [<app>] [--force]` updates one app or all installed ones. With nothing installed, both print `No Revamped apps installed.`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/updates.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchApp } from "../src/api.ts";
import { addSource, prepareSource } from "../src/bundle-sources.ts";
import { revampPaths } from "../src/paths.ts";
import { checkMessage, checkUpdates, updateApp, type AppCheck, type UpdateOptions } from "../src/updates.ts";
import { demoDeb, writeDemoBundle } from "./helpers/demo.ts";

/** Demo 1.0.0 installed from a file source; the fake GitHub's latest release is `state.latest`. */
async function setup() {
  const deb = await demoDeb();
  const sha256 = createHash("sha256").update(deb).digest("hex");
  const state = { latest: "v1.0.0" };
  const server = createServer((req, res) => {
    if (/^\/example\/demo\/releases\/download\/v([13])\.0\.0\/demo_\1\.0\.0_amd64\.deb$/.test(req.url!)) res.end(deb);
    else if (req.url === "/repos/example/demo/releases/latest") res.end(JSON.stringify({ tag_name: state.latest }));
    else if (req.url === "/repos/example/demo/releases/tags/v3.0.0") res.end(JSON.stringify({ assets: [{ name: "demo_3.0.0_amd64.deb", digest: `sha256:${sha256}` }] }));
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "revamp-updates-"));
  const paths = revampPaths({ HOME: join(root, "home") });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const o: UpdateOptions = { paths, apiBaseUrl: base, releaseBaseUrl: base };
  const bundle = join(root, "demo.mjs");
  writeDemoBundle(bundle, { sha256 });
  addSource(paths, (await prepareSource(paths, bundle)).source);
  assert.equal((await patchApp({ ...o, appId: "demo", bundlePath: bundle })).installed, true);
  return { paths, o, state, close: () => server.close() };
}

test("check finds nothing new, then dry-runs a newer release and records the result", async (t) => {
  const s = await setup();
  t.after(s.close);
  const upToDate = await checkUpdates(s.o);
  assert.deepEqual(upToDate.apps, [{ appId: "demo", appName: "Demo", current: "1.0.0", latest: "1.0.0", listed: true, status: "up to date" }]);
  assert.deepEqual(upToDate.sources, []);

  s.state.latest = "v3.0.0"; // not listed in the bundle: verified by GitHub's digest and dry-run anyway
  const r = await checkUpdates(s.o);
  assert.deepEqual(r.apps, [
    { appId: "demo", appName: "Demo", current: "1.0.0", latest: "3.0.0", listed: false, status: "update", applied: 1, total: 1, failing: [], aborted: undefined },
  ]);
  assert.equal(checkMessage(r.apps[0]), "Demo 3.0.0 out, not yet in your bundles (untested: 1/1 patches apply)");
  assert.deepEqual(JSON.parse(readFileSync(join(s.paths.state, "last-check.json"), "utf8")), JSON.parse(JSON.stringify(r)));
  assert.equal(readlinkSync(join(s.paths.data, "apps/demo/current")), "1.0.0", "a check installs nothing");

  s.state.latest = "release-3";
  assert.deepEqual((await checkUpdates(s.o)).apps.map((a) => [a.status, a.error]), [
    ["failed", 'the latest Demo release on GitHub has tag "release-3", which doesn\'t fit "v{version}"'],
  ]);
});

test("update installs the newest release with the saved selection; an unlisted one needs force", async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.deepEqual(await updateApp("demo", s.o), { appId: "demo", appName: "Demo", current: "1.0.0", latest: "1.0.0" });
  s.state.latest = "v3.0.0";
  await assert.rejects(updateApp("demo", s.o), /Demo 3\.0\.0 is not supported by bundle "Demo bundle" .*add --force/);
  const u = await updateApp("demo", { ...s.o, force: true });
  assert.equal(u.result?.installed, true);
  assert.equal(readlinkSync(join(s.paths.data, "apps/demo/current")), "3.0.0");
  await assert.rejects(updateApp("other", s.o), /^Error: other is not installed; install it with revamp patch other$/);
});

test("checkMessage words each outcome the way the notification shows it", () => {
  const c: AppCheck = { appId: "hydra", appName: "Hydra", current: "4.1.6", latest: "4.1.7", status: "update", listed: true, applied: 5, total: 5, failing: [] };
  assert.equal(checkMessage(c), "Hydra 4.1.7 out, 5/5 patches apply");
  assert.equal(checkMessage({ ...c, applied: 4, failing: ["Recently downloaded sort"] }), "Hydra 4.1.7 out, 4/5 apply: Recently downloaded sort fails");
  assert.equal(checkMessage({ ...c, applied: 3, failing: ["A", "B"] }), "Hydra 4.1.7 out, 3/5 apply: A, B fail");
  assert.equal(checkMessage({ ...c, aborted: "required patch failed" }), "Hydra 4.1.7 out, but its patch job fails: required patch failed");
  assert.equal(checkMessage({ ...c, status: "up to date", latest: "4.1.6" }), "Hydra 4.1.6 is up to date");
  assert.equal(checkMessage({ appId: "hydra", appName: "hydra", current: "4.1.6", status: "failed", error: "offline" }), "Couldn't check hydra: offline");
});
```

Append to `packages/cli/test/cli.test.ts`:

```ts

test("check and update say so when nothing is installed", () => {
  const home = mkdtempSync(join(tmpdir(), "revamp-cli-"));
  for (const command of ["check", "update"]) {
    const r = cli([command], home);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "No Revamped apps installed.\n");
  }
  assert.equal(cli(["update", "hydra"], home).stderr, "revamp: hydra is not installed; install it with revamp patch hydra\n");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/engine/test/updates.test.ts`
Expected: FAIL with `Cannot find module '…/packages/engine/src/updates.ts'`.

- [ ] **Step 3: Implement**

In `packages/engine/src/api.ts`, replace:

```ts
/** The app a job or listing is about, after checking the bundle's engine floor and the app's bundle-supplied names. */
function findApp(
```

with:

```ts
/** The app a job or listing is about, after checking the bundle's engine floor and the app's bundle-supplied names. */
export function findApp(
```

In `packages/engine/src/api.ts`, replace:

```ts
export async function patchApp(
```

with:

```ts
/** A job's tally, as the report header and update checks show it: named patches that ran (not disabled or incompatible). */
export function patchCounts(results: PatchResult[]): { applied: number; total: number; failing: string[] } {
  const ran = results.filter((x) => !x.internal && x.status !== "disabled" && x.status !== "incompatible");
  return {
    applied: ran.filter((x) => x.status === "applied").length,
    total: ran.length,
    failing: ran.filter((x) => x.status !== "applied").map((x) => x.name),
  };
}

export async function patchApp(
```

Create `packages/engine/src/updates.ts`:

```ts
// revamp check and revamp update (spec §7.3): the newest GitHub release of each installed app, dry-run or installed.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, findApp, patchApp, patchCounts, type PatchAppResult } from "./api.ts";
import { bundleForApp, refreshSources, type SourceFetchOptions } from "./bundle-sources.ts";
import { listInstalls } from "./install.ts";
import type { AppInfo } from "./job.ts";
import type { Paths } from "./paths.ts";
import { compareVersions } from "./version.ts";

export interface UpdateOptions extends SourceFetchOptions {
  paths: Paths;
  /** Tests point this at a local server; defaults to https://github.com. */
  releaseBaseUrl?: string;
  log?: (line: string) => void;
}

export interface AppCheck {
  appId: string;
  /** The bundle's name for the app, or its id when the check failed before reading the bundle. */
  appName: string;
  current: string;
  /** The newest GitHub release, when the check got that far. */
  latest?: string;
  status: "up to date" | "update" | "failed";
  /** The bundle lists the newest release as a stable version. */
  listed?: boolean;
  /** The dry run of the newest release with the saved selection. */
  applied?: number;
  total?: number;
  failing?: string[];
  aborted?: string;
  error?: string;
}

export interface CheckResult {
  checkedAt: string;
  /** What refreshing the sources changed or couldn't do. */
  sources: string[];
  apps: AppCheck[];
}

/** The version in a release tag, by the app's tag template ("v{version}"). */
function versionFromTag(template: string, tag: string): string | undefined {
  const [before, after = ""] = template.split("{version}");
  const fits = tag.length > before.length + after.length && tag.startsWith(before) && tag.endsWith(after);
  return fits ? tag.slice(before.length, tag.length - after.length) : undefined;
}

export async function latestRelease(app: AppInfo, o: Pick<UpdateOptions, "apiBaseUrl" | "fetch"> = {}): Promise<string> {
  const url = `${o.apiBaseUrl ?? "https://api.github.com"}/repos/${app.release.github}/releases/latest`;
  const res = await (o.fetch ?? fetch)(url, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  const tag = ((await res.json().catch(() => undefined)) as { tag_name?: unknown } | undefined)?.tag_name;
  const version = typeof tag === "string" ? versionFromTag(app.release.tag, tag) : undefined;
  if (!version) throw new Error(`the latest ${app.name} release on GitHub has tag ${JSON.stringify(tag)}, which doesn't fit "${app.release.tag}"`);
  return version;
}

/** An installed app's bundle (from the sources) and its newest release. */
async function newest(appId: string, o: UpdateOptions) {
  const choice = await bundleForApp(o.paths, appId, o);
  if (!choice) throw new Error(`no bundle source has "${appId}"; add one, e.g. revamp sources add xb00tt/revamp`);
  for (const w of choice.warnings) o.log?.(`Warning: ${w}`);
  const app = findApp(await describe(choice.bundlePath), appId);
  return { bundlePath: choice.bundlePath, app, latest: await latestRelease(app, o) };
}

const isStable = (app: AppInfo, version: string) => Object.hasOwn(app.versions, version) && !app.versions[version].experimental;

/**
 * Refreshes the sources, then for each installed app looks up its newest release and, if it is newer than
 * `current`, downloads, verifies and dry-runs it with the saved selection. The result goes to last-check.json.
 */
export async function checkUpdates(o: UpdateOptions): Promise<CheckResult> {
  const sources = await refreshSources(o.paths, o);
  const apps: AppCheck[] = [];
  for (const installed of listInstalls(o.paths)) {
    if (!installed.current) continue;
    const check: AppCheck = { appId: installed.appId, appName: installed.appId, current: installed.current, status: "failed" };
    try {
      const { bundlePath, app, latest } = await newest(installed.appId, o);
      Object.assign(check, { appName: app.name, latest, listed: isStable(app, latest), status: "up to date" });
      if (compareVersions(latest, installed.current) > 0) {
        const r = await patchApp({ ...o, appId: app.id, bundlePath, version: latest, force: true, dryRun: true });
        Object.assign(check, { status: "update", ...patchCounts(r.results), aborted: r.aborted });
      }
    } catch (e) {
      check.error = e instanceof Error ? e.message : String(e);
    }
    apps.push(check);
  }
  const result = { checkedAt: new Date().toISOString(), sources, apps };
  mkdirSync(o.paths.state, { recursive: true });
  const file = join(o.paths.state, "last-check.json");
  writeFileSync(`${file}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return result;
}

/** The line `revamp check` prints and notify-send shows. */
export function checkMessage(c: AppCheck): string {
  if (c.status === "failed") return `Couldn't check ${c.appName}: ${c.error}`;
  if (c.status === "up to date") return `${c.appName} ${c.current} is up to date`;
  const out = `${c.appName} ${c.latest} out`;
  if (c.aborted) return `${out}, but its patch job fails: ${c.aborted}`;
  const counts = `${c.applied}/${c.total}`;
  if (!c.listed) return `${out}, not yet in your bundles (untested: ${counts} patches apply)`;
  if (!c.failing?.length) return `${out}, ${counts} patches apply`;
  return `${out}, ${counts} apply: ${c.failing.join(", ")} ${c.failing.length === 1 ? "fails" : "fail"}`;
}

export interface AppUpdate {
  appId: string;
  appName: string;
  current: string;
  latest: string;
  /** Absent when `current` is already the newest release. */
  result?: PatchAppResult;
}

/**
 * Installs an installed app's newest release with its saved selection (spec §7.3). A version the bundle doesn't list,
 * or lists as experimental, needs `force`.
 */
export async function updateApp(appId: string, o: UpdateOptions & { force?: boolean }): Promise<AppUpdate> {
  const current = listInstalls(o.paths).find((a) => a.appId === appId)?.current;
  if (!current) throw new Error(`${appId} is not installed; install it with revamp patch ${appId}`);
  await refreshSources(o.paths, o).then((lines) => lines.forEach((l) => o.log?.(l)));
  const { bundlePath, app, latest } = await newest(appId, o);
  const update = { appId, appName: app.name, current, latest };
  if (compareVersions(latest, current) <= 0) return update;
  return { ...update, result: await patchApp({ ...o, appId: app.id, bundlePath, version: latest }) };
}
```

In `packages/engine/src/index.ts`, replace:

```ts
export { describe, listPatches, newestStable, patchApp, type PatchAppOptions, type PatchAppResult, type PatchListing } from "./api.ts";
```

with:

```ts
export { describe, listPatches, newestStable, patchApp, patchCounts, type PatchAppOptions, type PatchAppResult, type PatchListing } from "./api.ts";
export { checkMessage, checkUpdates, latestRelease, updateApp, type AppCheck, type AppUpdate, type CheckResult, type UpdateOptions } from "./updates.ts";
```

In `packages/cli/src/format.ts`, replace:

```ts
import type { BundleSource, InstalledApp, PatchAppResult, PatchListing, PatchStatus, SourceCandidate } from "@revamp/engine";
```

with:

```ts
import { patchCounts, type BundleSource, type InstalledApp, type PatchAppResult, type PatchListing, type PatchStatus, type SourceCandidate } from "@revamp/engine";
```

In `packages/cli/src/format.ts`, replace:

```ts
  const ran = shown.filter((x) => !x.internal && x.status !== "disabled" && x.status !== "incompatible");
  const applied = ran.filter((x) => x.status === "applied").length;
```

with:

```ts
  const { applied, total } = patchCounts(r.results);
```

In `packages/cli/src/format.ts`, replace:

```ts
${applied}/${ran.length} patches apply
```

with:

```ts
${applied}/${total} patches apply
```

In `packages/cli/src/main.ts`, replace:

```ts
import { createInterface } from "node:readline/promises";
```

with:

```ts
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
```

In `packages/cli/src/main.ts`, replace:

```ts
  bundleForApp,
  listInstalls,
```

with:

```ts
  bundleForApp,
  checkMessage,
  checkUpdates,
  listInstalls,
```

In `packages/cli/src/main.ts`, replace:

```ts
  uninstall,
  type Paths,
```

with:

```ts
  uninstall,
  updateApp,
  type Paths,
```

In `packages/cli/src/main.ts`, replace:

```ts
  revamp sources remove <source>
```

with:

```ts
  revamp sources remove <source>
  revamp check [--notify]
  revamp update [<app>] [--force]
```

In `packages/cli/src/main.ts`, replace:

```ts
      yes: { type: "boolean" },
```

with:

```ts
      yes: { type: "boolean" },
      notify: { type: "boolean" },
```

In `packages/cli/src/main.ts`, replace:

```ts
    case "sources":
```

with:

```ts
    case "check": {
      const r = await checkUpdates({ paths, log: (line) => printError(line) });
      for (const line of r.sources) print(line);
      if (r.apps.length === 0) print("No Revamped apps installed.");
      for (const c of r.apps) {
        const text = checkMessage(c);
        print(text);
        // notify-send is optional: without it, the line is still in the timer's journal.
        if (values.notify && c.status !== "up to date") spawnSync("notify-send", ["Revamp", text], { stdio: "ignore" });
      }
      return r.apps.some((c) => c.status === "failed") ? 1 : 0;
    }
    case "update": {
      const ids = appId ? [appId] : listInstalls(paths).filter((a) => a.current).map((a) => a.appId);
      if (ids.length === 0) print("No Revamped apps installed.");
      let code = 0;
      for (const id of ids) {
        const u = await updateApp(id, { paths, force: values.force, log: (line) => printError(line) });
        print(u.result ? formatPatchResult(u.result) : `${u.appName} ${u.current} is up to date`);
        code = Math.max(code, u.result?.exitCode ?? 0);
      }
      return code;
    }
    case "sources":
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/engine/test/updates.test.ts packages/cli/test/cli.test.ts && npm test && npm run typecheck`
Expected: PASS. 3 update tests and 8 CLI tests; `npm test` reports 214 tests, 0 failures; both `tsc` runs print nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/api.ts packages/engine/src/updates.ts packages/engine/src/index.ts packages/engine/test/updates.test.ts packages/cli/src/main.ts packages/cli/src/format.ts packages/cli/test/cli.test.ts
git commit -m "feat: revamp check and revamp update

check refreshes the sources, asks GitHub for each installed app's newest
release and, when it is newer, downloads, verifies and dry-runs it with
the saved selection; the result goes to last-check.json and, with
--notify, to notify-send. update installs the newest release; unlisted
or experimental versions need --force.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `revamp timer enable|disable`

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/cli/src/timer.ts`
- Modify: `packages/cli/src/main.ts`
- Test: `packages/cli/test/timer.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 5's `revamp check --notify`; Task 2's installed SEA (`process.execPath` inside it).
- Produces:
  - `timerUnits(revamp: string): Record<string, string>`: `revamp-check.service` (oneshot; `ExecStart="<path>" check --notify`, with `\` and `"` escaped and `%` and `$` doubled for systemd) and `revamp-check.timer` (`OnCalendar=daily`, `Persistent=true`, `RandomizedDelaySec=1h`, `WantedBy=timers.target`).
  - `type Systemctl = (...args: string[]) => void`. The default runs `systemctl --user …` and throws with its stderr on failure; tests pass a recorder.
  - `enableTimer(unitDir, revamp, run?)`: write both units, then `daemon-reload` and `enable --now revamp-check.timer`.
  - `disableTimer(unitDir, run?)`: `disable --now revamp-check.timer` if the unit exists, remove both, then `daemon-reload`.
  - CLI `revamp timer enable` only from the SEA (`<config dir>/systemd/user`, i.e. `~/.config/systemd/user`), and `revamp timer disable`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/timer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disableTimer, enableTimer, timerUnits } from "../src/timer.ts";

test("enable writes the daily timer and its service, then starts the timer; disable undoes both", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "revamp-timer-")), "systemd/user");
  const calls: string[] = [];
  const run = (...args: string[]) => void calls.push(args.join(" "));
  enableTimer(dir, "/home/me/.local/share/revamp/bin/revamp", run);
  assert.equal(
    readFileSync(join(dir, "revamp-check.service"), "utf8"),
    '[Unit]\nDescription=Check for new releases of Revamped apps\n\n[Service]\nType=oneshot\nExecStart="/home/me/.local/share/revamp/bin/revamp" check --notify\n',
  );
  assert.equal(
    readFileSync(join(dir, "revamp-check.timer"), "utf8"),
    "[Unit]\nDescription=Daily Revamp update check\n\n[Timer]\nOnCalendar=daily\nPersistent=true\nRandomizedDelaySec=1h\n\n[Install]\nWantedBy=timers.target\n",
  );
  assert.deepEqual(calls, ["daemon-reload", "enable --now revamp-check.timer"]);

  disableTimer(dir, run);
  assert.equal(existsSync(join(dir, "revamp-check.service")) || existsSync(join(dir, "revamp-check.timer")), false);
  assert.deepEqual(calls.slice(2), ["disable --now revamp-check.timer", "daemon-reload"]);
  disableTimer(dir, run); // nothing to disable: only the reload
  assert.deepEqual(calls.slice(4), ["daemon-reload"]);
});

test("ExecStart quotes the path the way systemd reads it", () => {
  assert.match(timerUnits('/home/a b/100%$"x\\/revamp')["revamp-check.service"], /^ExecStart="\/home\/a b\/100%%\$\$\\"x\\\\\/revamp" check --notify$/m);
});
```

Append to `packages/cli/test/cli.test.ts`:

```ts

test("the timer needs the installed binary", () => {
  assert.equal(cli(["timer", "enable"]).stderr, "revamp: the timer runs the installed revamp: run npm run install:cli, then revamp timer enable\n");
  assert.match(cli(["timer"]).stderr, /^"timer" needs enable or disable\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/cli/test/timer.test.ts`
Expected: FAIL with `Cannot find module '…/packages/cli/src/timer.ts'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/timer.ts`:

```ts
// revamp timer enable|disable (spec §7.3): a systemd user timer runs `revamp check --notify` daily.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = "revamp-check.service";
const TIMER = "revamp-check.timer";

export type Systemctl = (...args: string[]) => void;

function systemctl(...args: string[]): void {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`systemctl --user ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
}

/** systemd's ExecStart quoting: the path in double quotes, with \ and " escaped and % and $ doubled. */
const execPath = (path: string) => `"${path.replace(/[\\"]/g, "\\$&").replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

export function timerUnits(revamp: string): Record<string, string> {
  return {
    [SERVICE]: `[Unit]\nDescription=Check for new releases of Revamped apps\n\n[Service]\nType=oneshot\nExecStart=${execPath(revamp)} check --notify\n`,
    [TIMER]: `[Unit]\nDescription=Daily Revamp update check\n\n[Timer]\nOnCalendar=daily\nPersistent=true\nRandomizedDelaySec=1h\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

export function enableTimer(unitDir: string, revamp: string, run: Systemctl = systemctl): void {
  mkdirSync(unitDir, { recursive: true });
  for (const [name, text] of Object.entries(timerUnits(revamp))) writeFileSync(join(unitDir, name), text);
  run("daemon-reload");
  run("enable", "--now", TIMER);
}

export function disableTimer(unitDir: string, run: Systemctl = systemctl): void {
  if (existsSync(join(unitDir, TIMER))) run("disable", "--now", TIMER);
  for (const name of [SERVICE, TIMER]) rmSync(join(unitDir, name), { force: true });
  run("daemon-reload");
}
```

In `packages/cli/src/main.ts`, replace:

```ts
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
```

with:

```ts
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
```

In `packages/cli/src/main.ts`, replace:

```ts
import { formatInstalls, formatPatchList, formatPatchResult, formatSourceCandidate, formatSources, printable } from "./format.ts";
```

with:

```ts
import { formatInstalls, formatPatchList, formatPatchResult, formatSourceCandidate, formatSources, printable } from "./format.ts";
import { disableTimer, enableTimer } from "./timer.ts";
```

In `packages/cli/src/main.ts`, replace:

```ts
  revamp update [<app>] [--force]
```

with:

```ts
  revamp update [<app>] [--force]
  revamp timer enable|disable
```

In `packages/cli/src/main.ts`, replace:

```ts
    case "sources":
```

with:

```ts
    case "timer": {
      const units = join(dirname(paths.config), "systemd", "user");
      if (appId === "enable") {
        // The timer starts this very binary, so it has to be the installed SEA, not node running the repo's source.
        if (!isSea()) throw new Error("the timer runs the installed revamp: run npm run install:cli, then revamp timer enable");
        enableTimer(units, process.execPath);
        print(`Enabled revamp-check.timer: "${process.execPath} check --notify" runs daily.`);
        return 0;
      }
      if (appId === "disable") {
        disableTimer(units);
        print("Disabled revamp-check.timer.");
        return 0;
      }
      printError(`"timer" needs enable or disable.\n${USAGE}`);
      return 1;
    }
    case "sources":
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/cli/test/timer.test.ts packages/cli/test/cli.test.ts && npm test && npm run typecheck`
Expected: PASS. 2 timer tests and 9 CLI tests; `npm test` reports 217 tests, 0 failures; both `tsc` runs print nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/timer.ts packages/cli/test/timer.test.ts packages/cli/src/main.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): revamp timer enable|disable

Writes revamp-check.service and revamp-check.timer (daily, persistent,
up to an hour's random delay) to the systemd user dir and enables the
timer; the service runs the installed binary's check --notify.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CI dry-runs every bundled app version on each push

**Model:** `sonnet` / `medium`

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1's `dist/patches.json` (`apps[].id`, `apps[].versions[v].experimental`); the CLI's `patch <app> --version <v> --dry-run --bundle <file> [--force]`, which exits 0 only when every selected patch applies (2 when one fails or is skipped, 1 when the job aborts).
- Produces: workflow `CI` on every push.
  - Job `test`: `npm ci`, typecheck, unit tests and the bundle build. It then outputs the matrix `include=[{"app":"hydra","version":"4.1.6","experimental":false},{"app":"heroic","version":"2.22.3","experimental":false}]`.
  - Job `dry-run`, one per entry: restores `~/.cache/revamp/releases/<app>/<version>` from the Actions cache (key `release-<app>-<version>`, saved after the first run), then dry-runs that version. An experimental entry gets `--force` and `continue-on-error`, so it reports without failing the run (§7.4).

GitHub runs it only after the push, so this task checks the parts locally: the YAML, the matrix command, and the exact dry-run command for one entry. The first real run is the owner's check in Task 8.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
# Spec §7.4: on every push, build and unit-test, then dry-run every app version the bundle lists against the real
# release. Stable versions must apply every patch; experimental ones only report.
name: CI
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    outputs:
      include: ${{ steps.matrix.outputs.include }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build -w @revamp/bundle-official
      - id: matrix
        run: |
          node -e '
            const { apps } = JSON.parse(require("node:fs").readFileSync("bundles/official/dist/patches.json", "utf8"));
            const include = apps.flatMap((a) => Object.entries(a.versions).map(([version, v]) => ({ app: a.id, version, experimental: Boolean(v.experimental) })));
            console.log(`include=${JSON.stringify(include)}`);
          ' >> "$GITHUB_OUTPUT"

  dry-run:
    needs: test
    runs-on: ubuntu-latest
    name: dry-run ${{ matrix.app }} ${{ matrix.version }}${{ matrix.experimental && ' (experimental)' || '' }}
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJSON(needs.test.outputs.include) }}
    # Experimental versions report only.
    continue-on-error: ${{ matrix.experimental }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run build -w @revamp/bundle-official
      - uses: actions/cache@v4
        with:
          path: ~/.cache/revamp/releases/${{ matrix.app }}/${{ matrix.version }}
          key: release-${{ matrix.app }}-${{ matrix.version }}
      # Exit code 0 only when every selected patch applies.
      - run: >-
          node packages/cli/src/main.ts patch ${{ matrix.app }} --version ${{ matrix.version }} --dry-run
          --bundle bundles/official/dist/official.mjs ${{ matrix.experimental && '--force' || '' }}
```

- [ ] **Step 2: Check the YAML and the matrix it produces**

Run:

```bash
python3 -c 'import yaml; w = yaml.safe_load(open(".github/workflows/ci.yml")); print(sorted(w["jobs"]), w[True])'
node -e '
  const { apps } = JSON.parse(require("node:fs").readFileSync("bundles/official/dist/patches.json", "utf8"));
  const include = apps.flatMap((a) => Object.entries(a.versions).map(([version, v]) => ({ app: a.id, version, experimental: Boolean(v.experimental) })));
  console.log(`include=${JSON.stringify(include)}`);
'
```

Expected: `['dry-run', 'test'] push` (PyYAML reads the key `on` as `True`), then the `include=…` line listing Hydra 4.1.6 and Heroic 2.22.3, both `"experimental":false`. The node command is the workflow's matrix step; `bundles/official/dist/patches.json` comes from Task 1's build.

- [ ] **Step 3: Run one matrix entry the way CI does**

Run:

```bash
H=$(mktemp -d)
HOME=$H XDG_CACHE_HOME=$HOME/.cache node packages/cli/src/main.ts patch heroic --version 2.22.3 --dry-run --bundle bundles/official/dist/official.mjs
status=$?
rm -rf "$H"
exit $status
```

Expected: exit 0 in about 15 s with the Heroic `.deb` cached, starting `Heroic 2.22.3: 3/3 patches apply (dry run, nothing installed)`. `HOME` is a throwaway, and `XDG_CACHE_HOME` (expanded from the real `$HOME` before the assignment) reuses the real download cache, as the Actions cache does in CI.

- [ ] **Step 4: Run the unit tests**

Run: `npm test`
Expected: PASS, 217 tests, 0 failures (this task changes no code).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: unit tests and a dry run of every bundled app version on each push

Releases are cached per app and version. Stable versions must apply
every patch; experimental versions only report.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The release script, CLAUDE.md, and the owner's acceptance

**Model:** `sonnet` / `medium` (the final whole-branch review afterwards is `opus` / `high`)

**Files:**
- Create: `bundles/official/scripts/release.ts`
- Modify: `bundles/official/package.json` (`release`), `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1's build and `BundleJson`; `gh` (authenticated as the owner); git with an upstream branch.
- Produces: `npm run release -w @revamp/bundle-official`, run by the owner only. In this order it:
  1. refuses a dirty tree (`commit your changes first: the release must match a commit`) or a commit GitHub doesn't have yet (`push this branch first: …`);
  2. builds;
  3. refuses an existing `bundle-v<version>` release, pointing at the version and CHANGELOG;
  4. runs `gh release create bundle-v<version> official.mjs patches.json --target <HEAD> --title "Bundle <version>" --notes <changelog>`;
  5. copies `dist/bundle.json` to the repo root and commits it as `release: bundle <version>`.

  The owner then pushes, and from that moment `revamp sources add xb00tt/revamp` finds it.

- [ ] **Step 1: Write the release script**

Create `bundles/official/scripts/release.ts`:

```ts
// npm run release -w @revamp/bundle-official (the owner, by hand): builds the bundle, publishes it as GitHub release
// bundle-v<version>, and commits the root bundle.json that GitHub sources read (spec §7.1, §7.2). Push afterwards.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BundleJson } from "./metadata.ts";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const root = here("../../");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

if (git("status", "--porcelain")) throw new Error("commit your changes first: the release must match a commit");
// GitHub tags the release on this commit, so it must already be there.
if (spawnSync("git", ["rev-parse", "@{u}"], { cwd: root, encoding: "utf8" }).stdout.trim() !== git("rev-parse", "HEAD")) {
  throw new Error("push this branch first: the release tags a commit GitHub must already have");
}
run("npm", ["run", "build", "-w", "@revamp/bundle-official"]);
const meta = JSON.parse(readFileSync(here("dist/bundle.json"), "utf8")) as BundleJson;
const tag = `bundle-v${meta.version}`;
const repo = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\//.exec(meta.download_url)![1];
if (spawnSync("gh", ["release", "view", tag, "--repo", repo], { stdio: "ignore" }).status === 0) {
  throw new Error(`${repo} already has ${tag}: raise the version in bundles/official/src/index.ts and add its CHANGELOG.md section`);
}
run("gh", ["release", "create", tag, here("dist/official.mjs"), here("dist/patches.json"), "--repo", repo, "--target", git("rev-parse", "HEAD"), "--title", `Bundle ${meta.version}`, "--notes", meta.changelog]);
copyFileSync(here("dist/bundle.json"), `${root}bundle.json`);
run("git", ["add", "bundle.json"]);
run("git", ["commit", "-m", `release: bundle ${meta.version}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`]);
console.log(`Released ${tag} on ${repo}. Push to publish bundle.json: GitHub sources read it from the default branch.`);
```

In `bundles/official/package.json`, replace:

```json
    "build": "node scripts/build.ts"
```

with:

```json
    "build": "node scripts/build.ts",
    "release": "node scripts/release.ts"
```

- [ ] **Step 2: Check that it stops before doing anything**

Run: `npm run release -w @revamp/bundle-official`
Expected: FAIL with `Error: commit your changes first: the release must match a commit`, because the script itself is uncommitted. This is the only time to run it while implementing: on a clean, pushed tree it builds and publishes a real GitHub release.

- [ ] **Step 3: Document the distribution in CLAUDE.md**

In `CLAUDE.md`, replace:

```markdown
npm run build -w @revamp/bundle-official    # scripts/build.ts: the extensions, then bundles/official/dist/official.mjs
npm run test:integration                    # builds the bundle, then patches the REAL releases into temp homes
npm run revamp -- patches hydra             # CLI from source; also: patch <app> [--version v --force]
                                            #   [--enable/--disable "<patch>"] [--option "<patch>:<key>=<value>"]
                                            #   [--bundle file] [--dry-run], list, rollback <app>, uninstall <app>
```

with:

```markdown
npm run build -w @revamp/bundle-official    # scripts/build.ts: the extensions, then dist/official.mjs, patches.json, bundle.json
npm run build -w @revamp/cli                # packages/cli/dist/revamp, the single executable (SEA)
npm run install:cli                         # builds the SEA and installs it; ~/.local/bin/revamp links to it
npm run test:integration                    # builds the bundle, patches the REAL releases into temp homes, tests the SEA
npm run revamp -- patches hydra             # CLI from source; also: patch <app> [--version v --force]
                                            #   [--enable/--disable "<patch>"] [--option "<patch>:<key>=<value>"]
                                            #   [--bundle file] [--dry-run], list, rollback <app>, uninstall <app>,
                                            #   sources add/list/remove, check [--notify], update [app] [--force],
                                            #   timer enable|disable
npm run release -w @revamp/bundle-official  # owner only: GitHub release bundle-v<version>, then commits bundle.json
```

In `CLAUDE.md`, replace:

```markdown
- The CLI and integration tests use `bundles/official/dist/official.mjs`. Rebuild it after changing bundle sources, or the CLI runs the old patches.
```

with:

```markdown
- Without `--bundle`, the CLI takes an app's bundle from the first source that has it (`~/.config/revamp/sources.json`, bundles cached as `~/.cache/revamp/bundles/<sha256>.mjs`). Only when no source has the app and it runs from the repo does it use `bundles/official/dist/official.mjs`. So if the CLI runs old patches, check `revamp sources list`, then rebuild.
- The integration tests use `bundles/official/dist/official.mjs` directly. Rebuild it after changing bundle sources.
```

In `CLAUDE.md`, replace:

```markdown
1. Describe: `sandbox.ts` spawns `runner.ts` under `node --permission` (bundle readable only). It returns plain JSON (`BundleDescription`).
```

with:

```markdown
1. Describe: `sandbox.ts` spawns `runner.ts` under `node --permission` (bundle readable only). It returns plain JSON (`BundleDescription`). Inside the SEA, the binary is its own runner (`revamp --sandbox-runner`, entry `cli/src/sea.ts`) and the permission flags travel in `--node-options`, because a SEA ignores Node flags in argv.
```

In `CLAUDE.md`, replace:

```markdown
**Bundle format.** One self-contained ESM file with no imports and no top-level `await`. The runner loads it with `require(esm)`, because `import()` from disk fails inside a Node SEA.
```

with:

```markdown
**Bundle format.** One self-contained ESM file with no imports and no top-level `await`. The runner loads it with `createRequire(bundle)(bundle)` (require(esm)), because `import()` from disk fails inside a Node SEA.

**Distribution (spec §7, M4).**
- `engine/bundle-sources.ts`: a source is a GitHub repo (`bundle.json` from its default branch), a `bundle.json` URL or a `.mjs` file. `sources add` verifies, caches and describes the bundle, shows it, and pins its SHA-256 once the user confirms. `refreshSources` moves only GitHub pins, to a new `bundle.json` version. The first source with an app wins.
- `engine/updates.ts`: `checkUpdates` (refresh, newest GitHub release per installed app, dry run, `~/.local/state/revamp/last-check.json`) and `updateApp`. `cli/src/timer.ts` writes the systemd user timer that runs the installed binary's `check --notify` daily.
- Publishing: `npm run release` puts `official.mjs` and `patches.json` on the GitHub release `bundle-v<version>`, and commits the root `bundle.json` that points at it. `bundles/official/CHANGELOG.md` needs a `## <version>` section (a unit test checks this).
- CI (`.github/workflows/ci.yml`) runs the unit tests, then dry-runs every app version in `patches.json` against the real release, cached per app and version.
- Bundle text is untrusted on screen too: the CLI prints everything through `printable()`, so control characters can't rewrite the trust prompt.
```

- [ ] **Step 4: Run the tests**

Run: `npm test && npm run typecheck && npm run test:integration`
Expected: PASS. `npm test` reports 217 tests, 0 failures; both `tsc` runs print nothing; the integration run passes 4 tests in about 80 s with the releases cached: Heroic, Hydra 4.0.6 forced, Hydra 4.1.6, and the SEA.

- [ ] **Step 5: Commit**

```bash
git add bundles/official/scripts/release.ts bundles/official/package.json CLAUDE.md
git commit -m "feat(bundle): release script; docs: distribution in CLAUDE.md

npm run release -w @revamp/bundle-official publishes the built bundle as
GitHub release bundle-v<version> and commits the root bundle.json that
GitHub sources read.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual acceptance (the owner; spec §13 M4)**

After the branch is merged into `main`:

1. **CI.** Push `main`. On GitHub → Actions, the "CI" run passes `test`, `dry-run hydra 4.1.6` and `dry-run heroic 2.22.3`. The first run downloads both releases (about 280 MB) and caches them; later runs restore them.
2. **Go public** (decision 1): GitHub → Settings → General → Danger Zone → Change visibility → Public.
3. **Publish bundle 0.3.0**, then push the commit it makes:

   ```bash
   npm run release -w @revamp/bundle-official
   git push
   ```

   The repo's Releases page shows `bundle-v0.3.0` with `official.mjs` and `patches.json`, and `bundle.json` is at the repo root.
4. **Install the binary:**

   ```bash
   npm run install:cli
   ```

   In a new terminal, `revamp --help` works from any folder. If it says "command not found", `~/.local/bin` isn't on `PATH`; Ubuntu adds it at login when the folder exists, so log out and in once.
5. **Add the source:** `revamp sources add xb00tt/revamp`. It shows `Bundle "Revamp official" 0.3.0 by xb00tt (GPL-3.0-only), from xb00tt/revamp`, the apps and a SHA-256 equal to the one in the root `bundle.json`. Answer `y`. `revamp sources list` shows it.
6. **Use it:** `revamp patches hydra` works with no `--bundle`. `revamp check` prints one line per installed app: `Hydra 4.1.6 is up to date`, or, if Hydra has released since, `Hydra <new> out, not yet in your bundles (untested: …)`. Nothing is installed by a check.
7. **The timer:**

   ```bash
   revamp timer enable
   systemctl --user list-timers revamp-check.timer
   systemctl --user start revamp-check.service
   journalctl --user -u revamp-check.service -n 20
   ```

   The timer is listed with its next run. The manual start writes the same lines as `revamp check` to the journal, updates `~/.local/state/revamp/last-check.json`, and shows a desktop notification only when an app has a newer release.

Running from the repo also uses the source now: `npm run revamp -- patch hydra` takes the pinned bundle, not `dist/`. While developing patches, pass `--bundle bundles/official/dist/official.mjs`, or remove the source.
