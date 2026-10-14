# Revamp M2 (breadth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp patches a second app (Heroic), Hydra gets its translated "Recently added" and "Recently downloaded" sorts, users can list patches and set options from the command line, and a release the bundle doesn't know can be patched with `--force` and a clear report of what still fits.

**In plain words, what M2 adds:**
- `revamp patches hydra` lists every patch for an app: required, on or off by default, its options, and which versions it was tested with.
- `revamp patch hydra --option "Side-by-side identity:claimLinks=false"` sets a patch option. Like `--enable` and `--disable`, it is remembered for the next run.
- A typo in a patch or option name now fails in a second, before the 150 MB download. A saved choice for a patch the bundle no longer has is dropped with a note instead of breaking the job.
- `revamp patch hydra --version 4.0.6 --force` patches a release the bundle doesn't list. Revamp asks GitHub for that file's published SHA-256, checks the download against it, labels the result "untested", and reports per patch what applied and exactly where each miss failed (spec §5.6). The real Hydra 4.0.6 shows this: 3 of 5 patches apply, and both sorts name the fingerprint and step that missed.
- Hydra's built-in translations get the fork's strings for English, Bulgarian and Brazilian Portuguese. The patch finds each language through Hydra's `resources` table, not by English text, because "Most played" appears in 23 of Hydra's languages.
- "Recently added" sorts the library newest first, with games that have no added date last.
- Heroic 2.22.3 installs as "Heroic Games Launcher (Revamped)" with the Deals link removed from its sidebar.
- Three hardening fixes from the M1 review: patch names are checked before downloading, the app's executable path from the bundle is checked, and desktop or icon symlinks in a `.deb` are no longer moved to a place where they would point somewhere else.

**Architecture:**
- No new modules or dependencies. M2 extends M1's units in place:
  - `@revamp/sdk`: `Match.resolve()` and `Capture.resolve()` types.
  - `engine/match`: `resolve()` follows an identifier to its top-level declaration.
  - `engine/config`: parent-side selection checks and `--option` parsing.
  - `engine/download`: GitHub's published digest for unlisted versions.
  - `engine/api`: wires the checks in before download, and adds `listPatches`.
  - `cli`: `revamp patches`, `--option` and the "(untested)" label.
- `bundles/official` gains the internal Hydra locales patch, Recently added sort, the Heroic app and Hide Deals link.

**Tech Stack:** Unchanged from M1: Node 26.12, TypeScript (`tsc --noEmit`), acorn 8.19, xz-decompress 0.2.3, esbuild, `@electron/asar` (test oracle).

**Spec:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`. This plan implements its M2 slice: §13 M2, §5.3 `resolve()`, §5.6 error output, §7.2 note (`--bundle`), the §10 M2 rows, and §4.3 step 2 (unlisted versions). The M1 plan (`docs/superpowers/plans/2026-10-14-revamp-m1-walking-skeleton.md`) explains the code M2 builds on.

**Validated before hand-off.** Every code block in this plan was extracted into a fresh clone of `main` (M1, commit `e7e8daa`), applied task by task, and run on Node 26.12.0 with TypeScript 7.0.2:
- Each task's "verify it fails" step failed as described, and its "verify it passes" step passed with the stated test count: 116, 122, 126, 128, 130, 134, 137 and 141 unit tests after Tasks 1–8. `tsc` was clean after every task.
- Each task's commit command ran and left a clean working tree.
- `npm run test:integration`: 3/3 pass against the real releases, with downloads cached:
  - Hydra 4.1.6: all 5 patches apply; the job takes about 21 s.
  - Heroic 2.22.3: all 3 patches apply, the Deals link is gone; about 12 s.
  - Hydra 4.0.6 forced: 3/5 apply, and both sorts report the fingerprint and step that missed; about 19 s.

Executors should transcribe the code, not redesign it. A failure most likely means a typo, a wrong Node version, or a step applied out of order.

**Design choices worth knowing (each one is a deliberate simplification):**
- **Menu order.** Recently added reuses M1's fingerprints and inserts at the same spots as Recently downloaded. Inserts at one spot keep patch order, and patches run in name order, so the menus read *Recently played, Recently added, Recently downloaded, Most played*. The fork shows *downloaded* before *added*. Matching it would need two more fingerprints (two more ways to break on a new release) for a cosmetic difference.
- **The calendar icon.** The fork's Recently added entry uses Octicons' `CalendarIcon`, which stock Hydra 4.1.6 doesn't ship. The patch defines it next to `DownloadIcon` with Hydra's own `createIconComponent` and the 16 px path data from Octicons 19 (MIT).
- **`resolve()` sees top-level names only.** A local variable that shadows a top-level one still resolves to the top-level one. Hydra's translation tables are all top-level; add scope analysis when a patch needs locals.
- **Unlisted means untested.** Only versions missing from the bundle get the "untested" label. Experimental versions still need `--force`, as in M1, but have a pinned hash, so they are not labeled.
- **Links outside the app directory are skipped, not followed.** A desktop file or icon that is a symlink in the `.deb` is not extracted. A missing icon falls back to the stock icon name; a missing desktop file fails the job with a clear message. Hydra's and Heroic's `.deb` files have no symlinks at all.
- **Internal patches are named by their description in messages.** M1 called them "(internal patch #4)". M2 adds the description, so a skipped sort reads `dependency "(internal patch #4: Hydra locales)" failed`.

**Deliberately not in this plan** (later milestones per the spec, or out of scope):
- the extension build and loader, registry hooks, shims, the mount wrapper and "More like this" (M3)
- `bundle.json`/`patches.json` generation, sources, check, update, the timer and the SEA binary (M4)
- the GUI (M5)
- sharing Heroic data with the owner's Flatpak install (spec §3.1, §14: Revamped Heroic starts without the Flatpak's logins)
- Hydra's Big Picture sort menus (the fork's `a5ff30d31`; Big Picture is a spec non-goal)
- the fork's exact menu order (see above)

**Model per task** (kickoff "Subagent model choice": the cheapest adequate model):
- Every implementer gets the model/effort named in its task header. The code is given and was validated, so transcription needs no more than `sonnet`.
- Tasks 3 and 4 touch trust boundaries (bundle-supplied paths, verifying unlisted downloads), so their *reviewers* are `opus`/`high`.
- Escalate one tier on failure.
- The final whole-branch review is `opus`/`high`.

## Global Constraints

- **Node:** Node ≥ 26 (installed at `~/.local/node-26`, v26.12.0). Every shell command in this plan assumes `export PATH="$HOME/.local/node-26/bin:$PATH"` first. Root `.npmrc` has `engine-strict=true`.
- **TypeScript runs natively, erasable syntax only:**
  - Not allowed: `enum`, `namespace`, constructor parameter properties, `import x = require()`.
  - Type-only imports use `import type`; relative imports include the `.ts` extension.
- **No new dependencies.** Runtime: engine keeps `acorn` and `xz-decompress`; root devDependencies stay `typescript`, `@types/node`, `esbuild`, `@electron/asar`. No native addons.
- **Downloads:**
  - Never execute downloaded files, and never read or modify `/opt/Hydra` or `/opt/Heroic` (tests included).
  - Listed versions are verified against the bundle's pinned SHA-256. Only unlisted versions with `--force` use GitHub's published digest (`GET https://api.github.com/repos/<owner>/<repo>/releases/tags/<tag>`, asset field `digest: "sha256:<hex>"`).
- **Release pins:**
  - Hydra 4.1.6: `hydralauncher_4.1.6_amd64.deb`, tag `v4.1.6`, repo `hydralauncher/hydra`, SHA-256 `fc075d4c9334fa7462cdfe4faef625f61e6933df48fa03e1939b635951147363`.
  - Heroic 2.22.3: `Heroic-2.22.3-linux-amd64.deb` (127,528,508 bytes), tag `v2.22.3`, repo `Heroic-Games-Launcher/HeroicGamesLauncher`, SHA-256 `f89eed7e0eb900fbe3051edfedbe7532db14328241cbf8c1fb766462dfc0b849`.
  - Heroic's `.deb` contains `opt/Heroic/**` (executable `opt/Heroic/heroic`), `usr/share/applications/heroic.desktop` and `usr/share/icons/hicolor/<16…1024>x<…>/apps/heroic.png`. Its `data.tar.xz` has no symlinks or hardlinks.
  - Hydra 4.0.6 (the mismatched real release for the integration test): `hydralauncher_4.0.6_amd64.deb`, GitHub digest `sha256:ebe8067d5845aab1113fe41198fcd173914352711f540a45aa669fd699cd0fee`.
- **Versions:** `ENGINE_VERSION` becomes `"0.2.0"`; the official bundle becomes version `"0.2.0"` with `minEngine: "0.2.0"` (it uses `resolve()`).
- **State paths:** unchanged from M1 (spec §4.5). Unit tests never touch the network or the real home dirs; they use temp dirs, local HTTP servers on port 0, or a stub `fetch`.
- **Port 3000** is a production server on this machine. Nothing in this plan may listen on or connect to it.
- **Tests:** `node:test` + `node:assert/strict`. `npm test` runs every unit test; `npm run typecheck` must stay clean after every task.
- **Commits:**
  - Conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
  - Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Bundles:** a single ESM file with no imports and no top-level `await` (loaded with `require(esm)`).

## Review Focus

These are inputs the spec implies but no feature test would naturally hit. Each line names the expected behavior and the task that pins it with a test:

1. **Saved choices from an older bundle.** A saved patch that was removed, renamed or became required, or a saved option the patch dropped, is removed from the selection with a one-line note. The job carries on and never fails after a 150 MB download. Pinned in Tasks 2 and 3.
2. **A fingerprint that matches more than intended on a real release.** Hydra's main process carries its own copy of the translations with a second `resources` table, and the renderer's flag map has the same language keys with string values. The locales patch must edit only the renderer's i18n tables. Pinned in Task 6 (both decoys) and Task 9 (real release).
3. **Unlisted versions that can't be verified.** No such release, no such asset, no digest or a non-SHA-256 one, a malformed repo name, or an HTTP error from GitHub all stop the job before anything is downloaded. Bytes without a matching SHA-256 are never used. Pinned in Task 4.
4. **Bundle-supplied names on the parent's side.** An executable path with `..` or `/` tricks, an executable missing from the `.deb`, desktop or icon symlinks, and a patch named `__proto__` reaching `--option` are rejected or skipped, never followed or merged into objects. Pinned in Tasks 2 and 3.
5. **Hand-typed option values.** `yes` for a bool, an empty or non-numeric number, and values that contain `:` or `=` either fail with a message naming the flag or are kept verbatim. Pinned in Task 2.

## File Structure

```
packages/sdk/src/index.ts            + Match.resolve(), Capture.resolve(); internal-patch doc
packages/engine/
  src/version.ts                     ENGINE_VERSION 0.2.0
  src/match.ts                       + Range.resolve(): identifier → top-level declaration
  src/graph.ts                       internal patch labels carry their description
  src/config.ts                      + parseOptionFlag, resolveSelection (parent-side checks, saved-choice cleanup)
  src/job.ts                         describeBundle lists required patches; + patchesForApp
  src/paths.ts                       + assertSafeRelativePath
  src/deb.ts                         select(path, kind): "dir" | "file" | "link"
  src/download.ts                    + releaseDigest (GitHub's published SHA-256)
  src/install.ts                     receipt release.untested
  src/api.ts                         findApp; checks before download; --force for unlisted versions; + listPatches
  src/index.ts                       exports listPatches, PatchListing
  test/match.test.ts  test/job.test.ts  test/selection.test.ts (new)  test/api.test.ts  test/download.test.ts
packages/cli/
  src/main.ts                        + `patches` command, --option
  src/format.ts                      "(untested)" labels; + formatPatchList
  test/cli.test.ts
bundles/official/
  src/apps.ts                        + heroic
  src/index.ts                       manifest 0.2.0; + Recently added sort, Hide Deals link, heroic
  src/hydra/locales.ts               (new) internal "Hydra locales" patch + LIBRARY_STRINGS
  src/hydra/recently-downloaded-sort.ts   depends on Hydra locales; plain i18n keys
  src/hydra/recently-added-sort.ts   (new)
  src/heroic/hide-deals-link.ts      (new)
  test/patches.test.ts               Hydra tests, extended
  test/heroic.test.ts                (new)
  test/fixtures/hydra-4.1.6/locales-excerpt.js        (new)
  test/fixtures/heroic-2.22.3/App-excerpt.js, main-excerpt.js   (new)
test/integration/hydra.test.ts       extended for M2
test/integration/heroic.test.ts      (new) real Heroic 2.22.3
test/integration/hydra-mismatch.test.ts   (new) real Hydra 4.0.6 forced
README.md                            M2 commands
```

---

### Task 1: `Match.resolve()` and named internal patches

**Model:** `sonnet` / `medium`

**Files:**
- Modify: `packages/sdk/src/index.ts` (the `Capture`, `Match` and `PatchDef` declarations)
- Modify: `packages/engine/src/match.ts` (`Range`)
- Modify: `packages/engine/src/graph.ts:69`
- Modify: `packages/engine/src/version.ts:1`
- Test: `packages/engine/test/match.test.ts`, `packages/engine/test/job.test.ts`

**Interfaces:**
- Consumes (M1): `Range`, `MatchImpl`, `Host`, `lineAt` in `match.ts`; `Sources.parsed(file).ast` (an acorn `Program`); `planPatches` in `graph.ts`.
- Produces:
  - `Range.resolve(): MatchImpl`, so every `Match` and `Capture` has `resolve()`. Given an `Identifier` node, it returns a match over that name's top-level declaration in the same file: the initializer of `const`/`let`/`var` (also under `export`), or the `FunctionDeclaration`/`ClassDeclaration` node itself. The returned match has no captures; call `find`/`findAll`/`resolve` on it.
  - Errors (plain `Error`, so a throwing patch fails with this message): `resolve() needs an identifier; <file>:<line> is a <NodeType>`, `resolve(): <name> (<file>:<line>) has no top-level declaration in <file>`, `resolve(): <name> is declared <n> times at the top level of <file>`, `resolve(): <name> is declared without a value in <file>`.
  - Internal patch labels (used in results and dependency messages): `(internal patch #<n>: <description>)`, or `(internal patch #<n>)` without a description.
  - `ENGINE_VERSION = "0.2.0"`.

**Why:** the Hydra locales patch (Task 6) walks `resources` → locale object → `library` namespace object. Each step is an identifier whose value is declared elsewhere at the top level of the renderer, which is what `resolve()` follows.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/match.test.ts`:

```ts

test("resolve() follows identifiers to top-level declarations, and edits land there", () => {
  const code = [
    "const en = { library: lib, home };",
    'const lib = { "a": "A" };',
    "export function home() {}",
    "const resources = { en, home };",
  ].join("\n");
  const t = matchIn(code, "const resources = { en: $EN, home: $H }");
  const [m] = t.matches;
  const en = m.$EN.resolve();
  assert.equal(en.text, "{ library: lib, home }");
  assert.equal(en.line, 1);
  const lib = en.find("library: $NS").$NS.resolve();
  assert.equal(lib.text, '{ "a": "A" }');
  assert.equal(m.$H.resolve().node!.type, "FunctionDeclaration");
  lib.find('"a": $V').insertAfter('"b": "B"');
  assert.equal(t.result().split("\n")[1], 'const lib = { "a": "A", "b": "B" };');
});

test("resolve() names the problem: not an identifier, undeclared, declared twice, no value", () => {
  const [m] = matchIn("var x = 1;\nvar x = 2;\nlet y;\ng(x, y, z, 1);", "g($X, $Y, $Z, $N)").matches;
  assert.throws(() => m.$X.resolve(), /x is declared 2 times at the top level of a\.js/);
  assert.throws(() => m.$Y.resolve(), /y is declared without a value in a\.js/);
  assert.throws(() => m.$Z.resolve(), /z \(a\.js:4\) has no top-level declaration in a\.js/);
  assert.throws(() => m.$N.resolve(), /needs an identifier; a\.js:4 is a Literal/);
});
```

In `packages/engine/test/job.test.ts`, replace:

```ts
  const internal = definePatch({ execute: () => void calls.push("exec internal") });
```

with:

```ts
  const internal = definePatch({ description: "Helper", execute: () => void calls.push("exec internal") });
```

In `packages/engine/test/job.test.ts`, replace:

```ts
  assert.ok(out.results.some((r) => r.internal && r.status === "applied"));
```

with:

```ts
  assert.deepEqual(out.results.filter((r) => r.internal).map((r) => [r.name, r.status]), [["(internal patch #3: Helper)", "applied"]]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/engine/test/match.test.ts packages/engine/test/job.test.ts`
Expected: 3 failures: `m.$EN.resolve is not a function`, `m.$X.resolve is not a function`, and the job test expecting `(internal patch #3: Helper)` but getting `(internal patch #3)`.

- [ ] **Step 3: Implement**

In `packages/sdk/src/index.ts`, replace:

```ts
  readonly end: number;
  toString(): string;
}
```

with:

```ts
  readonly end: number;
  /** An identifier capture → its top-level declaration in the same file (see Match.resolve). */
  resolve(): Match;
  toString(): string;
}
```

In `packages/sdk/src/index.ts`, replace:

```ts
  findAll(pattern: string): Match[];
  readonly [capture: `$${string}`]: Capture;
```

with:

```ts
  findAll(pattern: string): Match[];
  /**
   * An identifier → its top-level declaration in the same file: a const/let/var initializer, or a function
   * or class declaration. Local scopes are not searched.
   */
  resolve(): Match;
  readonly [capture: `$${string}`]: Capture;
```

In `packages/sdk/src/index.ts`, replace:

```ts
  /** Omit to make an internal patch, hidden from users and reached through dependsOn. */
```

with:

```ts
  /**
   * Omit to make an internal patch, hidden from users and reached through dependsOn.
   * An internal patch's description names it in error messages: "(internal patch #4: Hydra locales)".
   */
```

In `packages/engine/src/match.ts`, replace:

```ts
  remove(): void {
    const link = this.link();
```

with:

```ts
  /** Follows an identifier to its top-level declaration in the same file: the initializer, function or class. */
  resolve(): MatchImpl {
    const where = `${this.file}:${lineAt(this.host.sources.text(this.file), Math.max(this.start, 0))}`;
    if (this.node?.type !== "Identifier") throw new Error(`resolve() needs an identifier; ${where} is ${this.node ? `a ${this.node.type}` : "not a node"}`);
    const name: string = this.node.name;
    // ponytail: top-level names only; a local variable that shadows one still resolves to the top-level one.
    const found: Node[] = [];
    for (const top of this.host.sources.parsed(this.file).ast.body as Node[]) {
      const s = top.type === "ExportNamedDeclaration" && top.declaration ? top.declaration : top;
      if (s.type === "VariableDeclaration") {
        for (const d of s.declarations) if (d.id.type === "Identifier" && d.id.name === name) found.push(d);
      } else if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id?.name === name) found.push(s);
    }
    if (found.length === 0) throw new Error(`resolve(): ${name} (${where}) has no top-level declaration in ${this.file}`);
    if (found.length > 1) throw new Error(`resolve(): ${name} is declared ${found.length} times at the top level of ${this.file}`);
    const target = found[0].type === "VariableDeclarator" ? found[0].init : found[0];
    if (!target) throw new Error(`resolve(): ${name} is declared without a value in ${this.file}`);
    return new MatchImpl(this.host, this.file, target.start, target.end, target, new Map());
  }

  remove(): void {
    const link = this.link();
```

In `packages/engine/src/graph.ts`, replace:

```ts
    if (!labels.has(p)) labels.set(p, p.name ?? `(internal patch #${i + 1})`);
```

with:

```ts
    if (!labels.has(p)) labels.set(p, p.name ?? `(internal patch #${i + 1}${p.description ? `: ${p.description}` : ""})`);
```

In `packages/engine/src/version.ts`, replace:

```ts
export const ENGINE_VERSION = "0.1.0";
```

with:

```ts
export const ENGINE_VERSION = "0.2.0";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/engine/test/match.test.ts packages/engine/test/job.test.ts && npm test && npm run typecheck`
Expected: PASS. `npm test` reports 116 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/index.ts packages/engine/src/match.ts packages/engine/src/graph.ts packages/engine/src/version.ts packages/engine/test/match.test.ts packages/engine/test/job.test.ts
git commit -m "feat(engine): Match.resolve() follows identifiers to top-level declarations

Internal patches are now named by their description in results and
dependency messages. ENGINE_VERSION 0.2.0.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Selection checks and `--option` parsing

**Model:** `sonnet` / `medium`

**Files:**
- Modify: `packages/engine/src/config.ts` (append; one import)
- Modify: `packages/engine/src/job.ts` (`describeBundle`; append `patchesForApp`)
- Test: `packages/engine/test/selection.test.ts` (new)

**Interfaces:**
- Consumes (M1): `Selection`, `mergeSelection` (`config.ts`); `AppInfo`, `PatchInfo`, `describeBundle` (`job.ts`). `PatchInfo.apps` is `null` for a universal patch; `PatchInfo.options[key].type` is `"bool" | "string" | "number"`.
- Produces:
  - `parseOptionFlag(flag: string): { patch: string; key: string; value: string }`. It splits at the last `:` before the first `=`, so values may contain `:` and `=`. Throws `--option "<flag>" must look like "<patch>:<key>=<value>"`.
  - `interface SelectionFlags { enable?: string[]; disable?: string[]; options?: string[] }`, where `options` holds raw `--option` strings.
  - `resolveSelection(app: AppInfo, patches: PatchInfo[], saved: Selection, flags: SelectionFlags): { selection: Selection; warnings: string[] }`. `patches` must already be narrowed to the app with `patchesForApp`. Saved names and option keys the bundle no longer has, and saved disables of now-required patches, are dropped with a warning. Bad flags throw. Option values are converted to the option's type: bool only `true`/`false`, number any finite `Number(...)` of a non-blank string, string verbatim.
  - `patchesForApp(patches: PatchInfo[], appId: string): PatchInfo[]`: the app's own patches plus universal ones.
  - `describeBundle` now also lists named required patches that a bundle forgot to export in `patches`. That is the same set `planPatches` accepts, so the parent's checks and the sandbox's checks agree.

**Why:** in M1 the sandboxed child was the first to see an unknown `--enable` name, after the 150 MB download and extraction. Task 3 calls `resolveSelection` before downloading.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/selection.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptionFlag, resolveSelection } from "../src/config.ts";
import { patchesForApp, type AppInfo, type PatchInfo } from "../src/job.ts";

const app = { id: "hydra", name: "Hydra", required: ["Core"] } as AppInfo;
const patch = (name: string, apps: PatchInfo["apps"], options: PatchInfo["options"] = {}): PatchInfo => ({
  name,
  description: "",
  apps,
  default: apps !== null,
  options,
});
const opt = (type: string) => ({ type, title: type, description: "", default: null });
const PATCHES = [
  patch("Core", null, { claimLinks: opt("bool") }),
  patch("Sort", [{ app: "hydra", versions: ["4.1.6"] }], { limit: opt("number"), label: opt("string") }),
  patch("Universal", null),
  patch("Heroic only", [{ app: "heroic", versions: null }]),
];
const MINE = patchesForApp(PATCHES, "hydra");
const EMPTY = { enable: [], disable: [], options: {} };

test("patchesForApp keeps the app's own patches and the universal ones", () => {
  assert.deepEqual(MINE.map((p) => p.name), ["Core", "Sort", "Universal"]);
});

test("parseOptionFlag splits at the last colon before the first equals sign", () => {
  assert.deepEqual(parseOptionFlag("Side-by-side identity:claimLinks=false"), { patch: "Side-by-side identity", key: "claimLinks", value: "false" });
  assert.deepEqual(parseOptionFlag("P:url=http://x:1/a=b"), { patch: "P", key: "url", value: "http://x:1/a=b" });
  for (const bad of ["P:key", "key=1", ":key=1", "P:=1"]) assert.throws(() => parseOptionFlag(bad), /must look like "<patch>:<key>=<value>"/);
});

test("flags are merged and options converted to their declared types", () => {
  const { selection, warnings } = resolveSelection(app, MINE, { ...EMPTY, options: { Sort: { label: "x" } } }, {
    enable: ["Universal"],
    disable: ["Sort"],
    options: ["Core:claimLinks=false", "Sort:limit=12", "Sort:label=a:b=c"],
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(selection, {
    enable: ["Universal"],
    disable: ["Sort"],
    options: { Core: { claimLinks: false }, Sort: { label: "a:b=c", limit: 12 } },
  });
});

test("bad flags fail with a message naming what is wrong", () => {
  const run = (flags: Parameters<typeof resolveSelection>[3]) => () => resolveSelection(app, MINE, EMPTY, flags);
  assert.throws(run({ enable: ["Nope"] }), /Hydra has no patch "Nope" \(see: revamp patches hydra\)/);
  assert.throws(run({ enable: ["Heroic only"] }), /Hydra has no patch "Heroic only"/);
  assert.throws(run({ disable: ["Core"] }), /"Core" is required for Hydra and can't be disabled/);
  assert.throws(run({ options: ["Nope:x=1"] }), /Hydra has no patch "Nope"/);
  assert.throws(run({ options: ["Sort:size=1"] }), /"Sort" has no option "size" \(it has: limit, label\)/);
  assert.throws(run({ options: ["Core:claimLinks=yes"] }), /value must be true or false/);
  assert.throws(run({ options: ["Sort:limit=lots"] }), /value must be a number/);
  assert.throws(run({ options: ["Sort:limit="] }), /value must be a number/);
});

test("saved choices the bundle no longer supports are dropped with a warning", () => {
  const saved = {
    enable: ["Universal", "Gone"],
    disable: ["Core", "Sort"],
    options: { Sort: { limit: 3, old: true }, Gone: { x: 1 } },
  };
  const { selection, warnings } = resolveSelection(app, MINE, saved, {});
  assert.deepEqual(selection, { enable: ["Universal"], disable: ["Sort"], options: { Sort: { limit: 3 } } });
  assert.deepEqual(warnings, [
    'Dropped "Gone" from your saved choices for Hydra: this bundle no longer has that patch.',
    `Dropped "Core" from your saved choices for Hydra: it is required now, so it can't be disabled.`,
    'Dropped option "Sort:old" from your saved choices for Hydra: the patch no longer has that option.',
    'Dropped the options of "Gone" from your saved choices for Hydra: this bundle no longer has that patch.',
  ]);
});

test('a patch named "__proto__" stays an ordinary key', () => {
  const evil = [patch("__proto__", null, { polluted: opt("bool") })];
  const { selection } = resolveSelection(app, evil, EMPTY, { options: ["__proto__:polluted=true"] });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.keys(selection.options), ["__proto__"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/engine/test/selection.test.ts`
Expected: FAIL with `SyntaxError: The requested module '../src/config.ts' does not provide an export named 'parseOptionFlag'`.

- [ ] **Step 3: Implement**

In `packages/engine/src/config.ts`, replace:

```ts
import { assertSafeName, type Paths } from "./paths.ts";
```

with:

```ts
import type { AppInfo, PatchInfo } from "./job.ts";
import { assertSafeName, type Paths } from "./paths.ts";
```

Append to `packages/engine/src/config.ts`:

```ts

/** The `--option "<patch>:<key>=<value>"` flag, split. The value is converted to the option's type by resolveSelection. */
export function parseOptionFlag(flag: string): { patch: string; key: string; value: string } {
  const eq = flag.indexOf("=");
  const colon = eq === -1 ? -1 : flag.lastIndexOf(":", eq);
  if (colon <= 0 || eq === colon + 1) throw new Error(`--option "${flag}" must look like "<patch>:<key>=<value>"`);
  return { patch: flag.slice(0, colon), key: flag.slice(colon + 1, eq), value: flag.slice(eq + 1) };
}

export interface SelectionFlags {
  enable?: string[];
  disable?: string[];
  /** Raw `--option` values. */
  options?: string[];
}

/**
 * Checks saved choices and flags against the patches a bundle offers for one app, before anything is downloaded.
 * Saved names the bundle no longer has are dropped with a warning; bad flags are errors.
 */
export function resolveSelection(
  app: AppInfo,
  patches: PatchInfo[],
  saved: Selection,
  flags: SelectionFlags,
): { selection: Selection; warnings: string[] } {
  const known = new Map(patches.map((p) => [p.name, p]));
  const required = new Set(app.required);
  const warnings: string[] = [];
  const drop = (what: string, why: string) => void warnings.push(`Dropped ${what} from your saved choices for ${app.name}: ${why}.`);
  const GONE = "this bundle no longer has that patch";
  const clean: Selection = { enable: [], disable: [], options: {} };
  for (const n of saved.enable) {
    if (known.has(n)) clean.enable.push(n);
    else drop(`"${n}"`, GONE);
  }
  for (const n of saved.disable) {
    if (!known.has(n)) drop(`"${n}"`, GONE);
    else if (required.has(n)) drop(`"${n}"`, "it is required now, so it can't be disabled");
    else clean.disable.push(n);
  }
  for (const [n, values] of Object.entries(saved.options)) {
    const p = known.get(n);
    if (!p) {
      drop(`the options of "${n}"`, GONE);
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      if (Object.hasOwn(p.options, key)) clean.options = withOption(clean.options, n, key, value);
      else drop(`option "${n}:${key}"`, "the patch no longer has that option");
    }
  }

  const unknown = (name: string) => new Error(`${app.name} has no patch "${name}" (see: revamp patches ${app.id})`);
  for (const n of [...(flags.enable ?? []), ...(flags.disable ?? [])]) if (!known.has(n)) throw unknown(n);
  for (const n of flags.disable ?? []) if (required.has(n)) throw new Error(`"${n}" is required for ${app.name} and can't be disabled`);
  const selection = mergeSelection(clean, flags);
  for (const flag of flags.options ?? []) {
    const { patch, key, value } = parseOptionFlag(flag);
    const p = known.get(patch);
    if (!p) throw unknown(patch);
    if (!Object.hasOwn(p.options, key)) {
      throw new Error(`"${patch}" has no option "${key}" (it has: ${Object.keys(p.options).join(", ") || "none"})`);
    }
    selection.options = withOption(selection.options, patch, key, parseOptionValue(p.options[key].type, value, flag));
  }
  return { selection, warnings };
}

/** Copies instead of assigning, so a name like "__proto__" from a bundle stays an ordinary key. */
const withOption = (options: Selection["options"], patch: string, key: string, value: unknown): Selection["options"] => ({
  ...options,
  [patch]: { ...(Object.hasOwn(options, patch) ? options[patch] : {}), [key]: value },
});

function parseOptionValue(type: string, raw: string, flag: string): unknown {
  if (type === "string") return raw;
  if (type === "bool" && (raw === "true" || raw === "false")) return raw === "true";
  if (type === "number" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  throw new Error(`--option "${flag}": the value must be ${type === "bool" ? "true or false" : "a number"}`);
}
```

In `packages/engine/src/job.ts`, replace:

```ts
    patches: b.patches
      .filter((p) => p.name)
```

with:

```ts
    // Required patches count even when a bundle forgets to list them in `patches`, as they do for planPatches.
    patches: [...new Set<Patch>([...b.apps.flatMap((a) => a.required), ...b.patches])]
      .filter((p) => p.name)
```

In `packages/engine/src/job.ts`, replace:

```ts
/** The JSON a parent sends to the sandboxed runner on stdin. */
```

with:

```ts
/** The named patches that can apply to an app: its own plus the universal ones. */
export const patchesForApp = (patches: PatchInfo[], appId: string): PatchInfo[] =>
  patches.filter((p) => p.apps === null || p.apps.some((a) => a.app === appId));

/** The JSON a parent sends to the sandboxed runner on stdin. */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/engine/test/selection.test.ts && npm test && npm run typecheck`
Expected: PASS. 6 selection tests; `npm test` reports 122 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/config.ts packages/engine/src/job.ts packages/engine/test/selection.test.ts
git commit -m "feat(engine): check patch names and --option values against the bundle

resolveSelection drops saved choices the bundle no longer supports, with
a warning, and rejects unknown flags. Values are converted to the
option's declared type.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `patchApp` checks before downloading: selection, executable, `.revamp-meta` links

**Model:** `sonnet` / `medium`; reviewer `opus` / `high` (trust boundary: names and links that come from bundles and `.deb` files)

**Files:**
- Modify: `packages/engine/src/api.ts` (whole file below)
- Modify: `packages/engine/src/deb.ts` (`extractDeb` and `TarExtractor` take the entry kind)
- Modify: `packages/engine/src/paths.ts` (append `assertSafeRelativePath`)
- Test: `packages/engine/test/api.test.ts` (append)

**Interfaces:**
- Consumes: `resolveSelection`, `patchesForApp` (Task 2); M1's `describe`, `extractDeb`, `installStaged`, `takeMeta`.
- Produces:
  - `PatchAppOptions.options?: string[]` (raw `--option` values).
  - `PatchAppResult.warnings` now also holds the saved-choice notes from `resolveSelection`, on every return path, not only after an install.
  - `findApp(desc: BundleDescription, appId: string): AppInfo` (module-private): the `minEngine` check, app lookup, `assertSafeName("app id")` and `assertSafeRelativePath("executable")`. Task 5 reuses it.
  - `type EntryKind = "dir" | "file" | "link"` (exported from `deb.ts`). `extractDeb`'s `select` is now `(archivePath: string, kind: EntryKind) => string | null`. Existing one-argument selectors still type-check.
  - `assertSafeRelativePath(kind: string, value: string): string` in `paths.ts`: every `/`-separated part must be a safe name.
  - After extraction, `<staging>/<executable>` must be a regular file with an execute bit, else `the .deb has no executable file <installDir>/<executable>`.

**What the three fixes prevent:**
- *Unknown names after the download.* Checks run right after `describe`, before the lock, download or extraction.
- *A bundle pointing the menu entry anywhere.* `app.executable` comes from the bundle and becomes the `Exec=` line. `../../bin/sh` is now refused, and so is a path that isn't a real executable inside the extracted app.
- *Links in `.revamp-meta`.* The installer moves the stock desktop file and icons from `usr/share/...` into `.revamp-meta/`. A symlink's relative target means something different after that move. The extractor checks targets against the *new* location, so a valid icon link aborted the whole job ("points outside the archive"), and a 3-level link would quietly become the executable copied as the icon. Links outside `installDir` are now skipped.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/api.test.ts`:

```ts

const SHOUT =
  'patches.push({ kind: "patch", name: "Shout", compatibleWith: [{ app }], default: false, ' +
  'options: { times: { kind: "option", type: "number", title: "Times", default: 1 } }, ' +
  "execute(ctx) { ctx.log(`shouting ${ctx.options.times}x`); } });";

test("bad patch names and options fail before anything is downloaded", async (t) => {
  const s = await setup({ extra: SHOUT });
  t.after(s.close);
  await assert.rejects(patchApp({ ...s.opts, enable: ["Nope"] }), /Demo has no patch "Nope" \(see: revamp patches demo\)/);
  await assert.rejects(patchApp({ ...s.opts, options: ["Shout:times=lots"] }), /value must be a number/);
  await assert.rejects(patchApp({ ...s.opts, options: ["Shout:loud=true"] }), /"Shout" has no option "loud" \(it has: times\)/);
  await assert.rejects(patchApp({ ...s.opts, options: ["nonsense"] }), /must look like "<patch>:<key>=<value>"/);
  assert.equal(s.hits(), 0);
});

test("--option values reach the patch, and the cleaned-up selection is saved", async (t) => {
  const s = await setup({ extra: SHOUT });
  t.after(s.close);
  const file = join(s.paths.config, "apps/demo.json");
  mkdirSync(join(s.paths.config, "apps"), { recursive: true });
  writeFileSync(file, JSON.stringify({ enable: ["Removed long ago"], disable: [], options: {} }));
  const r = await patchApp({ ...s.opts, enable: ["Shout"], options: ["Shout:times=3"] });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.logs, ["[Shout] shouting 3x"]);
  assert.match(r.warnings[0], /Dropped "Removed long ago" from your saved choices for Demo: this bundle no longer has that patch\./);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enable: ["Shout"], disable: [], options: { Shout: { times: 3 } } });
});

test("the app's executable must be a safe relative path and a file in the .deb", async (t) => {
  const s = await setup({ extra: 'app.executable = "../../bin/sh";' });
  t.after(s.close);
  await assert.rejects(patchApp(s.opts), /unsafe executable "\.\.\/\.\.\/bin\/sh"/);
  assert.equal(s.hits(), 0);
  s.writeBundle({ extra: 'app.executable = "resources";' });
  await assert.rejects(patchApp(s.opts), /the \.deb has no executable file opt\/Demo\/resources/);
  assert.equal(existsSync(join(appRoot(s), "1.0.0")), false);
  assert.deepEqual(readdirSync(appRoot(s)), []);
});

test("desktop file and icon links are never moved into .revamp-meta", async (t) => {
  // Valid where the .deb puts it (it climbs to the archive root), but 6 levels up from .revamp-meta/icons/512/ is outside.
  const deep = tarEntry("./usr/share/icons/hicolor/512x512/apps/demo.png", "", { type: "2", linkname: "../../../../../../opt/Demo/demo" });
  // Three levels up from .revamp-meta/icons/1024/ is the staging root, so moved there it would make the executable the icon.
  const shallow = tarEntry("./usr/share/icons/hicolor/1024x1024/apps/demo.png", "", { type: "2", linkname: "../../../demo" });
  const s = await setup({}, [deep, shallow]);
  t.after(s.close);
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 0);
  assert.equal(readFileSync(join(appRoot(s), "1.0.0/revamp-icon.png"), "utf8"), "big-png");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/engine/test/api.test.ts`
Expected: the 4 new tests fail, and the 7 M1 tests still pass:
- `--enable Nope` is rejected only by the sandbox, after the download: `unknown patch "Nope" for Demo`.
- The saved name `Removed long ago` fails the same way, after the download.
- `../../bin/sh` is accepted ("Missing expected rejection").
- The icon links abort the job: `symlink usr/share/icons/hicolor/512x512/apps/demo.png -> ../../../../../../opt/Demo/demo points outside the archive`.

- [ ] **Step 3: Implement**

In `packages/engine/src/deb.ts`, replace:

```ts
/** Streams data.tar.* out of a .deb into outDir. Never executes anything and never writes outside outDir. */
export async function extractDeb(
  debPath: string,
  outDir: string,
  select: (archivePath: string) => string | null,
): Promise<ExtractResult> {
```

with:

```ts
/** What kind of entry `select` is asked about. Hardlinks and symlinks are both "link". */
export type EntryKind = "dir" | "file" | "link";

/** Streams data.tar.* out of a .deb into outDir. Never executes anything and never writes outside outDir. */
export async function extractDeb(
  debPath: string,
  outDir: string,
  select: (archivePath: string, kind: EntryKind) => string | null,
): Promise<ExtractResult> {
```

In `packages/engine/src/deb.ts`, replace:

```ts
  private readonly select: (archivePath: string) => string | null;

  constructor(rootDir: string, select: (archivePath: string) => string | null) {
```

with:

```ts
  private readonly select: (archivePath: string, kind: EntryKind) => string | null;

  constructor(rootDir: string, select: (archivePath: string, kind: EntryKind) => string | null) {
```

In `packages/engine/src/deb.ts`, replace:

```ts
      const rel = path === "" ? null : this.select(path);
```

with:

```ts
      const rel = path === "" ? null : this.select(path, "dir");
```

In `packages/engine/src/deb.ts`, replace:

```ts
    const rel = this.select(path);
    if (rel === null) {
```

with:

```ts
    const rel = this.select(path, type === "0" || type === "7" ? "file" : "link");
    if (rel === null) {
```

Append to `packages/engine/src/paths.ts`:

```ts

/** Guards bundle-supplied relative paths, such as an app's executable: safe names joined by "/". */
export function assertSafeRelativePath(kind: string, value: string): string {
  if (!value.split("/").every((part) => SAFE_NAME.test(part) && !part.includes(".."))) throw new Error(`unsafe ${kind} "${value}"`);
  return value;
}
```

Replace the whole of `packages/engine/src/api.ts` with:

```ts
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertAsarPath, readAsar, writeAsar } from "./asar.ts";
import { loadSelection, resolveSelection, saveSelection } from "./config.ts";
import { extractDeb, type EntryKind } from "./deb.ts";
import { parseDesktopEntry } from "./desktop.ts";
import { downloadVerified, fileSha256 } from "./download.ts";
import type { PatchResult } from "./graph.ts";
import { environmentWarnings, ICON_FILE, installStaged, lockApp, newStaging } from "./install.ts";
import { ASAR_PATH, patchesForApp, type AppInfo, type BundleDescription, type SandboxPatchOutput } from "./job.ts";
import { assertSafeName, assertSafeRelativePath, releasePath, revampPaths, type Paths } from "./paths.ts";
import { runSandboxed } from "./sandbox.ts";
import { compareVersions, ENGINE_VERSION } from "./version.ts";

export interface PatchAppOptions {
  appId: string;
  bundlePath: string;
  version?: string;
  force?: boolean;
  enable?: string[];
  disable?: string[];
  /** `--option` flags: "<patch>:<key>=<value>". */
  options?: string[];
  dryRun?: boolean;
  paths?: Paths;
  /** Tests point this at a local server; defaults to https://github.com. */
  releaseBaseUrl?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface PatchAppResult {
  appId: string;
  appName: string;
  version: string;
  results: PatchResult[];
  installed: boolean;
  dryRun: boolean;
  installDir?: string;
  aborted?: string;
  exitCode: 0 | 1 | 2;
  warnings: string[];
  logs: string[];
}

export function describe(bundlePath: string): Promise<BundleDescription> {
  const bundle = resolve(bundlePath);
  return runSandboxed<BundleDescription>({ mode: "describe", bundle }, { read: [bundle], write: [] });
}

export function newestStable(versions: AppInfo["versions"]): string | undefined {
  return Object.keys(versions)
    .filter((v) => !versions[v].experimental)
    .sort(compareVersions)
    .at(-1);
}

const fill = (template: string, version: string) => template.replaceAll("{version}", version);
const META = ".revamp-meta";

/** The app a job or listing is about, after checking the bundle's engine floor and the app's bundle-supplied names. */
function findApp(desc: BundleDescription, appId: string): AppInfo {
  const bundleName = desc.manifest.name;
  if (compareVersions(desc.manifest.minEngine, ENGINE_VERSION) > 0) {
    throw new Error(`bundle "${bundleName}" needs Revamp ${desc.manifest.minEngine} or newer (this is ${ENGINE_VERSION})`);
  }
  const app = desc.apps.find((a) => a.id === appId);
  if (!app) throw new Error(`bundle "${bundleName}" has no app "${appId}" (it has: ${desc.apps.map((a) => a.id).join(", ") || "none"})`);
  assertSafeName("app id", app.id);
  assertSafeRelativePath("executable", app.executable);
  return app;
}

export async function patchApp(o: PatchAppOptions): Promise<PatchAppResult> {
  const paths = o.paths ?? revampPaths();
  const log = o.log ?? (() => {});
  const bundlePath = resolve(o.bundlePath);
  const desc = await describe(bundlePath);
  const bundleName = desc.manifest.name;
  const app = findApp(desc, o.appId);
  const version = o.version ?? newestStable(app.versions);
  if (!version || !Object.hasOwn(app.versions, version)) {
    const supported = Object.keys(app.versions).sort(compareVersions).join(", ");
    throw new Error(`${app.name} ${version ?? "(no stable version)"} is not supported by bundle "${bundleName}" (supported: ${supported})`);
  }
  const info = app.versions[version];
  if (info.experimental && !o.force) throw new Error(`${app.name} ${version} is experimental in this bundle; add --force to patch it anyway`);
  const asset = assertSafeName("asset", fill(app.release.asset, version));
  const tag = fill(app.release.tag, version);
  const resolved = resolveSelection(app, patchesForApp(desc.patches, app.id), loadSelection(paths, app.id), {
    enable: o.enable,
    disable: o.disable,
    options: o.options,
  });
  const selection = resolved.selection;
  const warnings = [...resolved.warnings];

  // One job per app at a time; this also sweeps staging dirs that interrupted jobs left behind.
  const unlock = lockApp(paths, app.id);
  try {
    const debPath = releasePath(paths, app.id, version, asset);
    log(`Downloading ${asset}…`);
    const url = `${o.releaseBaseUrl ?? "https://github.com"}/${app.release.github}/releases/download/${tag}/${asset}`;
    const how = await downloadVerified({ url, dest: debPath, sha256: info.sha256, fetch: o.fetch });
    if (how === "replaced") log("The cached download had the wrong SHA-256, so it was downloaded again.");

    const staging = newStaging(paths, app.id);
    try {
      log("Extracting…");
      await extractDeb(debPath, staging, installSelector(app));
      const exe = statSync(join(staging, app.executable), { throwIfNoEntry: false });
      if (!exe?.isFile() || (exe.mode & 0o111) === 0) throw new Error(`the .deb has no executable file ${app.installDir}/${app.executable}`);
      const stockDesktop = takeMeta(staging, app);

      log("Patching…");
      const outDir = join(staging, ".revamp-out");
      mkdirSync(outDir);
      const job = await runSandboxed<SandboxPatchOutput>(
        { mode: "patch", bundle: bundlePath, staging, outDir, appId: app.id, version, selection, force: o.force ?? false, stockDesktop },
        { read: [staging, bundlePath], write: [outDir] },
      );
      const base = { appId: app.id, appName: app.name, version, results: job.results, logs: job.logs, dryRun: o.dryRun ?? false, warnings };
      if (job.aborted) return { ...base, installed: false, aborted: job.aborted, exitCode: 1 };
      const exitCode = job.results.some((r) => r.status === "failed" || r.status === "skipped") ? 2 : 0;
      if (o.dryRun) return { ...base, installed: false, exitCode };

      log("Repacking…");
      const asarPath = join(staging, ASAR_PATH);
      const changes = new Map(job.files.map((f) => [f, readFileSync(join(outDir, "files", ...assertAsarPath(f).split("/")))]));
      rmSync(`${asarPath}.new`, { force: true }); // the .deb could have planted a symlink here
      writeAsar(readAsar(asarPath), `${asarPath}.new`, changes);
      renameSync(`${asarPath}.new`, asarPath);
      rmSync(outDir, { recursive: true, force: true });

      log("Installing…");
      const installDir = installStaged({
        paths,
        appId: app.id,
        version,
        executable: app.executable,
        staging,
        desktopEntry: job.desktopEntry,
        receipt: {
          app: app.id,
          version,
          release: { asset, sha256: info.sha256 },
          bundle: { name: bundleName, version: desc.manifest.version, sha256: await fileSha256(bundlePath) },
          patches: job.results,
          selection,
          installedAt: new Date().toISOString(),
        },
      });
      saveSelection(paths, app.id, selection);
      return { ...base, installed: true, installDir, exitCode, warnings: [...warnings, ...environmentWarnings(app.name)] };
    } finally {
      rmSync(staging, { recursive: true, force: true }); // no-op after a successful install renamed it
    }
  } finally {
    unlock();
  }
}

/** installDir/** goes to the staging root; the stock desktop file and hicolor PNG icons (regular files only) go to .revamp-meta/. */
function installSelector(app: AppInfo): (path: string, kind: EntryKind) => string | null {
  const prefix = `${app.installDir.replace(/^\/+|\/+$/g, "")}/`;
  const desktop = app.desktopFile.replace(/^\/+/, "");
  return (p, kind) => {
    if (p.startsWith(prefix)) return p.slice(prefix.length);
    // A link's target is relative to where the .deb puts it, so moved into .revamp-meta it would point elsewhere.
    if (kind === "link") return null;
    if (p === desktop) return `${META}/stock.desktop`;
    const icon = /^usr\/share\/icons\/hicolor\/(\d+)x\d+\/apps\/([^/]+\.png)$/.exec(p);
    return icon ? `${META}/icons/${icon[1]}/${icon[2]}` : null;
  };
}

/** Reads the stock desktop entry, keeps its largest PNG icon as revamp-icon.png and removes .revamp-meta/. */
function takeMeta(staging: string, app: AppInfo): Record<string, string> {
  const meta = join(staging, META);
  try {
    const desktopPath = join(meta, "stock.desktop");
    if (!existsSync(desktopPath)) throw new Error(`the .deb has no ${app.desktopFile}`);
    const entry = parseDesktopEntry(readFileSync(desktopPath, "utf8"));
    const icons = join(meta, "icons");
    if (/^[\w.+-]+$/.test(entry.Icon ?? "") && existsSync(icons)) {
      const sizes = readdirSync(icons).map(Number).sort((a, b) => b - a);
      const size = sizes.find((s) => existsSync(join(icons, String(s), `${entry.Icon}.png`)));
      if (size !== undefined) {
        rmSync(join(staging, ICON_FILE), { force: true }); // never copy through a symlink the .deb planted
        copyFileSync(join(icons, String(size), `${entry.Icon}.png`), join(staging, ICON_FILE), constants.COPYFILE_EXCL);
      }
    }
    return entry;
  } finally {
    rmSync(meta, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/engine/test/api.test.ts packages/engine/test/deb.test.ts && npm test && npm run typecheck`
Expected: PASS. 11 api tests; `npm test` reports 126 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/api.ts packages/engine/src/deb.ts packages/engine/src/paths.ts packages/engine/test/api.test.ts
git commit -m "fix(engine): check names before downloading; guard the executable and .revamp-meta links

- Patch names and --option values are checked right after describe, and
  saved choices the bundle dropped are removed with a warning.
- The bundle's executable must be a safe relative path and a real
  executable file in the extracted app.
- Desktop and icon links are not moved into .revamp-meta, where their
  relative targets would point somewhere else.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Unlisted versions with `--force`, verified against GitHub's digest

**Model:** `sonnet` / `medium`; reviewer `opus` / `high` (trust boundary: the only download not pinned by a bundle)

**Files:**
- Modify: `packages/engine/src/download.ts` (append `releaseDigest`)
- Modify: `packages/engine/src/api.ts` (version choice, digest lookup, `untested`)
- Modify: `packages/engine/src/install.ts` (`Receipt.release.untested`)
- Modify: `packages/cli/src/format.ts` ("(untested)" labels)
- Test: `packages/engine/test/download.test.ts`, `packages/engine/test/api.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 3's `api.ts`; M1's `downloadVerified`, `DownloadError`, `formatPatchResult`, `formatInstalls`.
- Produces:
  - `releaseDigest(o: { repo: string; tag: string; asset: string; apiBaseUrl?: string; fetch?: typeof fetch }): Promise<string>`. It returns the 64-hex SHA-256 from GitHub's release API, or throws `DownloadError`:
    - `invalid GitHub repository "<repo>"` (not `owner/name`)
    - `<repo> has no release <tag> on GitHub` (HTTP 404)
    - `GET <url> failed: HTTP <status>`
    - `release <tag> of <repo> has no asset <asset>`
    - `GitHub publishes no SHA-256 for <asset> of <repo> <tag>, so it can't be verified` (missing, or not `sha256:<64 lowercase hex>`)
  - `PatchAppOptions.apiBaseUrl?: string` (tests point it at a local server).
  - `PatchAppResult.untested: boolean`. It is true when the bundle doesn't list the version.
  - `Receipt.release.untested?: boolean`, written `true`/`false` from M2 on and absent in M1 receipts.
  - Version rules in `patchApp`:
    - Not listed and no `--force`: the M1 error, now ending `; add --force to patch it anyway, verified only against GitHub's published SHA-256`.
    - Not listed with `--force`: digest lookup, then the normal job, and a warning `<App> <v> is untested: bundle "<bundle>" doesn't list it, so it was verified only against GitHub's published SHA-256.`
    - A `--version` value must be a safe name (it becomes a cache path segment and a URL part).
  - `formatPatchResult` header: `Hydra 4.1.7 (untested): 4/5 patches apply (…)` (spec §5.6). `formatInstalls` adds ` (untested)` after the version.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/test/download.test.ts`, replace:

```ts
import { downloadVerified } from "../src/download.ts";
```

with:

```ts
import { downloadVerified, releaseDigest } from "../src/download.ts";
```

Append to `packages/engine/test/download.test.ts`:

```ts

test("releaseDigest reads GitHub's SHA-256 for one release asset, and says why when it can't", async () => {
  const urls: string[] = [];
  const github =
    (status: number, json: unknown): typeof fetch =>
    async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(json), { status });
    };
  const o = { repo: "hydralauncher/hydra", tag: "v4.1.7", asset: "hydralauncher_4.1.7_amd64.deb" };
  const release = { assets: [{ name: "Hydra-4.1.7.AppImage", digest: `sha256:${"b".repeat(64)}` }, { name: o.asset, digest: `sha256:${sha}` }] };
  assert.equal(await releaseDigest({ ...o, fetch: github(200, release) }), sha);
  assert.equal(urls[0], "https://api.github.com/repos/hydralauncher/hydra/releases/tags/v4.1.7");
  await assert.rejects(releaseDigest({ ...o, fetch: github(404, {}) }), /hydralauncher\/hydra has no release v4\.1\.7 on GitHub/);
  await assert.rejects(releaseDigest({ ...o, fetch: github(403, {}) }), /HTTP 403/);
  await assert.rejects(releaseDigest({ ...o, fetch: github(200, { assets: [] }) }), /has no asset hydralauncher_4\.1\.7_amd64\.deb/);
  for (const digest of [null, "sha512:abc", `sha256:${"Z".repeat(64)}`]) {
    await assert.rejects(releaseDigest({ ...o, fetch: github(200, { assets: [{ name: o.asset, digest }] }) }), /publishes no SHA-256/);
  }
  await assert.rejects(releaseDigest({ ...o, repo: "x/../../evil", fetch: github(200, release) }), /invalid GitHub repository/);
});
```

In `packages/engine/test/api.test.ts`, replace:

```ts
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/example/demo/releases/download/v1.0.0/demo_1.0.0_amd64.deb") res.end(deb);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
```

with:

```ts
  const server = createServer((req, res) => {
    hits++;
    // 1.0.0 is listed in the bundle; 3.0.0 is not, so only GitHub's API knows its SHA-256.
    if (/^\/example\/demo\/releases\/download\/v([13])\.0\.0\/demo_\1\.0\.0_amd64\.deb$/.test(req.url!)) res.end(deb);
    else if (req.url === "/repos/example/demo/releases/tags/v3.0.0") {
      res.end(JSON.stringify({ assets: [{ name: "demo_3.0.0_amd64.deb", digest: `sha256:${sha256}` }] }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
```

In `packages/engine/test/api.test.ts`, replace:

```ts
  const opts: PatchAppOptions = {
    appId: "demo",
    bundlePath,
    paths,
    releaseBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
```

with:

```ts
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const opts: PatchAppOptions = { appId: "demo", bundlePath, paths, releaseBaseUrl: base, apiBaseUrl: base };
```

Append to `packages/engine/test/api.test.ts`:

```ts

test("an unlisted version needs --force and is verified against GitHub's published SHA-256", async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(patchApp({ ...s.opts, version: "3.0.0" }), /not supported.*add --force/);
  assert.equal(s.hits(), 0);
  const r = await patchApp({ ...s.opts, version: "3.0.0", force: true });
  assert.equal(r.exitCode, 0);
  assert.equal(r.untested, true);
  assert.match(r.warnings[0], /Demo 3\.0\.0 is untested: bundle "Demo bundle" doesn't list it/);
  const receipt = JSON.parse(readFileSync(join(appRoot(s), "3.0.0/revamp.json"), "utf8"));
  assert.equal(receipt.release.untested, true);
  assert.equal(receipt.release.sha256, createHash("sha256").update(readFileSync(join(s.paths.cache, "releases/demo/3.0.0/demo_3.0.0_amd64.deb"))).digest("hex"));
  await assert.rejects(patchApp({ ...s.opts, version: "4.0.0", force: true }), /example\/demo has no release v4\.0\.0 on GitHub/);
  assert.equal((await patchApp(s.opts)).untested, false);
});
```

In `packages/cli/test/cli.test.ts`, replace:

```ts
    version: "4.1.6",
    installed: true,
```

with:

```ts
    version: "4.1.6",
    untested: false,
    installed: true,
```

In `packages/cli/test/cli.test.ts`, replace:

```ts
  assert.match(formatPatchResult({ ...r, installed: false, aborted: 'required patch "X" failed', exitCode: 1 }), /nothing installed: required patch "X" failed/);
});

test("formatInstalls lists versions and marks the current one", () => {
```

with:

```ts
  assert.match(formatPatchResult({ ...r, installed: false, aborted: 'required patch "X" failed', exitCode: 1 }), /nothing installed: required patch "X" failed/);
  assert.match(formatPatchResult({ ...r, version: "4.1.7", untested: true }), /^Hydra 4\.1\.7 \(untested\): 1\/2 patches apply/);
});

test("formatInstalls lists versions and marks the current and untested ones", () => {
```

In `packages/cli/test/cli.test.ts`, replace:

```ts
    "hydra 4.1.6 (current)  installed 2026-10-14 21:30  Recently downloaded sort",
  );
});
```

with:

```ts
    "hydra 4.1.6 (current)  installed 2026-10-14 21:30  Recently downloaded sort",
  );
  const forced = { ...receipt("4.1.7"), release: { asset: "a", sha256: "a", untested: true } };
  assert.match(formatInstalls([{ appId: "hydra", current: "4.1.6", versions: [{ version: "4.1.7", receipt: forced }] }]), /^hydra 4\.1\.7 \(untested\)  installed/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/engine/test/download.test.ts packages/engine/test/api.test.ts packages/cli/test/cli.test.ts`
Expected: FAIL. `download.test.ts` can't import `releaseDigest`. The new api test gets `Demo 3.0.0 is not supported … (supported: 1.0.0, 2.0.0)` without `add --force`. The two CLI format tests miss "(untested)".

- [ ] **Step 3: Implement**

Append to `packages/engine/src/download.ts`:

```ts

export interface DigestOptions {
  /** "owner/repo" */
  repo: string;
  tag: string;
  asset: string;
  /** Tests point this at a local server; defaults to https://api.github.com. */
  apiBaseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * The SHA-256 GitHub publishes for a release asset (its `digest` field). Only versions a bundle doesn't list
 * are verified this way, because the bundle has no hash for them.
 */
export async function releaseDigest(o: DigestOptions): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) throw new DownloadError(`invalid GitHub repository "${o.repo}"`);
  const url = `${o.apiBaseUrl ?? "https://api.github.com"}/repos/${o.repo}/releases/tags/${encodeURIComponent(o.tag)}`;
  const res = await (o.fetch ?? fetch)(url, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } });
  if (res.status === 404) throw new DownloadError(`${o.repo} has no release ${o.tag} on GitHub`);
  if (!res.ok) throw new DownloadError(`GET ${url} failed: HTTP ${res.status}`);
  const release = (await res.json()) as { assets?: Array<{ name?: unknown; digest?: unknown }> };
  const asset = release.assets?.find((a) => a.name === o.asset);
  if (!asset) throw new DownloadError(`release ${o.tag} of ${o.repo} has no asset ${o.asset}`);
  const sha256 = typeof asset.digest === "string" ? /^sha256:([0-9a-f]{64})$/.exec(asset.digest)?.[1] : undefined;
  if (!sha256) throw new DownloadError(`GitHub publishes no SHA-256 for ${o.asset} of ${o.repo} ${o.tag}, so it can't be verified`);
  return sha256;
}
```

In `packages/engine/src/install.ts`, replace:

```ts
  release: { asset: string; sha256: string };
```

with:

```ts
  /** untested: the bundle didn't list the version; it was verified against GitHub's published SHA-256. Absent in M1 receipts. */
  release: { asset: string; sha256: string; untested?: boolean };
```

In `packages/engine/src/api.ts`, replace:

```ts
import { downloadVerified, fileSha256 } from "./download.ts";
```

with:

```ts
import { downloadVerified, fileSha256, releaseDigest } from "./download.ts";
```

In `packages/engine/src/api.ts`, replace:

```ts
  /** Tests point this at a local server; defaults to https://github.com. */
  releaseBaseUrl?: string;
```

with:

```ts
  /** Tests point this at a local server; defaults to https://github.com. */
  releaseBaseUrl?: string;
  /** Tests point this at a local server; defaults to https://api.github.com. */
  apiBaseUrl?: string;
```

In `packages/engine/src/api.ts`, replace:

```ts
  version: string;
  results: PatchResult[];
```

with:

```ts
  version: string;
  /** The bundle doesn't list this version; it was verified only against GitHub's published SHA-256. */
  untested: boolean;
  results: PatchResult[];
```

In `packages/engine/src/api.ts`, replace:

```ts
  const version = o.version ?? newestStable(app.versions);
  if (!version || !Object.hasOwn(app.versions, version)) {
    const supported = Object.keys(app.versions).sort(compareVersions).join(", ");
    throw new Error(`${app.name} ${version ?? "(no stable version)"} is not supported by bundle "${bundleName}" (supported: ${supported})`);
  }
  const info = app.versions[version];
  if (info.experimental && !o.force) throw new Error(`${app.name} ${version} is experimental in this bundle; add --force to patch it anyway`);
```

with:

```ts
  const version = o.version ?? newestStable(app.versions);
  if (!version) throw new Error(`bundle "${bundleName}" has no stable ${app.name} version; pass --version`);
  assertSafeName("version", version);
  const info = Object.hasOwn(app.versions, version) ? app.versions[version] : undefined;
  if (!info && !o.force) {
    const supported = Object.keys(app.versions).sort(compareVersions).join(", ");
    throw new Error(
      `${app.name} ${version} is not supported by bundle "${bundleName}" (supported: ${supported}); ` +
        "add --force to patch it anyway, verified only against GitHub's published SHA-256",
    );
  }
  if (info?.experimental && !o.force) throw new Error(`${app.name} ${version} is experimental in this bundle; add --force to patch it anyway`);
  const untested = !info;
```

In `packages/engine/src/api.ts`, replace:

```ts
  const warnings = [...resolved.warnings];
```

with:

```ts
  const warnings = [...resolved.warnings];
  if (untested) warnings.push(`${app.name} ${version} is untested: bundle "${bundleName}" doesn't list it, so it was verified only against GitHub's published SHA-256.`);
```

In `packages/engine/src/api.ts`, replace:

```ts
    const debPath = releasePath(paths, app.id, version, asset);
    log(`Downloading ${asset}…`);
    const url = `${o.releaseBaseUrl ?? "https://github.com"}/${app.release.github}/releases/download/${tag}/${asset}`;
    const how = await downloadVerified({ url, dest: debPath, sha256: info.sha256, fetch: o.fetch });
```

with:

```ts
    let sha256 = info?.sha256;
    if (!sha256) {
      log(`Looking up GitHub's SHA-256 for ${asset}…`);
      sha256 = await releaseDigest({ repo: app.release.github, tag, asset, apiBaseUrl: o.apiBaseUrl, fetch: o.fetch });
    }
    const debPath = releasePath(paths, app.id, version, asset);
    log(`Downloading ${asset}…`);
    const url = `${o.releaseBaseUrl ?? "https://github.com"}/${app.release.github}/releases/download/${tag}/${asset}`;
    const how = await downloadVerified({ url, dest: debPath, sha256, fetch: o.fetch });
```

In `packages/engine/src/api.ts`, replace:

```ts
      const base = { appId: app.id, appName: app.name, version, results: job.results, logs: job.logs, dryRun: o.dryRun ?? false, warnings };
```

with:

```ts
      const base = { appId: app.id, appName: app.name, version, untested, results: job.results, logs: job.logs, dryRun: o.dryRun ?? false, warnings };
```

In `packages/engine/src/api.ts`, replace:

```ts
          release: { asset, sha256: info.sha256 },
```

with:

```ts
          release: { asset, sha256, untested },
```

In `packages/cli/src/format.ts`, replace:

```ts
  const lines = [`${r.appName} ${r.version}: ${applied}/${ran.length} patches apply (${outcome})`];
```

with:

```ts
  const lines = [`${r.appName} ${r.version}${r.untested ? " (untested)" : ""}: ${applied}/${ran.length} patches apply (${outcome})`];
```

In `packages/cli/src/format.ts`, replace:

```ts
      lines.push(`${a.appId} ${v.version}${v.version === a.current ? " (current)" : ""}  installed ${when}  ${patches.join(", ")}`.trimEnd());
```

with:

```ts
      const tags = `${v.version === a.current ? " (current)" : ""}${v.receipt.release.untested ? " (untested)" : ""}`;
      lines.push(`${a.appId} ${v.version}${tags}  installed ${when}  ${patches.join(", ")}`.trimEnd());
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/engine/test/download.test.ts packages/engine/test/api.test.ts packages/cli/test/cli.test.ts && npm test && npm run typecheck`
Expected: PASS. `npm test` reports 128 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/download.ts packages/engine/src/api.ts packages/engine/src/install.ts packages/cli/src/format.ts packages/engine/test/download.test.ts packages/engine/test/api.test.ts packages/cli/test/cli.test.ts
git commit -m "feat: patch unlisted versions with --force, verified against GitHub's digest

A version the bundle doesn't list is checked against the SHA-256 GitHub
publishes for the release asset, and the result, receipt and list
output are labeled untested (spec 4.3 step 2, 5.6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `revamp patches <app>` and `--option` in the CLI

**Model:** `sonnet` / `medium`

**Files:**
- Modify: `packages/engine/src/api.ts` (add `listPatches`), `packages/engine/src/index.ts` (export it)
- Modify: `packages/cli/src/main.ts`, `packages/cli/src/format.ts`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `findApp`, `newestStable`, `describe` (`api.ts`); `patchesForApp`, `PatchInfo` (`job.ts`); `PatchAppOptions.options` (Task 3).
- Produces:
  - `interface PatchListing { bundle: Manifest; app: AppInfo; version: string; listed: boolean; patches: Array<PatchInfo & { required: boolean; compatible: boolean }> }`.
  - `listPatches(bundlePath: string, appId: string, version?: string): Promise<PatchListing>`. It shows the app's own and universal patches in bundle order, judged for `version` (default: the newest stable listed version). This is the `patches.list` method the M5 GUI will call.
  - `formatPatchList(l: PatchListing): string`. Each patch gets a state: `[required]`, `[on by default]`, `[off by default]` (universal ones), or `[only for <versions>]`. Then its description, and one `--option "<patch>:<key>=<type>"` line per option.
  - CLI: `revamp patches <app> [--version <v>] [--bundle <file>]`, and `--option "<patch>:<key>=<value>"` (repeatable) on `revamp patch`.

Real output for the official bundle (built in Task 8) looks like this:

```
Hydra 4.1.6, from bundle "Revamp official" 0.2.0
  Disable self-update  [required]
      Turns off the app's built-in updater (electron-updater), so it never installs releases over the stock app. Revamp handles updates instead.
  Side-by-side identity  [required]
      Gives the patched copy its own menu name and window class (Electron's desktopName), so it doesn't merge with the stock app in menus and panels.
      --option "Side-by-side identity:claimLinks=<bool>"  Open app links in the Revamped copy, default true
          When off, the Revamped copy never registers itself for the app's links, so links keep opening the stock app.
  Use the bundled UI  [on by default]
      …
```

- [ ] **Step 1: Write the failing tests**

In `packages/cli/test/cli.test.ts`, replace:

```ts
import type { PatchAppResult } from "@revamp/engine";
import { formatInstalls, formatPatchResult } from "../src/format.ts";
```

with:

```ts
import type { PatchAppResult, PatchListing } from "@revamp/engine";
import { writeDemoBundle } from "../../engine/test/helpers/demo.ts";
import { formatInstalls, formatPatchList, formatPatchResult } from "../src/format.ts";
```

Append to `packages/cli/test/cli.test.ts`:

```ts

test("formatPatchList shows each patch's state, description and options", () => {
  const listing: PatchListing = {
    bundle: { name: "Revamp official", version: "0.2.0", minEngine: "0.2.0", author: "a", license: "GPL-3.0-only", source: "s" },
    app: { id: "hydra", name: "Hydra", release: { github: "o/r", tag: "v{version}", asset: "a" }, installDir: "opt/Hydra", executable: "h", desktopFile: "d", versions: {}, required: ["Core"] },
    version: "4.1.7",
    listed: false,
    patches: [
      { name: "Core", description: "Always on.", apps: null, default: false, required: true, compatible: true, options: { claimLinks: { type: "bool", title: "Claim links", description: "Keep links.", default: true } } },
      { name: "Sort", description: "", apps: [{ app: "hydra", versions: ["4.1.6"] }], default: true, required: false, compatible: false, options: {} },
      { name: "Universal", description: "", apps: null, default: false, required: false, compatible: true, options: {} },
    ],
  };
  assert.equal(
    formatPatchList(listing),
    [
      'Hydra 4.1.7 (not in this bundle: patching it needs --force), from bundle "Revamp official" 0.2.0',
      "  Core  [required]",
      "      Always on.",
      '      --option "Core:claimLinks=<bool>"  Claim links, default true',
      "          Keep links.",
      "  Sort  [only for 4.1.6]",
      "  Universal  [off by default]",
    ].join("\n"),
  );
});

test("revamp patches lists a bundle's patches for an app; bad --option fails before downloading", () => {
  const dir = mkdtempSync(join(tmpdir(), "revamp-cli-bundle-"));
  const bundle = join(dir, "demo.mjs");
  writeDemoBundle(bundle, { sha256: "a".repeat(64) });
  const r = cli(["patches", "demo", "--bundle", bundle]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Demo 1.0.0, from bundle "Demo bundle" 1.0.0\n  Say goodbye  [on by default]\n');
  const bad = cli(["patch", "demo", "--bundle", bundle, "--option", "Say goodbye=1"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /revamp: --option "Say goodbye=1" must look like "<patch>:<key>=<value>"/);
  assert.match(cli(["patches", "nope", "--bundle", bundle]).stderr, /has no app "nope"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test packages/cli/test/cli.test.ts`
Expected: FAIL with `SyntaxError: The requested module '../src/format.ts' does not provide an export named 'formatPatchList'`.

- [ ] **Step 3: Implement**

In `packages/engine/src/api.ts`, replace:

```ts
import { ASAR_PATH, patchesForApp, type AppInfo, type BundleDescription, type SandboxPatchOutput } from "./job.ts";
```

with:

```ts
import { ASAR_PATH, patchesForApp, type AppInfo, type BundleDescription, type PatchInfo, type SandboxPatchOutput } from "./job.ts";
```

In `packages/engine/src/api.ts`, replace:

```ts
/** installDir/** goes to the staging root; the stock desktop file and hicolor PNG icons (regular files only) go to .revamp-meta/. */
```

with:

```ts
export interface PatchListing {
  bundle: BundleDescription["manifest"];
  app: AppInfo;
  version: string;
  /** False when the bundle doesn't list the version: patching it needs --force. */
  listed: boolean;
  patches: Array<PatchInfo & { required: boolean; compatible: boolean }>;
}

/** What `revamp patches <app>` shows: every patch that can apply to the app, judged for one version. */
export async function listPatches(bundlePath: string, appId: string, version?: string): Promise<PatchListing> {
  const desc = await describe(bundlePath);
  const app = findApp(desc, appId);
  const v = version ?? newestStable(app.versions);
  if (!v) throw new Error(`bundle "${desc.manifest.name}" has no stable ${app.name} version; pass --version`);
  const required = new Set(app.required);
  const patches = patchesForApp(desc.patches, app.id).map((p) => ({
    ...p,
    required: required.has(p.name),
    compatible: p.apps === null || p.apps.some((a) => a.app === app.id && (a.versions === null || a.versions.includes(v))),
  }));
  return { bundle: desc.manifest, app, version: v, listed: Object.hasOwn(app.versions, v), patches };
}

/** installDir/** goes to the staging root; the stock desktop file and hicolor PNG icons (regular files only) go to .revamp-meta/. */
```

In `packages/engine/src/index.ts`, replace:

```ts
export { describe, newestStable, patchApp, type PatchAppOptions, type PatchAppResult } from "./api.ts";
```

with:

```ts
export { describe, listPatches, newestStable, patchApp, type PatchAppOptions, type PatchAppResult, type PatchListing } from "./api.ts";
```

In `packages/cli/src/format.ts`, replace:

```ts
import type { InstalledApp, PatchAppResult, PatchStatus } from "@revamp/engine";
```

with:

```ts
import type { InstalledApp, PatchAppResult, PatchListing, PatchStatus } from "@revamp/engine";
```

Append to `packages/cli/src/format.ts`:

```ts

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
```

In `packages/cli/src/main.ts`, replace:

```ts
import { listInstalls, patchApp, revampPaths, rollback, uninstall } from "@revamp/engine";
import { formatInstalls, formatPatchResult } from "./format.ts";
```

with:

```ts
import { listInstalls, listPatches, patchApp, revampPaths, rollback, uninstall } from "@revamp/engine";
import { formatInstalls, formatPatchList, formatPatchResult } from "./format.ts";
```

In `packages/cli/src/main.ts`, replace:

```ts
  revamp patch <app> [--version <v>] [--force] [--enable <patch>]... [--disable <patch>]... [--bundle <file>] [--dry-run]
  revamp list
```

with:

```ts
  revamp patch <app> [--version <v>] [--force] [--enable <patch>]... [--disable <patch>]...
               [--option "<patch>:<key>=<value>"]... [--bundle <file>] [--dry-run]
  revamp patches <app> [--version <v>] [--bundle <file>]
  revamp list
```

In `packages/cli/src/main.ts`, replace:

```ts
      disable: { type: "string", multiple: true },
      bundle: { type: "string" },
```

with:

```ts
      disable: { type: "string", multiple: true },
      option: { type: "string", multiple: true },
      bundle: { type: "string" },
```

In `packages/cli/src/main.ts`, replace:

```ts
        disable: values.disable,
        dryRun: values["dry-run"],
```

with:

```ts
        disable: values.disable,
        options: values.option,
        dryRun: values["dry-run"],
```

In `packages/cli/src/main.ts`, replace:

```ts
    case "list":
      console.log(formatInstalls(listInstalls(paths)));
```

with:

```ts
    case "patches":
      console.log(formatPatchList(await listPatches(values.bundle ?? DEFAULT_BUNDLE, needApp(), values.version)));
      return 0;
    case "list":
      console.log(formatInstalls(listInstalls(paths)));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/cli/test/cli.test.ts && npm test && npm run typecheck`
Expected: PASS. 5 CLI tests; `npm test` reports 130 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/api.ts packages/engine/src/index.ts packages/cli/src/main.ts packages/cli/src/format.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): revamp patches <app> and --option

listPatches shows every patch that can apply to an app for one version:
required, default, options and the versions it was tested with.
--option values are checked before downloading and saved like
--enable and --disable.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hydra locales (internal patch); the sorts use real translation keys

**Model:** `sonnet` / `medium`

**Files:**
- Create: `bundles/official/src/hydra/locales.ts`
- Create: `bundles/official/test/fixtures/hydra-4.1.6/locales-excerpt.js`
- Modify: `bundles/official/src/hydra/recently-downloaded-sort.ts`
- Modify: `bundles/official/src/index.ts` (manifest `0.2.0`)
- Test: `bundles/official/test/patches.test.ts`

**Interfaces:**
- Consumes: `Match.resolve()`, `Capture.resolve()` and description-named internal patches (Task 1); `ENGINE_VERSION` `0.2.0` (Task 1).
- Produces:
  - `hydraLocales`: an internal patch (no `name`, `description: "Hydra locales"`). Other Hydra patches reach it through `dependsOn`.
  - `LIBRARY_STRINGS: Record<string, Record<string, string>>`: the fork's `library` strings for `en`, `bg` and `pt-BR`. Task 7's label key `sort_recently_added` is already in it.
  - `localeResources`: the fingerprint `i18n resources`.
  - Recently downloaded sort now `dependsOn: [useBundledUi, hydraLocales]` and uses `t("sort_recently_downloaded", { ns: "library" })` / `t("sort_recently_downloaded")`, exactly like the fork (no `defaultValue`). Hydra's i18n has `fallbackLng: "en"`, so other languages show the English string.

**How the patch finds each language (verified on the real 4.1.6 renderer, `out/renderer/assets/index-Cpo9haoY.js`):**
- Line 114950: `const resources = { "pt-BR": ptBR$1, "pt-PT": ptPT, en: en$1, …, bg, … }`. The values are identifiers; `bg` is shorthand for `bg: bg`.
- `resolve()` on `en$1` gives the locale object (line 113205) `{ language_name: language_name$y, …, library: library$y, … }`.
- `find("library: $NS")` then `$NS.resolve()` gives `const library$y = { "library": "Library", … }`, a one-line object literal. Some values use single quotes.
- The patch appends the missing keys after the namespace's last property, so each language gets one insert.
- Two decoys, both pinned by tests:
  - The renderer's `LANGUAGE_FLAG_MAP` has the same keys with string values (the `where` check needs identifiers).
  - `out/main/index.js:46428` has the main process's own `resources` table. The `where` check needs a file under `out/renderer/`. The real release caught this one: without the check the fingerprint fails at step `count` with 2 matches.
- Text can't identify a language: German's `library$q` has the same English "Most played" as `en`.

- [ ] **Step 1: Write the fixture and the failing tests**

Create `bundles/official/test/fixtures/hydra-4.1.6/locales-excerpt.js`:

```js
// Excerpts from Hydra 4.1.6 out/renderer/assets/index-Cpo9haoY.js (MIT, github.com/hydralauncher/hydra),
// trimmed for Revamp's patch tests: 4 of 33 locales, 2 namespaces each, plus the flag map (a decoy).
const LANGUAGE_FLAG_MAP = {
  "pt-BR": "BR",
  "pt-PT": "PT",
  en: "US",
  de: "DE",
  bg: "BG"
};
const language_name$y = "English";
const library$y = { "library": "Library", "sort_title_desc": "Title (Z-A)", "sort_most_played": "Most played", "delete_collection_description": 'Are you sure you want to delete "{{collectionName}}"?' };
const en$1 = {
  language_name: language_name$y,
  library: library$y
};
const language_name$w = "Português (Brasil)";
const library$w = { "library": "Biblioteca", "sort_title_desc": "Título (Z-A)", "sort_most_played": "Mais jogados" };
const ptBR$1 = {
  language_name: language_name$w,
  library: library$w
};
const language_name$q = "Deutsch";
const library$q = { "library": "Library", "sort_title_desc": "Title (Z-A)", "sort_most_played": "Most played" };
const de$1 = {
  language_name: language_name$q,
  library: library$q
};
const language_name$7 = "Български";
const library$7 = { "library": "Библиотека", "sort_title_desc": "Заглавие (Я-A)", "sort_most_played": "Най-играни" };
const bg = {
  language_name: language_name$7,
  library: library$7
};
const resources = {
  "pt-BR": ptBR$1,
  en: en$1,
  de: de$1,
  bg
};
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
const RENDERER = "out/renderer/assets/index-Cpo9haoY.js";
```

with:

```ts
const RENDERER = "out/renderer/assets/index-Cpo9haoY.js";
const LOCALES = "out/renderer/assets/locales-excerpt.js"; // in the real release this is part of RENDERER
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
    [RENDERER]: fixture("renderer-excerpt.js"),
```

with:

```ts
    [RENDERER]: fixture("renderer-excerpt.js"),
    [LOCALES]: fixture("locales-excerpt.js"),
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
test("all M1 patches apply to the Hydra 4.1.6 excerpts", () => {
  const out = job();
  assert.equal(out.aborted, undefined);
  assert.deepEqual(out.results.map((r) => [r.name, r.status]), [
    ["Disable self-update", "applied"],
    ["Side-by-side identity", "applied"],
    ["Use the bundled UI", "applied"],
    ["Recently downloaded sort", "applied"],
  ]);
});
```

with:

```ts
test("every Hydra patch applies to the Hydra 4.1.6 excerpts", () => {
  const out = job();
  assert.equal(out.aborted, undefined);
  assert.deepEqual(out.results.map((r) => [r.name, r.status, r.internal]), [
    ["Disable self-update", "applied", false],
    ["Side-by-side identity", "applied", false],
    ["Use the bundled UI", "applied", false],
    ["Recently downloaded sort", "applied", false],
    ["(internal patch #4: Hydra locales)", "applied", true],
  ]);
});
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
      '{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { ns: "library", defaultValue: "Recently downloaded" }), icon: jsxRuntimeExports.jsx(DownloadIcon, { size: 14 }) }',
```

with:

```ts
      '{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { ns: "library" }), icon: jsxRuntimeExports.jsx(DownloadIcon, { size: 14 }) }',
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
  assert.ok(code.includes('{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { defaultValue: "Recently downloaded" }) }'));
```

with:

```ts
  assert.ok(code.includes('{ value: "recently_downloaded", label: t2("sort_recently_downloaded") }'));
```

Append to `bundles/official/test/patches.test.ts`:

```ts

test("Hydra locales adds the fork's strings to en, bg and pt-BR only, found through resources", () => {
  const code = job().outputs.get(LOCALES)!.toString();
  const line = (name: string) => code.split("\n").find((l) => l.startsWith(`const ${name} = `))!;
  assert.ok(line("library$y").endsWith(`"sort_recently_downloaded": "Recently downloaded", "sort_recently_added": "Recently added" };`));
  assert.ok(line("library$7").endsWith(`"sort_recently_downloaded": "Наскоро изтеглени", "sort_recently_added": "Наскоро добавени" };`));
  assert.ok(line("library$w").endsWith(`"sort_recently_downloaded": "Baixados recentemente", "sort_recently_added": "Adicionados recentemente" };`));
  // German has the same English "Most played" as en, so text can't tell locales apart; resources can.
  assert.equal(line("library$q"), fixture("locales-excerpt.js").split("\n").find((l) => l.startsWith("const library$q = ")));
  assert.ok(code.includes('const LANGUAGE_FLAG_MAP = {\n  "pt-BR": "BR",\n  "pt-PT": "PT",\n  en: "US",\n  de: "DE",\n  bg: "BG"\n};'));
});

test("Hydra locales leaves the main process's own copy of the translations alone", () => {
  const out = job(NONE, hydraFiles({ "out/main/locales.js": fixture("locales-excerpt.js") }));
  assert.equal(out.results.find((r) => r.internal)!.status, "applied");
  assert.equal(out.outputs.has("out/main/locales.js"), false);
  assert.ok(out.outputs.has(LOCALES));
});

test("Hydra locales keeps keys a release already has", () => {
  const locales = fixture("locales-excerpt.js").replace('"sort_most_played": "Mais jogados"', '"sort_most_played": "Mais jogados", "sort_recently_added": "Upstream"');
  const code = job(NONE, hydraFiles({ [LOCALES]: locales })).outputs.get(LOCALES)!.toString();
  const ptBR = code.split("\n").find((l) => l.startsWith("const library$w = "))!;
  assert.ok(ptBR.endsWith(`"sort_recently_added": "Upstream", "sort_recently_downloaded": "Baixados recentemente" };`));
});

test("the sorts are skipped, naming the internal patch, when the locales can't be found", () => {
  const out = job(NONE, hydraFiles({ [LOCALES]: fixture("locales-excerpt.js").replace("  bg\n};", "  bg: \"bg\"\n};") }));
  const locales = out.results.find((r) => r.internal)!;
  assert.equal(locales.status, "failed");
  assert.match(locales.message!, /fingerprint "i18n resources" failed at step "where:values are locale objects": 2 match\(es\) before this check, 0 after/);
  for (const name of ["Recently downloaded sort"]) {
    const r = out.results.find((x) => x.name === name)!;
    assert.equal(r.status, "skipped");
    assert.equal(r.message, 'dependency "(internal patch #4: Hydra locales)" failed');
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test bundles/official/test/patches.test.ts`
Expected: 6 of 12 tests FAIL. The first test finds no internal patch. "Recently downloaded sort edits the five places" still sees `defaultValue`. The 4 locale tests find no locales output or no internal patch (`Cannot read properties of undefined`).

- [ ] **Step 3: Implement**

Create `bundles/official/src/hydra/locales.ts`:

```ts
import { definePatch, fingerprint, type Match } from "@revamp/sdk";

/** The fork's strings for Hydra's `library` namespace, by Hydra's language code. Other languages fall back to en. */
export const LIBRARY_STRINGS: Record<string, Record<string, string>> = {
  en: { sort_recently_downloaded: "Recently downloaded", sort_recently_added: "Recently added" },
  bg: { sort_recently_downloaded: "Наскоро изтеглени", sort_recently_added: "Наскоро добавени" },
  "pt-BR": { sort_recently_downloaded: "Baixados recentemente", sort_recently_added: "Adicionados recentemente" },
};

/**
 * The renderer's i18next `resources`: language code → locale object. Found by its keys, never by translated text
 * ("Most played" is in 23 locales). The main process has its own copy, and the renderer's flag map has the same
 * keys with string values, hence the checks.
 */
export const localeResources = fingerprint({
  name: "i18n resources",
  strings: ['"pt-BR"'],
  pattern: 'const $RESOURCES = { "pt-BR": $PT_BR, en: $EN, bg: $BG }',
  where: {
    "in the renderer": (m) => m.file.startsWith("out/renderer/"),
    "values are locale objects": (m) => [m.$PT_BR, m.$EN, m.$BG].every((c) => c.node?.type === "Identifier"),
  },
});

/** Internal "Hydra locales": adds LIBRARY_STRINGS to each locale's `library` namespace, skipping keys it already has. */
export const hydraLocales = definePatch({
  description: "Hydra locales",
  execute(ctx) {
    const resources = ctx.match(localeResources);
    const locales: Record<string, Match> = { en: resources.$EN.resolve(), bg: resources.$BG.resolve(), "pt-BR": resources.$PT_BR.resolve() };
    for (const [lang, strings] of Object.entries(LIBRARY_STRINGS)) {
      const library = locales[lang].find("library: $NS").$NS.resolve();
      const entries = library.findAll("$KEY: $VALUE");
      if (entries.length === 0) throw new Error(`the ${lang} library namespace (${library.file}:${library.line}) is empty`);
      const have = new Set(entries.map((e) => String(e.$KEY.node!.value ?? e.$KEY.node!.name)));
      const add = Object.entries(strings).filter(([key]) => !have.has(key));
      if (add.length > 0) entries.at(-1)!.insertAfter(add.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", "));
    }
  },
});
```

In `bundles/official/src/hydra/recently-downloaded-sort.ts`, replace:

```ts
import { useBundledUi } from "./bundled-ui.ts";
```

with:

```ts
import { useBundledUi } from "./bundled-ui.ts";
import { hydraLocales } from "./locales.ts";
```

In `bundles/official/src/hydra/recently-downloaded-sort.ts`, delete:

```ts
const LABEL = "Recently downloaded";

```

In `bundles/official/src/hydra/recently-downloaded-sort.ts`, replace:

```ts
  dependsOn: [useBundledUi], // edits the bundled renderer, which Hydra only loads with this patch
```

with:

```ts
  dependsOn: [useBundledUi, hydraLocales], // edits the bundled renderer (loaded only with useBundledUi) and uses locale keys
```

In `bundles/official/src/hydra/recently-downloaded-sort.ts`, replace:

```ts
      `{ value: "recently_downloaded", label: ${entry.$T}("sort_recently_downloaded", { ns: "library", defaultValue: "${LABEL}" }), icon: ${entry.$JSX}.jsx(${icon.$ICON}, { size: 14 }) }`,
```

with:

```ts
      `{ value: "recently_downloaded", label: ${entry.$T}("sort_recently_downloaded", { ns: "library" }), icon: ${entry.$JSX}.jsx(${icon.$ICON}, { size: 14 }) }`,
```

In `bundles/official/src/hydra/recently-downloaded-sort.ts`, replace:

```ts
    option.insertAfter(`{ value: "recently_downloaded", label: ${option.$T}("sort_recently_downloaded", { defaultValue: "${LABEL}" }) }`);
```

with:

```ts
    option.insertAfter(`{ value: "recently_downloaded", label: ${option.$T}("sort_recently_downloaded") }`);
```

In `bundles/official/src/index.ts`, replace:

```ts
  version: "0.1.0",
  minEngine: "0.1.0",
```

with:

```ts
  version: "0.2.0",
  minEngine: "0.2.0", // Hydra locales uses Match.resolve()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test bundles/official/test/patches.test.ts && npm test && npm run typecheck`
Expected: PASS. 12 Hydra bundle tests; `npm test` reports 134 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add bundles/official/src/hydra/locales.ts bundles/official/src/hydra/recently-downloaded-sort.ts bundles/official/src/index.ts bundles/official/test/patches.test.ts bundles/official/test/fixtures/hydra-4.1.6/locales-excerpt.js
git commit -m "feat(bundle): Hydra locales adds the fork's en, bg and pt-BR library strings

The internal patch walks i18next's resources table to each language's
library namespace with Match.resolve(), so it never relies on
translated text. Recently downloaded sort now uses plain i18n keys.
Bundle 0.2.0 needs engine 0.2.0.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Recently added sort

**Model:** `sonnet` / `medium`

**Files:**
- Create: `bundles/official/src/hydra/recently-added-sort.ts`
- Modify: `bundles/official/src/index.ts`
- Test: `bundles/official/test/patches.test.ts`

**Interfaces:**
- Consumes: M1's fingerprints from `recently-downloaded-sort.ts`, unchanged: `librarySortSwitch` (captures `$A`, `$B`), `octiconDownload` (`$ICON`, `$CREATE`), `sidebarSortEntry` (`$T`, `$JSX`), `sidebarSortSet`, `librarySortList`, `libraryFilterOption` (`$T`). Also `useBundledUi` and `hydraLocales` (Task 6), and `formatPatchResult` from `packages/cli/src/format.ts` (test only).
- Produces: `recentlyAddedSort`, named `"Recently added sort"`, compatible with Hydra 4.1.6, on by default, `dependsOn: [useBundledUi, hydraLocales]`.

**Behavior (the fork's commit `ecad7c208`):**
- Sorting: newest `addedToLibraryAt` first. A missing or unparsable date counts as 0, so those games come last. Ties fall through to the existing `return compareLibraryGamesByTitle(a2, b2)` after the switch, which puts them in title order.
- The fork computes `new Date(x ?? 0).getTime()`, which gives `NaN` for a bad date and makes the comparator inconsistent. `|| 0` turns that into 0.
- Five places, the same ones M1's Recently downloaded sort edits: the sort switch case, the sidebar sort menu entry (with a calendar icon), `SIDEBAR_SORT_OPTIONS`, the library filter options and the library sort list.
- Labels: `t("sort_recently_added", { ns: "library" })` in the sidebar and `t("sort_recently_added")` on the library page. Task 6 added the strings.
- Icon: stock Hydra has no `CalendarIcon`. The patch declares `var CalendarIcon$revamp = createIconComponent("CalendarIcon", "octicon octicon-calendar", …)` right after `DownloadIcon`. `createIconComponent` is the `$CREATE` capture and the path element is built with the app's JSX runtime (`$JSX`), so the patch needs no React reference. `jsxRuntimeExports` is declared at line 360 of the real renderer, long before `DownloadIcon` (line 67275).
- Menu order: *Recently played, Recently added, Recently downloaded, Most played* (see "Design choices" at the top).

- [ ] **Step 1: Write the failing tests**

In `bundles/official/test/patches.test.ts`, replace:

```ts
import * as bundle from "../src/index.ts";
```

with:

```ts
import { formatPatchResult } from "../../../packages/cli/src/format.ts";
import * as bundle from "../src/index.ts";
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
    ["Use the bundled UI", "applied", false],
    ["Recently downloaded sort", "applied", false],
```

with:

```ts
    ["Use the bundled UI", "applied", false],
    ["Recently added sort", "applied", false],
    ["Recently downloaded sort", "applied", false],
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
  assert.match(status("Recently downloaded sort").message!, /dependency "Use the bundled UI" failed/);
```

with:

```ts
  assert.match(status("Recently downloaded sort").message!, /dependency "Use the bundled UI" failed/);
  assert.equal(status("Recently added sort").status, "skipped");
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
  for (const name of ["Recently downloaded sort"]) {
```

with:

```ts
  for (const name of ["Recently added sort", "Recently downloaded sort"]) {
```

Append to `bundles/official/test/patches.test.ts`:

```ts

test("Recently added sort edits the same five places; menus read played, added, downloaded", () => {
  const code = job().outputs.get(RENDERER)!.toString();
  assert.equal(code.match(/"recently_added"/g)?.length, 5);
  assert.ok(code.includes('{ value: "recently_added", label: t2("sort_recently_added", { ns: "library" }), icon: jsxRuntimeExports.jsx(CalendarIcon$revamp, { size: 14 }) }'));
  assert.ok(code.includes('{ value: "recently_added", label: t2("sort_recently_added") }'));
  assert.match(code, /var CalendarIcon\$revamp = createIconComponent\("CalendarIcon", "octicon octicon-calendar", function\(\) \{\n  return \{ "16": \{ "width": 16, "path": jsxRuntimeExports\.jsx\("path", \{ d: "M4\.75 0a/);
  for (const list of [/"recently_played",\s*"recently_added",\s*"recently_downloaded",\s*"most_played"/g, /value: "recently_played"[^]*?value: "recently_added"[^]*?value: "recently_downloaded"[^]*?value: "most_played"/g]) {
    assert.equal(code.match(list)?.length, 2, String(list));
  }
});

test("Recently added sort orders newest first, then games without a date, each group by title", () => {
  const code = job().outputs.get(RENDERER)!.toString();
  const source = code.slice(code.indexOf("const sortLibraryGames$1"), code.indexOf('}, "sortLibraryGames$1");') + 25);
  const sortLibraryGames = new Function(
    "__name",
    "compareLibraryGamesByTitle",
    "getPlayTimeDifference",
    "getMostPlayedDifference",
    `${source}\nreturn sortLibraryGames$1;`,
  )((f: unknown) => f, (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title), () => 0, () => 0);
  const games = [
    { title: "No date B" },
    { title: "Old", addedToLibraryAt: "2024-01-01T00:00:00.000Z" },
    { title: "Bad date", addedToLibraryAt: "not a date" },
    { title: "New", addedToLibraryAt: new Date("2026-10-01").getTime() },
    { title: "No date A", addedToLibraryAt: null },
  ];
  assert.deepEqual(sortLibraryGames(games, "recently_added").map((g: { title: string }) => g.title), ["New", "Old", "Bad date", "No date A", "No date B"]);
});

test("a release the patches don't fit gives the spec's report: what applies, and where each miss failed", () => {
  const changed = fixture("renderer-excerpt.js").replace('case "recently_played": {', 'case "recently_played_v2": {');
  const input = { appId: "hydra", version: "4.1.7", selection: NONE, force: true, stockDesktop: STOCK };
  const out = runJob(bundle, input, memoryStore(hydraFiles({ [RENDERER]: changed })));
  const report = formatPatchResult({
    appId: "hydra",
    appName: "Hydra",
    version: "4.1.7",
    untested: true,
    results: out.results,
    installed: false,
    dryRun: true,
    exitCode: 2,
    warnings: [],
    logs: out.logs,
  });
  const miss =
    'fingerprint "library sort switch" failed at step "pattern": strings matched 1 file(s): out/renderer/assets/index-Cpo9haoY.js; ' +
    'pattern [...$GAMES].sort(($A, $B) => { switch ($BY) { case "recently_played": { $$$ } } $$$ }) matched 0 nodes';
  assert.equal(
    report,
    [
      "Hydra 4.1.7 (untested): 3/5 patches apply (dry run, nothing installed)",
      "  ✓ Disable self-update (required)",
      "  ✓ Side-by-side identity (required)",
      "  ✓ Use the bundled UI",
      "  ✗ Recently added sort",
      `      ${miss}`,
      "  ✗ Recently downloaded sort",
      `      ${miss}`,
    ].join("\n"),
  );
});
```

The last test is the spec's §5.6 acceptance check on a modified fixture. It runs every Hydra patch against a renderer whose sort switch no longer fits, as if 4.1.7 had shipped that change. The report must name each failing patch, the fingerprint, the step and the file. Task 9 repeats this against a real older release.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test bundles/official/test/patches.test.ts`
Expected: 6 of 15 tests FAIL. "Recently added sort" is missing from the results, so the first test and both skip tests fail. `"recently_added"` occurs 0 times. `sortLibraryGames` returns plain title order (`Bad date, New, No date A, No date B, Old`). The report shows `3/4 patches apply`.

- [ ] **Step 3: Implement**

Create `bundles/official/src/hydra/recently-added-sort.ts`:

```ts
import { definePatch } from "@revamp/sdk";
import { hydra } from "../apps.ts";
import { useBundledUi } from "./bundled-ui.ts";
import { hydraLocales } from "./locales.ts";
import {
  libraryFilterOption,
  librarySortList,
  librarySortSwitch,
  octiconDownload,
  sidebarSortEntry,
  sidebarSortSet,
} from "./recently-downloaded-sort.ts";

/** Octicons 19 `calendar` at 16 px (MIT), the icon the fork uses. Stock Hydra doesn't ship it. */
const CALENDAR_16 =
  "M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Zm10.75-4H2.75a.25.25 0 0 0-.25.25V6h11V3.75a.25.25 0 0 0-.25-.25Z";
const CALENDAR_ICON = "CalendarIcon$revamp";

export const recentlyAddedSort = definePatch({
  name: "Recently added sort",
  description: "Adds 'Recently added' (newest first; games without an added date last) to the library and sidebar sort menus.",
  compatibleWith: [{ app: hydra, versions: ["4.1.6"] }],
  dependsOn: [useBundledUi, hydraLocales],
  execute(ctx) {
    // Same five places as Recently downloaded sort. Inserts at the same spot keep patch order, and patches run in
    // name order, so the menus read: Recently played, Recently added, Recently downloaded.
    const sort = ctx.match(librarySortSwitch);
    // A missing or unreadable date counts as 0 (1970), so those games sort last, then by title like every sort.
    const added = (game: string) => `(new Date(${game}.addedToLibraryAt ?? 0).getTime() || 0)`;
    sort.find('case "recently_played": { $$$ }').insertAfter(
      `case "recently_added": {\n` +
        `        const difference = ${added(`${sort.$B}`)} - ${added(`${sort.$A}`)};\n` +
        `        if (difference !== 0) return difference;\n` +
        `        break;\n` +
        `      }`,
    );

    const icon = ctx.match(octiconDownload);
    const entry = ctx.match(sidebarSortEntry);
    if (icon.file !== entry.file) throw new Error(`DownloadIcon (${icon.file}) and the sidebar sort menu (${entry.file}) are in different files`);
    icon.insertAfter(
      `var ${CALENDAR_ICON} = ${icon.$CREATE}("CalendarIcon", "octicon octicon-calendar", function() {\n` +
        `  return { "16": { "width": 16, "path": ${entry.$JSX}.jsx("path", { d: "${CALENDAR_16}" }) } };\n` +
        `});`,
    );
    entry.insertAfter(
      `{ value: "recently_added", label: ${entry.$T}("sort_recently_added", { ns: "library" }), icon: ${entry.$JSX}.jsx(${CALENDAR_ICON}, { size: 14 }) }`,
    );

    ctx.match(sidebarSortSet).find('"recently_played"').insertAfter('"recently_added"');
    ctx.match(librarySortList).find('"recently_played"').insertAfter('"recently_added"');

    const option = ctx.match(libraryFilterOption);
    option.insertAfter(`{ value: "recently_added", label: ${option.$T}("sort_recently_added") }`);
  },
});
```

In `bundles/official/src/index.ts`, replace:

```ts
import { recentlyDownloadedSort } from "./hydra/recently-downloaded-sort.ts";
```

with:

```ts
import { recentlyAddedSort } from "./hydra/recently-added-sort.ts";
import { recentlyDownloadedSort } from "./hydra/recently-downloaded-sort.ts";
```

In `bundles/official/src/index.ts`, replace:

```ts
export const patches = [disableSelfUpdate, sideBySideIdentity, useBundledUi, recentlyDownloadedSort];
```

with:

```ts
export const patches = [disableSelfUpdate, sideBySideIdentity, useBundledUi, recentlyAddedSort, recentlyDownloadedSort];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test bundles/official/test/patches.test.ts && npm test && npm run typecheck`
Expected: PASS. 15 Hydra bundle tests; `npm test` reports 137 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add bundles/official/src/hydra/recently-added-sort.ts bundles/official/src/index.ts bundles/official/test/patches.test.ts
git commit -m "feat(bundle): Recently added sort for Hydra

Newest addedToLibraryAt first; games without a usable date sort last,
then by title. Reuses M1's five fingerprints and adds Octicons' calendar
icon, which stock Hydra doesn't ship.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Heroic 2.22.3 and Hide Deals link

**Model:** `sonnet` / `medium`

**Files:**
- Modify: `bundles/official/src/apps.ts` (add `heroic`)
- Create: `bundles/official/src/heroic/hide-deals-link.ts`
- Modify: `bundles/official/src/index.ts`
- Create: `bundles/official/test/fixtures/heroic-2.22.3/App-excerpt.js`, `bundles/official/test/fixtures/heroic-2.22.3/main-excerpt.js`
- Test: `bundles/official/test/heroic.test.ts` (new)

**Interfaces:**
- Consumes: `defineApp`, `definePatch`, `fingerprint` (SDK); `disableSelfUpdate`, `sideBySideIdentity` (M1, universal).
- Produces:
  - `heroic: AppDef` with id `heroic` and name `Heroic`.
  - `dealsLink`: fingerprint `sidebar Deals link`.
  - `hideDealsLink`: patch `Hide Deals link`, Heroic 2.22.3, on by default.

**The app definition comes from the real `.deb` listing** (`dpkg-deb -c Heroic-2.22.3-linux-amd64.deb`, 135 entries):
- `./opt/Heroic/heroic` is the 219,806,968-byte Electron binary (mode `0755`), so `installDir: "opt/Heroic"` and `executable: "heroic"`.
- `./opt/Heroic/resources/app.asar` (31,766,234 bytes) and `app.asar.unpacked/` (21 entries).
- `./usr/share/applications/heroic.desktop`, with `Name=Heroic Games Launcher`, `Exec=/opt/Heroic/heroic %U`, `Icon=heroic`, `StartupWMClass=Heroic` and `MimeType=x-scheme-handler/heroic;`.
- `./usr/share/icons/hicolor/{16x16,32x32,48x48,64x64,128x128,256x256,512x512,1024x1024}/apps/heroic.png`. The installer picks the 1024 one.
- No symlinks or hardlinks anywhere.

**What the patches meet in Heroic's code** (`app.asar`; the main process is not minified):
- `build/main/main.js` bundles electron-updater: `AppUpdater.isUpdaterActive()` and `AppImageUpdater.isUpdaterActive()`. M1's `updaterActive` fingerprint (scope `all`, count `many`) matches both.
- It calls `app.setAsDefaultProtocolClient("heroic")` once, inside `if (…)`. With `claimLinks=false` that becomes `if (false)`, and Heroic logs "Failed to register protocol with OS.".
- `package.json` has `name: "heroic"` and no `desktopName`, so Side-by-side identity's `desktopName: "revamp-heroic.desktop"` gives the Revamped window its own class. Heroic doesn't call `app.setDesktopName`.
- `build/assets/App.js` (1 MB, minified, 199 lines) holds the sidebar. The only `"discounts.sidebar"` is `d.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),dataTour:"sidebar-discounts"})`, an item of a JSX children array. Replacing that call with `null` makes React render nothing in its place. The `/discounts` route itself stays.
- Heroic's renderer is loaded from `build/index.html` inside the asar; it has no remote-UI fallback like Hydra's.

- [ ] **Step 1: Write the fixtures and the failing test**

Create `bundles/official/test/fixtures/heroic-2.22.3/App-excerpt.js`:

```js
// Excerpt from Heroic 2.22.3 build/assets/App.js (GPL-3.0-only, github.com/Heroic-Games-Launcher/HeroicGamesLauncher),
// trimmed for Revamp's patch tests. The other sidebar links are decoys the patch must not touch.
function SidebarLinks(){const{t:e}=ae(),t=Je(),f=!0,h=!1,S="epic";return d.jsxs("div",{className:"SidebarLinks Sidebar__section","data-tour":"sidebar-menu",children:[!f&&d.jsx(ut,{icon:K9,label:e("button.login","Login"),url:"/login",dataTour:"sidebar-login"}),d.jsx(ut,{isActiveFallback:t.pathname.includes("gamepage"),url:"/",icon:q9,label:e("Library"),dataTour:"sidebar-library"}),d.jsxs("div",{className:"SidebarItemWithSubmenu",children:[d.jsx(ut,{isActiveFallback:t.pathname.includes("store"),url:`/store/${S}`,icon:Y9,label:e("stores","Stores"),dataTour:"sidebar-stores"}),h&&d.jsxs("div",{className:"SidebarSubmenu",children:[d.jsx(ut,{className:"SidebarLinks__subItem",url:"/store/epic",label:e("store","Epic Store")})]})]}),d.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),dataTour:"sidebar-discounts"}),d.jsx("div",{className:"divider"})]})}
```

Create `bundles/official/test/fixtures/heroic-2.22.3/main-excerpt.js`:

```js
// Excerpts from Heroic 2.22.3 build/main/main.js (GPL-3.0-only, github.com/Heroic-Games-Launcher/HeroicGamesLauncher),
// trimmed for Revamp's patch tests: the bundled electron-updater and the protocol registration.
"use strict";
const require$$1$5 = require("electron");
class AppUpdater {
  checkForUpdates() {
    if (!this.isUpdaterActive()) {
      return Promise.resolve(null);
    }
    return this.doCheckForUpdates();
  }
  isUpdaterActive() {
    const isEnabled2 = this.app.isPackaged || this.forceDevUpdateConfig;
    if (!isEnabled2) {
      this._logger.info("Skip checkForUpdates because application is not packed and dev update config is not forced");
      return false;
    }
    return true;
  }
}
class AppImageUpdater extends AppUpdater {
  isUpdaterActive() {
    if (process.env["APPIMAGE"] == null && !this.forceDevUpdateConfig) {
      if (process.env["SNAP"] == null) {
        this._logger.warn("APPIMAGE env is not defined, current application is not an AppImage");
      } else {
        this._logger.info("SNAP env is defined, updater is disabled");
      }
      return false;
    }
    return super.isUpdaterActive();
  }
}
function registerProtocol() {
  if (process.env.CI !== "e2e" && !require$$1$5.app.isDefaultProtocolClient("heroic")) {
    if (require$$1$5.app.setAsDefaultProtocolClient("heroic")) {
      logInfo("Registered protocol with OS.", LogPrefix.Backend);
    } else {
      logWarning("Failed to register protocol with OS.", LogPrefix.Backend);
    }
  } else {
    logWarning("Protocol already registered.", LogPrefix.Backend);
  }
}
```

Create `bundles/official/test/heroic.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore, runJob, type Selection } from "@revamp/engine";
import * as bundle from "../src/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/heroic-2.22.3/${name}`, import.meta.url), "utf8");
const APP = "build/assets/App.js";
const MAIN = "build/main/main.js";
const STOCK = {
  Name: "Heroic Games Launcher",
  Exec: "/opt/Heroic/heroic %U",
  Icon: "heroic",
  StartupWMClass: "Heroic",
  MimeType: "x-scheme-handler/heroic;",
  Categories: "Game;",
};
const NONE: Selection = { enable: [], disable: [], options: {} };
const files = (app = fixture("App-excerpt.js")) => ({
  "package.json": '{\n  "name": "heroic",\n  "version": "2.22.3",\n  "main": "build/main/main.js"\n}\n',
  [MAIN]: fixture("main-excerpt.js"),
  [APP]: app,
});
const job = (selection = NONE, app?: string) =>
  runJob(bundle, { appId: "heroic", version: "2.22.3", selection, force: false, stockDesktop: STOCK }, memoryStore(files(app)));

test("every Heroic patch applies to the Heroic 2.22.3 excerpts, and no Hydra patch runs", () => {
  const out = job();
  assert.equal(out.aborted, undefined);
  assert.deepEqual(out.results.map((r) => [r.name, r.status]), [
    ["Disable self-update", "applied"],
    ["Side-by-side identity", "applied"],
    ["Hide Deals link", "applied"],
  ]);
});

test("Hide Deals link replaces only the Deals link with null", () => {
  const code = job().outputs.get(APP)!.toString();
  const original = fixture("App-excerpt.js");
  const deals = 'd.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),dataTour:"sidebar-discounts"})';
  assert.ok(original.includes(deals));
  assert.equal(code, original.replace(deals, "null"));
});

test("Disable self-update and Side-by-side identity work on Heroic's main process too", () => {
  const out = job();
  const main = out.outputs.get(MAIN)!.toString();
  assert.equal(main.match(/isUpdaterActive\(\) \{\s*return false;\s*\}/g)?.length, 2);
  assert.equal(JSON.parse(out.outputs.get("package.json")!.toString()).desktopName, "revamp-heroic.desktop");
  assert.deepEqual(out.desktopEntry, { ...STOCK, Name: "Heroic Games Launcher (Revamped)", StartupWMClass: "revamp-heroic" });
  const keepLinks = job({ ...NONE, options: { "Side-by-side identity": { claimLinks: false } } }).outputs.get(MAIN)!.toString();
  assert.ok(keepLinks.includes("if (false) {"));
});

test("a sidebar without the Deals link fails only Hide Deals link, naming the fingerprint and step", () => {
  const out = job(NONE, fixture("App-excerpt.js").replace('url:"/discounts"', 'url:"/deals"'));
  const r = out.results.find((x) => x.name === "Hide Deals link")!;
  assert.equal(r.status, "failed");
  assert.match(r.message!, /fingerprint "sidebar Deals link" failed at step "pattern": strings matched 1 file\(s\): build\/assets\/App\.js; pattern .* matched 0 nodes/);
  assert.equal(out.aborted, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test bundles/official/test/heroic.test.ts`
Expected: FAIL with `bundle "Revamp official" has no app "heroic"`.

- [ ] **Step 3: Implement**

In `bundles/official/src/apps.ts`, replace:

```ts
  required: [disableSelfUpdate, sideBySideIdentity],
});
```

with:

```ts
  required: [disableSelfUpdate, sideBySideIdentity],
});

/** From the Heroic-2.22.3-linux-amd64.deb listing: no symlinks; icons from 16x16 to 1024x1024. */
export const heroic = defineApp({
  id: "heroic",
  name: "Heroic",
  release: { github: "Heroic-Games-Launcher/HeroicGamesLauncher", tag: "v{version}", asset: "Heroic-{version}-linux-amd64.deb" },
  installDir: "opt/Heroic",
  executable: "heroic",
  desktopFile: "usr/share/applications/heroic.desktop",
  versions: {
    "2.22.3": { sha256: "f89eed7e0eb900fbe3051edfedbe7532db14328241cbf8c1fb766462dfc0b849" },
  },
  required: [disableSelfUpdate, sideBySideIdentity],
});
```

Create `bundles/official/src/heroic/hide-deals-link.ts`:

```ts
import { definePatch, fingerprint } from "@revamp/sdk";
import { heroic } from "../apps.ts";

/** Minified: `d.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),…})` in build/assets/App.js. */
export const dealsLink = fingerprint({
  name: "sidebar Deals link",
  strings: ['"discounts.sidebar"'],
  pattern: '$R.jsx($LINK, { url: "/discounts" })',
});

export const hideDealsLink = definePatch({
  name: "Hide Deals link",
  description: "Removes the Deals link from Heroic's sidebar.",
  compatibleWith: [{ app: heroic, versions: ["2.22.3"] }],
  execute(ctx) {
    ctx.match(dealsLink).replace("null"); // React renders nothing for null children
  },
});
```

In `bundles/official/src/index.ts`, replace:

```ts
import { hydra } from "./apps.ts";
```

with:

```ts
import { heroic, hydra } from "./apps.ts";
import { hideDealsLink } from "./heroic/hide-deals-link.ts";
```

In `bundles/official/src/index.ts`, replace:

```ts
export const apps = [hydra];
export const patches = [disableSelfUpdate, sideBySideIdentity, useBundledUi, recentlyAddedSort, recentlyDownloadedSort];
```

with:

```ts
export const apps = [hydra, heroic];
export const patches = [disableSelfUpdate, sideBySideIdentity, useBundledUi, recentlyAddedSort, recentlyDownloadedSort, hideDealsLink];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test bundles/official/test/*.test.ts && npm test && npm run typecheck && npm run build -w @revamp/bundle-official`
Expected: PASS. 4 Heroic tests and 15 Hydra tests; `npm test` reports 141 tests, 0 failures; `tsc` prints nothing; esbuild writes `dist/official.mjs` (about 12 kB).

- [ ] **Step 5: Commit**

```bash
git add bundles/official/src/apps.ts bundles/official/src/heroic/hide-deals-link.ts bundles/official/src/index.ts bundles/official/test/heroic.test.ts bundles/official/test/fixtures/heroic-2.22.3/App-excerpt.js bundles/official/test/fixtures/heroic-2.22.3/main-excerpt.js
git commit -m "feat(bundle): Heroic 2.22.3 with Hide Deals link

The app definition comes from the real .deb listing. Disable self-update
and Side-by-side identity apply unchanged; Hide Deals link replaces the
sidebar's Deals item with null.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Real-release integration tests, README and M2 acceptance

**Model:** `sonnet` / `medium` (the final whole-branch review afterwards is `opus` / `high`)

**Files:**
- Modify: `test/integration/hydra.test.ts`
- Create: `test/integration/heroic.test.ts`, `test/integration/hydra-mismatch.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above; `npm run test:integration` (M1) builds the bundle and runs `test/integration/*.test.ts` with `REVAMP_INTEGRATION=1`.
- Produces: three opt-in tests against real releases. They share the real download cache `~/.cache/revamp/releases` and install into throwaway homes:
  - Hydra 4.1.6: every patch applied, the locale strings and both sorts in the patched renderer.
  - Heroic 2.22.3: installs, the Deals link is gone, the updater is off, and the menu entry is correct.
  - Hydra 4.0.6 forced (unlisted): the spec §5.6 report. Measured: 3/5 patches apply, exit code 2, and both sorts fail at fingerprint `sidebar sort menu entry`, step `pattern`, which 4.0.6 doesn't have yet.

The downloads are 149 MB (Hydra 4.1.6), 128 MB (Heroic 2.22.3) and 154 MB (Hydra 4.0.6), each once. With all three cached the run takes about a minute. Measured: Hydra 21 s, Heroic 12 s, Hydra 4.0.6 19 s.

- [ ] **Step 1: Extend the Hydra test and write the two new ones**

In `test/integration/hydra.test.ts`, replace:

```ts
  "M1: patch the real Hydra 4.1.6 release into a throwaway home",
```

with:

```ts
  "patch the real Hydra 4.1.6 release into a throwaway home",
```

In `test/integration/hydra.test.ts`, replace:

```ts
        ["Use the bundled UI", "applied"],
        ["Recently downloaded sort", "applied"],
      ],
    );
```

with:

```ts
        ["Use the bundled UI", "applied"],
        ["Recently added sort", "applied"],
        ["Recently downloaded sort", "applied"],
      ],
    );
    assert.deepEqual(r.results.filter((x) => x.internal).map((x) => [x.name, x.status]), [["(internal patch #4: Hydra locales)", "applied"]]);
```

In `test/integration/hydra.test.ts`, replace:

```ts
    assert.equal(patched[0].match(/"recently_downloaded"/g)?.length, 5);
```

with:

```ts
    assert.equal(patched[0].match(/"recently_downloaded"/g)?.length, 5);
    assert.equal(patched[0].match(/"recently_added"/g)?.length, 5);
    for (const strings of [
      '"sort_recently_downloaded": "Recently downloaded", "sort_recently_added": "Recently added" };',
      '"sort_recently_downloaded": "Наскоро изтеглени", "sort_recently_added": "Наскоро добавени" };',
      '"sort_recently_downloaded": "Baixados recentemente", "sort_recently_added": "Adicionados recentemente" };',
    ]) {
      assert.equal(patched[0].split(strings).length, 2, strings);
    }
```

Create `test/integration/heroic.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile } from "@electron/asar";
import { patchApp, revampPaths } from "@revamp/engine";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "patch the real Heroic 2.22.3 release into a throwaway home",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), "revamp-it-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const paths = { ...revampPaths({ HOME: home }), cache: revampPaths().cache };
    const r = await patchApp({ appId: "heroic", bundlePath: BUNDLE, paths, log: (l) => console.log(l) });

    assert.equal(r.exitCode, 0, JSON.stringify(r.results, null, 2));
    assert.deepEqual(
      r.results.map((x) => [x.name, x.status]),
      [
        ["Disable self-update", "applied"],
        ["Side-by-side identity", "applied"],
        ["Hide Deals link", "applied"],
      ],
    );
    const apps = join(paths.data, "apps/heroic");
    assert.equal(readlinkSync(join(apps, "current")), "2.22.3");
    const dir = join(apps, "2.22.3");
    const asar = join(dir, "resources/app.asar");
    assert.equal(statSync(join(dir, "heroic")).mode & 0o111, 0o111);
    assert.ok(existsSync(join(dir, "resources/app.asar.unpacked")));

    assert.equal(JSON.parse(extractFile(asar, "package.json").toString()).desktopName, "revamp-heroic.desktop");
    const sidebar = extractFile(asar, "build/assets/App.js").toString();
    assert.equal(sidebar.includes('"discounts.sidebar"'), false);
    assert.ok(sidebar.includes(']}),null,d.jsx("div",{className:"divider"})'));
    const main = extractFile(asar, "build/main/main.js").toString();
    assert.equal(main.match(/isUpdaterActive\(\) \{\s*return false;\s*\}/g)?.length, 2);

    const desktop = readFileSync(join(paths.applications, "revamp-heroic.desktop"), "utf8");
    assert.match(desktop, /^Name=Heroic Games Launcher \(Revamped\)$/m);
    assert.match(desktop, /^StartupWMClass=revamp-heroic$/m);
    assert.match(desktop, /^Exec=".*\/apps\/heroic\/current\/heroic" %U$/m);
    assert.match(desktop, /^MimeType=x-scheme-handler\/heroic;$/m);
    const icon = /^Icon=(.*)$/m.exec(desktop)![1];
    assert.equal(statSync(icon).size, 260747); // the 1024x1024 PNG, the largest in the .deb
  },
);
```

Create `test/integration/hydra-mismatch.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchApp, revampPaths } from "@revamp/engine";
import { formatPatchResult } from "../../packages/cli/src/format.ts";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "an older real Hydra release, forced, reports which patches miss and where (spec §5.6)",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    // 4.0.6 is not in the bundle: --force verifies it against GitHub's published SHA-256 (154 MB, cached once).
    const home = mkdtempSync(join(tmpdir(), "revamp-it-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const paths = { ...revampPaths({ HOME: home }), cache: revampPaths().cache };
    const r = await patchApp({ appId: "hydra", bundlePath: BUNDLE, paths, version: "4.0.6", force: true, dryRun: true, log: (l) => console.log(l) });
    const report = formatPatchResult(r);
    console.log(report);

    assert.equal(r.untested, true);
    assert.equal(r.installed, false);
    assert.equal(r.exitCode, 2);
    assert.match(report, /^Hydra 4\.0\.6 \(untested\): 3\/5 patches apply \(dry run, nothing installed\)$/m);
    const status = Object.fromEntries(r.results.filter((x) => !x.internal).map((x) => [x.name, x.status]));
    assert.deepEqual(status, {
      "Disable self-update": "applied",
      "Side-by-side identity": "applied",
      "Use the bundled UI": "applied",
      "Recently added sort": "failed",
      "Recently downloaded sort": "failed",
    });
    for (const x of r.results.filter((y) => y.status === "failed")) {
      assert.match(x.message!, /^fingerprint "[^"]+" failed at step "(strings|pattern|regex|where:[^"]+|count)": \S/, x.name);
    }
    assert.deepEqual(readdirSync(join(paths.data, "apps/hydra")), []);
  },
);
```

- [ ] **Step 2: Run the integration tests**

Run: `npm run test:integration` (needs the network the first time; up to about 430 MB of downloads)
Expected: 3 tests pass. The Hydra test prints `patch job took … s (download cached)` (about 20 s on the owner's machine). The mismatch test prints the report:

```
Hydra 4.0.6 (untested): 3/5 patches apply (dry run, nothing installed)
  ✓ Disable self-update (required)
  ✓ Side-by-side identity (required)
  ✓ Use the bundled UI
  ✗ Recently added sort
      fingerprint "sidebar sort menu entry" failed at step "pattern": strings matched 2 file(s): out/main/index.js, out/renderer/assets/index-CQPZR5Go.js; pattern ({ value: "recently_played", label: $T("recently_played", { ns: "library" }), icon: $JSX.jsx($ICON, { size: 14 }) }) matched 0 nodes
  ✗ Recently downloaded sort
      fingerprint "sidebar sort menu entry" failed at step "pattern": strings matched 2 file(s): out/main/index.js, out/renderer/assets/index-CQPZR5Go.js; pattern ({ value: "recently_played", label: $T("recently_played", { ns: "library" }), icon: $JSX.jsx($ICON, { size: 14 }) }) matched 0 nodes
Note: Hydra 4.0.6 is untested: bundle "Revamp official" doesn't list it, so it was verified only against GitHub's published SHA-256.
```

If GitHub's API rate limit (60 requests an hour without a token) is hit, the mismatch test fails with `HTTP 403`; wait and rerun.

- [ ] **Step 3: Update the README**

In `README.md`, replace:

````markdown
Patch Hydra with the bundle in this repo:

```bash
npm run build -w @revamp/bundle-official
npm run revamp -- patch hydra
```
````

with:

````markdown
Patch Hydra or Heroic with the bundle in this repo:

```bash
npm run build -w @revamp/bundle-official
npm run revamp -- patches hydra
npm run revamp -- patch hydra
```

`revamp patches <app>` lists an app's patches: which are required or on by default, their options, and the
versions they were tested with. `patch` takes `--enable "<patch>"`, `--disable "<patch>"` and
`--option "<patch>:<key>=<value>"`, and remembers them for the next run. A version the bundle doesn't list
needs `--version <v> --force`; it is verified only against the SHA-256 GitHub publishes and is labeled untested.
````

- [ ] **Step 4: Manual acceptance (the owner)**

Run each command and check the result:
1. `npm run revamp -- patches heroic` lists Disable self-update and Side-by-side identity as `[required]` and Hide Deals link as `[on by default]`.
2. `npm run revamp -- patch heroic` installs "Heroic Games Launcher (Revamped)". Launch it from the menu: the sidebar has no "Deals" link. It starts without the Flatpak's logins (spec §3.1). A stock Heroic that is running takes over, because they share the single-instance lock.
3. `npm run revamp -- patch hydra` reinstalls Revamped Hydra 4.1.6. In the library sort menu and the sidebar sort menu, "Recently added" sits between "Recently played" and "Recently downloaded". Switch Hydra to Български: the entries read "Наскоро добавени" and "Наскоро изтеглени".
4. `npm run revamp -- patch hydra --option "Side-by-side identity:claimLinks=false"`, then `cat ~/.config/revamp/apps/hydra.json` shows `"claimLinks": false`, and the menu entry has no `MimeType=` line. Run `npm run revamp -- patch hydra --option "Side-by-side identity:claimLinks=true"` to switch it back.
5. `npm run revamp -- patch hydra --enable "Hide Deals link"` fails at once with `Hydra has no patch "Hide Deals link" (see: revamp patches hydra)`, and nothing is downloaded.

- [ ] **Step 5: Commit**

```bash
git add test/integration/hydra.test.ts test/integration/heroic.test.ts test/integration/hydra-mismatch.test.ts README.md
git commit -m "test: real Heroic 2.22.3 and forced Hydra 4.0.6 integration tests; docs: M2 commands

The Hydra 4.0.6 run is the spec's M2 acceptance check for fingerprint
misses on a real release: 3/5 patches apply and both sorts name the
fingerprint and step that missed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
