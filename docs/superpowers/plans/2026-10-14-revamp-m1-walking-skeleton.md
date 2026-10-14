# Revamp M1 (walking skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `revamp patch hydra` downloads Hydra 4.1.6, verifies it, extracts it, applies three patches in a sandbox, repacks `app.asar` and installs "Hydra (Revamped)" next to the stock app in seconds.

The three patches are Disable self-update, Side-by-side identity and Recently downloaded sort.

**Architecture:**
- An npm-workspaces monorepo running TypeScript natively on Node 26.
- `@revamp/sdk` declares apps, patches and fingerprints.
- `@revamp/engine` does the work:
  - download and SHA-256 verification
  - `.deb` and asar I/O
  - the by-example pattern matcher
  - edits, the patch graph and the sandboxed runner
  - install
- `@revamp/cli` is a thin `parseArgs` front end.
- `bundles/official` holds the Hydra app definition and the first three patches, built by esbuild into one `.mjs`.

**Tech Stack:**
- Node 26.12 (native TS type stripping, `node:test`, `--permission`)
- TypeScript (`tsc --noEmit` only)
- acorn 8.19, xz-decompress 0.2.3, esbuild
- `@electron/asar` 4.3 (test oracle only)

**Spec:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`. Read it first; this plan implements its M1 slice (§4.3 flow, §4.4 sandbox dev mode, §4.5 layout, §5 SDK/engine model, §10 M1 rows, §12 testing).

**Validated before hand-off.** Every code block in this plan was extracted into a scratch repo and run on Node 26.12.0 with TypeScript 7.0.2:
- `npm test`: 104/104 unit tests pass, and `tsc` is clean.
- `npm run test:integration`: passes against the real `hydralauncher_4.1.6_amd64.deb`. All 3 patches applied; the patch job took 31–36 s with a cached download, most of it xz extraction.

Executors should transcribe the code, not redesign it. A failure most likely means a typo or a wrong Node version.

**Deliberately not in this plan** (later milestones per the spec):
- installing *unlisted* versions verified against GitHub's asset digest (M2; M1 refuses unlisted versions)
- `Match.resolve()` and Hydra locale patches (M2)
- the `--option` flag (M2)
- `revamp patches` (M2)
- the SEA binary and its `--node-options` sandbox spawn (M4)
- `bundle.json`/`patches.json` generation (M4)
- sources, check, update and the timer (M4)
- the GUI (M5)

**Model per task** (kickoff "Subagent model choice"):
- Every implementer gets the model/effort named in its task header.
- Escalate one tier on failure.
- The final whole-branch review is `opus`/`high`.

## Global Constraints

- **Node:** Node ≥ 26 (installed at `~/.local/node-26`, v26.12.0). Every shell command in this plan assumes `export PATH="$HOME/.local/node-26/bin:$PATH"` first. Root `.npmrc` has `engine-strict=true`.
- **TypeScript runs natively, erasable syntax only:**
  - Not allowed: `enum`, `namespace`, constructor parameter properties (`constructor(readonly x: T)`), `import x = require()`.
  - Type-only imports use `import type`.
  - Relative imports include the `.ts` extension.
- **Every `package.json`:**
  - `"type": "module"`
  - `"license": "GPL-3.0-only"`
  - workspace packages export `./src/index.ts`
- **Runtime dependencies:**
  - engine: `acorn`, `xz-decompress` (+ workspace `@revamp/sdk`)
  - root devDependencies only: `typescript`, `@types/node`, `esbuild`, `@electron/asar`
  - No native addons anywhere.
- **Downloads:**
  - Never execute downloaded files.
  - Never read or modify `/opt/Hydra` (tests included).
- **Hydra 4.1.6 release pin:**
  - asset `hydralauncher_4.1.6_amd64.deb`, tag `v4.1.6`, repo `hydralauncher/hydra`
  - SHA-256 `fc075d4c9334fa7462cdfe4faef625f61e6933df48fa03e1939b635951147363`
  - The `.deb` contains `opt/Hydra/**`, `usr/share/applications/hydralauncher.desktop` and `usr/share/icons/hicolor/512x512/apps/hydralauncher.png`.
  - Its `data.tar.xz` is GNU tar with `././@LongLink` entries; regular files and dirs only.
- **State paths (spec §4.5):**
  - apps: `$XDG_DATA_HOME/revamp/apps/<app>/<version>/`
  - `current` symlink
  - `.staging-*` job dirs
  - `$XDG_DATA_HOME/applications/revamp-<app>.desktop`
  - `$XDG_CONFIG_HOME/revamp/apps/<app>.json`
  - `$XDG_CACHE_HOME/revamp/releases/<app>/<version>/<asset>`
- **Tests:**
  - `node:test` + `node:assert/strict`.
  - Unit tests never touch the network or the real home dirs; use temp dirs and local HTTP servers.
  - Run all unit tests with `npm test` from the repo root.
- **Commits:**
  - Conventional commits (`feat:`, `test:`, `chore:`, `docs:`).
  - Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Bundles:** a single ESM file with no imports and no top-level `await` (it is loaded with `require(esm)`).

## Review Focus

These are inputs and conditions the spec implies but no feature test would naturally hit. Each line names the expected behavior and the task that pins it with a test:

1. **Untrusted names reaching the filesystem.** Bundle-supplied app ids, versions, asset names and `addFile` paths, and child-reported output paths, are rejected when they contain `..`, `/` or leading dots. No read or write ever leaves the intended directory. Pinned in Tasks 2, 5, 9 and 13.
2. **A failed job must not damage an existing install.** Staging is deleted, `current` still points at the old version, and the old version's files are intact. Pinned in Task 13.
3. **Re-patching the version that is currently installed** (e.g. after changing the selection) replaces it atomically, keeps `current` valid and is not pruned. Pinned in Task 12.
4. **Corrupt or partial downloads are never used.** A cached file with the wrong hash or a stale `.part` file is replaced, and unverified bytes are never extracted. Pinned in Task 3.
5. **Unsupported requests fail before downloading,** with a message naming what is supported. This covers an unknown app, an unlisted version, an experimental version without `--force`, and a bundle that needs a newer engine. Pinned in Task 13.

## File Structure

```
package.json  .npmrc  tsconfig.json  .gitignore  LICENSE
docs/electron-sandbox.md                         user doc for the userns sysctl warning
packages/sdk/        package.json  src/index.ts  test/sdk.test.ts
packages/engine/     package.json
  src/version.ts     ENGINE_VERSION, compareVersions
  src/paths.ts       XDG paths, safe-name checks
  src/desktop.ts     .desktop parse/serialize
  src/config.ts      Selection type, load/save/merge
  src/download.ts    fetch → .part → SHA-256 → rename
  src/deb.ts         ar + xz/gz/zst + streaming safe tar extraction
  src/asar.ts        asar read, write (copy data + append), integrity
  src/pattern.ts     acorn parse/index, by-example pattern compile/match, parentOf
  src/edits.ts       EditBuffer: per-patch splices, conflicts, apply
  src/sources.ts     SourceStore, Sources (prefilter buffers, text/parse cache)
  src/match.ts       Range / MatchImpl / CaptureImpl (list-aware edits, find)
  src/fingerprint.ts FingerprintError, Fingerprints (strings → pattern|regex → where → count)
  src/graph.ts       PatchResult, planPatches, resolveOptions
  src/job.ts         runJob (contexts, execute, finalize, propagation, apply, re-parse), describeBundle
  src/runner.ts      sandboxed child entry (describe | patch)
  src/sandbox.ts     parent spawn with --permission
  src/install.ts     staging, installStaged, current, desktop file, prune, rollback, uninstall, warnings
  src/api.ts         patchApp, describe, listInstalls, rollbackApp, uninstallApp
  src/index.ts       public exports
  test/*.test.ts  test/helpers/archives.ts  test/helpers/demo.ts  test/fixtures/
packages/cli/        package.json  src/main.ts  src/format.ts  test/format.test.ts
bundles/official/    package.json  src/index.ts  src/apps.ts
  src/universal/disable-self-update.ts  src/universal/side-by-side-identity.ts
  src/hydra/recently-downloaded-sort.ts
  test/patches.test.ts  test/fixtures/hydra-4.1.6/*.js
test/integration/hydra.test.ts
```

---

### Task 1: Workspace, Node 26 and the SDK

**Model:** `sonnet` / `medium`

**Files:**
- Create: `package.json`, `.npmrc`, `tsconfig.json`, `.gitignore`, `LICENSE`
- Create: `packages/sdk/package.json`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/test/sdk.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`@revamp/sdk`):
  - types `AstNode`, `Editable`, `Capture`, `Match`, `TextFile`, `OptionType`, `OptionDef<T>`, `Options`, `OptionValues<O>`, `PatchContext<O>`, `FingerprintDef`, `Fingerprint`, `AppVersion`, `AppDef`, `PatchDef<O>`, `Patch<O>`, `Manifest`
  - functions `fingerprint(def)`, `defineApp(def)`, `definePatch(def)`
  - object `option.{bool,string,number}`

- [ ] **Step 1: Install Node 26.12.0 next to Node 24 (owner-approved, no root)**

```bash
T=$(mktemp -d) && cd "$T" \
 && curl -fsSLO https://nodejs.org/dist/v26.12.0/node-v26.12.0-linux-x64.tar.xz \
 && curl -fsSLO https://nodejs.org/dist/v26.12.0/SHASUMS256.txt \
 && grep ' node-v26.12.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c - \
 && mkdir -p ~/.local/node-26 \
 && tar -xJf node-v26.12.0-linux-x64.tar.xz -C ~/.local/node-26 --strip-components=1 \
 && cd ~ && rm -rf "$T"
export PATH="$HOME/.local/node-26/bin:$PATH"; node --version
```
Expected: `node-v26.12.0-linux-x64.tar.xz: OK`, then `v26.12.0`.

- [ ] **Step 2: Write the root files**

`package.json`:
```json
{
  "name": "revamp",
  "private": true,
  "type": "module",
  "license": "GPL-3.0-only",
  "engines": { "node": ">=26" },
  "workspaces": ["packages/*", "bundles/*"],
  "scripts": {
    "test": "node --test \"packages/*/test/*.test.ts\" \"bundles/*/test/*.test.ts\"",
    "test:integration": "npm run build -w @revamp/bundle-official && REVAMP_INTEGRATION=1 node --test \"test/integration/*.test.ts\"",
    "typecheck": "tsc -p .",
    "revamp": "node packages/cli/src/main.ts"
  }
}
```

`.npmrc`:
```
engine-strict=true
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "esnext",
    "lib": ["esnext"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["packages/*/src", "packages/*/test", "bundles/*/src", "bundles/*/test", "test"]
}
```

`.gitignore`:
```
node_modules/
dist/
.serena/
```

`LICENSE`: copy the GPLv3 text that ships with the OS.
```bash
cp /usr/share/common-licenses/GPL-3 LICENSE
```

`packages/sdk/package.json`:
```json
{
  "name": "@revamp/sdk",
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-3.0-only",
  "exports": { ".": "./src/index.ts" }
}
```

- [ ] **Step 3: Write the failing SDK test**

`packages/sdk/test/sdk.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineApp, definePatch, fingerprint, option } from "@revamp/sdk";

const SHA = "a".repeat(64);
const base = {
  id: "demo",
  name: "Demo",
  release: { github: "o/r", tag: "v{version}", asset: "d_{version}.deb" },
  installDir: "opt/Demo",
  executable: "demo",
  desktopFile: "usr/share/applications/demo.desktop",
};

test("fingerprint needs strings and exactly one of pattern or regex", () => {
  assert.throws(() => fingerprint({ name: "x", strings: [], pattern: "f()" }), /strings must not be empty/);
  assert.throws(() => fingerprint({ name: "x", strings: ["f"] }), /exactly one of pattern or regex/);
  assert.throws(() => fingerprint({ name: "x", strings: ["f"], pattern: "f()", regex: /f/g }), /exactly one of pattern or regex/);
  assert.throws(() => fingerprint({ name: "x", strings: ["f"], regex: /f/ }), /needs the g flag/);
  assert.equal(fingerprint({ name: "x", strings: ["f"], pattern: "f()" }).kind, "fingerprint");
});

test("defineApp validates id and sha256 and defaults required to []", () => {
  assert.throws(() => defineApp({ ...base, versions: { "1.0.0": { sha256: "XYZ" } } }), /sha256/);
  assert.throws(() => defineApp({ ...base, id: "../x", versions: {} }), /app id/);
  const app = defineApp({ ...base, versions: { "1.0.0": { sha256: SHA } } });
  assert.equal(app.kind, "app");
  assert.deepEqual(app.required, []);
});

test("definePatch and option builders tag their objects", () => {
  const p = definePatch({ name: "P", options: { on: option.bool({ title: "On", default: true }) }, execute() {} });
  assert.equal(p.kind, "patch");
  assert.equal(p.options?.on.type, "bool");
  assert.equal(p.options?.on.default, true);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm install && node --test packages/sdk/test/sdk.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` (or cannot find `packages/sdk/src/index.ts`).

- [ ] **Step 5: Write the SDK**

`packages/sdk/src/index.ts`:
```ts
// @revamp/sdk: what bundle authors import. Declarations and types only; the engine does the work.

export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
}

export interface Editable {
  replace(code: string): void;
  insertBefore(code: string): void;
  insertAfter(code: string): void;
  remove(): void;
}

/** A `$NAME` or `$$$NAME` blank from a pattern, or a named group from a regex fingerprint. */
export interface Capture extends Editable {
  readonly file: string;
  /** The captured node; undefined for list captures and regex groups. */
  readonly node: AstNode | undefined;
  /** The captured nodes of a `$$$NAME` list blank. */
  readonly items: readonly AstNode[] | undefined;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  toString(): string;
}

export interface Match extends Editable {
  readonly file: string;
  /** The matched node; undefined for regex fingerprints. */
  readonly node: AstNode | undefined;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  /** Exactly one match of `pattern` inside this match. */
  find(pattern: string): Match;
  findAll(pattern: string): Match[];
  readonly [capture: `$${string}`]: Capture;
}

export interface TextFile {
  readonly path: string;
  readonly text: string;
  setText(text: string): void;
  json<T = unknown>(): T;
  setJson(value: unknown): void;
}

export type OptionType = "bool" | "string" | "number";

export interface OptionDef<T> {
  readonly kind: "option";
  readonly type: OptionType;
  title: string;
  description?: string;
  default?: T;
  /** Named presets shown to users. */
  values?: Record<string, T>;
  required?: boolean;
  /** Returns an error message, or undefined when the value is fine. */
  validate?: (value: T) => string | undefined;
}

type OptionInput<T> = Omit<OptionDef<T>, "kind" | "type">;

export const option = {
  bool: (o: OptionInput<boolean>): OptionDef<boolean> => ({ kind: "option", type: "bool", ...o }),
  string: (o: OptionInput<string>): OptionDef<string> => ({ kind: "option", type: "string", ...o }),
  number: (o: OptionInput<number>): OptionDef<number> => ({ kind: "option", type: "number", ...o }),
};

export type Options = Record<string, OptionDef<any>>;
export type OptionValues<O extends Options> = {
  [K in keyof O]: O[K] extends OptionDef<infer T> ? T | undefined : never;
};

export interface PatchContext<O extends Options = Options> {
  readonly app: { readonly id: string; readonly version: string };
  readonly options: OptionValues<O>;
  /** The single match of a `count: "one"` fingerprint. */
  match(fp: Fingerprint): Match;
  /** Every match of a `count: "many"` fingerprint. */
  matchAll(fp: Fingerprint): Match[];
  /** A text file at a fixed path inside app.asar (package.json, index.html). */
  file(path: string): TextFile;
  /** Adds a new file inside app.asar. */
  addFile(path: string, contents: string | Uint8Array): void;
  /** [Desktop Entry] keys, prefilled from the stock .desktop file. Exec and Icon are set by the installer. */
  readonly desktopEntry: Record<string, string>;
  log(message: string): void;
}

export interface FingerprintDef {
  name: string;
  /** Raw substrings that must all occur in a file before it is parsed. */
  strings: string[];
  pattern?: string;
  regex?: RegExp;
  where?: Record<string, (m: Match) => boolean>;
  count?: "one" | "many";
  /** "app" (default) skips node_modules/; "all" searches it too. */
  scope?: "app" | "all";
}

export interface Fingerprint extends Readonly<FingerprintDef> {
  readonly kind: "fingerprint";
}

export function fingerprint(def: FingerprintDef): Fingerprint {
  if (def.strings.length === 0) throw new Error(`fingerprint "${def.name}": strings must not be empty`);
  if ((def.pattern === undefined) === (def.regex === undefined)) {
    throw new Error(`fingerprint "${def.name}": set exactly one of pattern or regex`);
  }
  if (def.regex && !def.regex.global) throw new Error(`fingerprint "${def.name}": regex needs the g flag`);
  return { kind: "fingerprint", ...def };
}

export interface AppVersion {
  sha256: string;
  experimental?: boolean;
}

export interface AppDef {
  readonly kind: "app";
  id: string;
  name: string;
  /** `{version}` in tag and asset is replaced by the version. */
  release: { github: string; tag: string; asset: string };
  /** Directory of the app inside the .deb data tree, e.g. "opt/Hydra". */
  installDir: string;
  /** Executable relative to installDir. */
  executable: string;
  /** Stock desktop file inside the .deb data tree. */
  desktopFile: string;
  versions: Record<string, AppVersion>;
  /** Patches always applied for this app; users can't disable them. */
  required: Patch<any>[];
}

export function defineApp(def: Omit<AppDef, "kind" | "required"> & { required?: Patch<any>[] }): AppDef {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(def.id)) throw new Error(`invalid app id "${def.id}"`);
  for (const [version, info] of Object.entries(def.versions)) {
    if (!/^[0-9a-f]{64}$/.test(info.sha256)) {
      throw new Error(`app "${def.id}" ${version}: sha256 must be 64 lowercase hex characters`);
    }
  }
  return { kind: "app", ...def, required: def.required ?? [] };
}

export interface PatchDef<O extends Options> {
  /** Omit to make an internal patch, hidden from users and reached through dependsOn. */
  name?: string;
  description?: string;
  /** Omit for a universal patch (any app, default off unless an app requires it). */
  compatibleWith?: { app: AppDef; versions?: string[] }[];
  dependsOn?: Patch<any>[];
  default?: boolean;
  options?: O;
  execute(ctx: PatchContext<O>): void;
  /** Runs after every patch has executed, in reverse order. */
  finalize?(ctx: PatchContext<O>): void;
}

export interface Patch<O extends Options = Options> extends PatchDef<O> {
  readonly kind: "patch";
}

export function definePatch<O extends Options = {}>(def: PatchDef<O>): Patch<O> {
  return { kind: "patch", ...def };
}

export interface Manifest {
  name: string;
  version: string;
  minEngine: string;
  author: string;
  license: string;
  source: string;
}
```

- [ ] **Step 6: Install dev tools, run the test and typecheck**

```bash
npm install -D typescript esbuild @electron/asar@^4.3.1
npm install -D @types/node@26 || npm install -D @types/node   # newest if no 26.x types yet
node --test packages/sdk/test/sdk.test.ts && npm run typecheck
```
Expected: `# pass 3`, `# fail 0`. Typecheck prints nothing and exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .npmrc tsconfig.json .gitignore LICENSE packages/sdk
git commit -m "feat(sdk): workspace scaffold and patch SDK declarations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Engine state utilities (versions, paths, desktop entries, selections)

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/engine/package.json`, `packages/engine/src/version.ts`, `packages/engine/src/paths.ts`, `packages/engine/src/desktop.ts`, `packages/engine/src/config.ts`
- Test: `packages/engine/test/state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `version.ts`: `ENGINE_VERSION: string`, `compareVersions(a, b): -1 | 0 | 1`
  - `paths.ts`: `interface Paths { data; config; cache; state; applications }`, `revampPaths(env?): Paths`, `appDir(p, appId): string`, `releasePath(p, appId, version, asset): string`, `assertSafeName(kind, value): string`
  - `desktop.ts`: `parseDesktopEntry(text): Record<string,string>`, `serializeDesktopEntry(entry): string`
  - `config.ts`: `interface Selection { enable: string[]; disable: string[]; options: Record<string, Record<string, unknown>> }`, `loadSelection(p, appId)`, `saveSelection(p, appId, s)`, `mergeSelection(saved, flags)`

- [ ] **Step 1: Write the engine package.json**

`packages/engine/package.json`:
```json
{
  "name": "@revamp/engine",
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-3.0-only",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@revamp/sdk": "*" }
}
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/state.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions } from "../src/version.ts";
import { assertSafeName, revampPaths } from "../src/paths.ts";
import { parseDesktopEntry, serializeDesktopEntry } from "../src/desktop.ts";
import { loadSelection, mergeSelection, saveSelection } from "../src/config.ts";

test("revampPaths follows absolute XDG variables and ignores relative ones", () => {
  assert.deepEqual(revampPaths({ HOME: "/home/u", XDG_DATA_HOME: "/d", XDG_CONFIG_HOME: "rel/ignored" }), {
    data: "/d/revamp",
    config: "/home/u/.config/revamp",
    cache: "/home/u/.cache/revamp",
    state: "/home/u/.local/state/revamp",
    applications: "/d/applications",
  });
});

test("assertSafeName rejects path tricks", () => {
  assert.equal(assertSafeName("version", "4.1.6"), "4.1.6");
  for (const bad of ["..", "../x", "a/b", ".hidden", "", "a..b", "x\0"]) {
    assert.throws(() => assertSafeName("version", bad), /unsafe version/);
  }
});

test("compareVersions orders dotted numbers", () => {
  assert.equal(compareVersions("4.1.10", "4.1.9"), 1);
  assert.equal(compareVersions("4.1.6", "4.1.6"), 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
});

test("desktop entries round-trip the [Desktop Entry] group only", () => {
  const text = "[Desktop Entry]\nName=Hydra\nExec=/opt/Hydra/hydralauncher %U\n# comment\nMimeType=x-scheme-handler/hydralauncher;\n\n[Desktop Action new]\nName=Other\n";
  const entry = parseDesktopEntry(text);
  assert.deepEqual(entry, { Name: "Hydra", Exec: "/opt/Hydra/hydralauncher %U", MimeType: "x-scheme-handler/hydralauncher;" });
  assert.equal(serializeDesktopEntry({ Name: "A\nExec=evil", Type: "Application" }), "[Desktop Entry]\nName=A Exec=evil\nType=Application\n");
  assert.throws(() => serializeDesktopEntry({ "Bad\nKey": "x" }), /invalid desktop entry key/);
});

test("selections load empty, save, and merge flags", () => {
  const paths = revampPaths({ HOME: mkdtempSync(join(tmpdir(), "revamp-")) });
  assert.deepEqual(loadSelection(paths, "hydra"), { enable: [], disable: [], options: {} });
  const merged = mergeSelection({ enable: ["A"], disable: ["B"], options: { A: { x: 1 } } }, { enable: ["B"], disable: ["A"] });
  assert.deepEqual(merged, { enable: ["B"], disable: ["A"], options: { A: { x: 1 } } });
  saveSelection(paths, "hydra", merged);
  assert.deepEqual(loadSelection(paths, "hydra"), merged);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test packages/engine/test/state.test.ts`
Expected: FAIL, module not found `../src/version.ts`.

- [ ] **Step 4: Implement**

`packages/engine/src/version.ts`:
```ts
export const ENGINE_VERSION = "0.1.0";

/** Compares dotted numeric versions: "4.1.10" > "4.1.9", "1.0" == "1.0.0". */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
```

`packages/engine/src/paths.ts`:
```ts
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface Paths {
  data: string;
  config: string;
  cache: string;
  state: string;
  /** XDG applications dir for .desktop files (not under revamp/). */
  applications: string;
}

export function revampPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.HOME || homedir();
  // XDG spec: relative values are invalid and must be ignored.
  const xdg = (name: string, fallback: string) => {
    const v = env[name];
    return v && isAbsolute(v) ? v : join(home, fallback);
  };
  const data = xdg("XDG_DATA_HOME", ".local/share");
  return {
    data: join(data, "revamp"),
    config: join(xdg("XDG_CONFIG_HOME", ".config"), "revamp"),
    cache: join(xdg("XDG_CACHE_HOME", ".cache"), "revamp"),
    state: join(xdg("XDG_STATE_HOME", ".local/state"), "revamp"),
    applications: join(data, "applications"),
  };
}

export const appDir = (p: Paths, appId: string) => join(p.data, "apps", assertSafeName("app id", appId));

export const releasePath = (p: Paths, appId: string, version: string, asset: string) =>
  join(p.cache, "releases", assertSafeName("app id", appId), assertSafeName("version", version), assertSafeName("asset", asset));

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** Guards names that come from bundles before they become path segments. */
export function assertSafeName(kind: string, value: string): string {
  if (!SAFE_NAME.test(value) || value.includes("..")) throw new Error(`unsafe ${kind} "${value}"`);
  return value;
}
```

`packages/engine/src/desktop.ts`:
```ts
/** Reads the [Desktop Entry] group of a .desktop file as an ordered key → value map. */
export function parseDesktopEntry(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inGroup = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inGroup = line === "[Desktop Entry]";
      continue;
    }
    if (!inGroup || line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const KEY = /^[A-Za-z0-9-]+(\[[A-Za-z0-9_@.-]+\])?$/;

export function serializeDesktopEntry(entry: Record<string, string>): string {
  const lines = ["[Desktop Entry]"];
  for (const [key, value] of Object.entries(entry)) {
    if (!KEY.test(key)) throw new Error(`invalid desktop entry key ${JSON.stringify(key)}`);
    lines.push(`${key}=${value.replace(/[\r\n]+/g, " ")}`);
  }
  return lines.join("\n") + "\n";
}
```

`packages/engine/src/config.ts`:
```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertSafeName, type Paths } from "./paths.ts";

export interface Selection {
  enable: string[];
  disable: string[];
  /** patch name → option key → value */
  options: Record<string, Record<string, unknown>>;
}

const selectionFile = (p: Paths, appId: string) => join(p.config, "apps", `${assertSafeName("app id", appId)}.json`);

export function loadSelection(p: Paths, appId: string): Selection {
  try {
    const s = JSON.parse(readFileSync(selectionFile(p, appId), "utf8"));
    return { enable: s.enable ?? [], disable: s.disable ?? [], options: s.options ?? {} };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { enable: [], disable: [], options: {} };
    throw e;
  }
}

export function saveSelection(p: Paths, appId: string, s: Selection): void {
  const file = selectionFile(p, appId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

/** Applies --enable/--disable flags on top of the saved selection; the last word wins per patch. */
export function mergeSelection(saved: Selection, flags: { enable?: string[]; disable?: string[] }): Selection {
  const enable = new Set(saved.enable);
  const disable = new Set(saved.disable);
  for (const n of flags.enable ?? []) {
    enable.add(n);
    disable.delete(n);
  }
  for (const n of flags.disable ?? []) {
    disable.add(n);
    enable.delete(n);
  }
  return { enable: [...enable], disable: [...disable], options: saved.options };
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test packages/engine/test/state.test.ts && npm run typecheck`
Expected: `# pass 5`, `# fail 0`; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine package-lock.json
git commit -m "feat(engine): XDG paths, version compare, desktop entries, selections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Verified download

**Model:** `opus` / `high` (trust boundary)

**Files:**
- Create: `packages/engine/src/download.ts`
- Test: `packages/engine/test/download.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class DownloadError extends Error`
  - `fileSha256(path): Promise<string>`
  - `interface DownloadOptions { url; dest; sha256; fetch?: typeof fetch; onProgress?(received, total | undefined) }`
  - `downloadVerified(o): Promise<"cached" | "downloaded" | "replaced">`. `"replaced"` means a cached file with the wrong hash was deleted and downloaded again.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/download.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVerified } from "../src/download.ts";

const body = Buffer.from("pretend this is a .deb\n".repeat(1000));
const sha = createHash("sha256").update(body).digest("hex");

async function serve() {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/file.deb") res.end(body);
    else {
      res.statusCode = 404;
      res.end("nope");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, hits: () => hits, close: () => new Promise((r) => server.close(r)) };
}
const tmp = () => mkdtempSync(join(tmpdir(), "revamp-dl-"));

test("downloads, verifies, and leaves no .part file", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "a", "file.deb");
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "downloaded");
  assert.deepEqual(readFileSync(dest), body);
  assert.equal(existsSync(`${dest}.part`), false);
});

test("a cached file with the right hash is reused without a request", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha });
  const before = s.hits();
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "cached");
  assert.equal(s.hits(), before);
});

test("a corrupted cached file is replaced", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  writeFileSync(dest, "truncated");
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "replaced");
  assert.deepEqual(readFileSync(dest), body);
});

test("a stale .part from a crashed run is overwritten", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  writeFileSync(`${dest}.part`, "garbage from an earlier crash");
  assert.equal(await downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: sha }), "downloaded");
  assert.deepEqual(readFileSync(dest), body);
});

test("a hash mismatch rejects and keeps nothing", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await assert.rejects(downloadVerified({ url: `${s.base}/file.deb`, dest, sha256: "0".repeat(64) }), /SHA-256 mismatch/);
  assert.equal(existsSync(dest), false);
  assert.equal(existsSync(`${dest}.part`), false);
});

test("HTTP errors reject with the status", async (t) => {
  const s = await serve();
  t.after(s.close);
  const dest = join(tmp(), "file.deb");
  await assert.rejects(downloadVerified({ url: `${s.base}/missing.deb`, dest, sha256: sha }), /HTTP 404/);
  assert.equal(existsSync(dest), false);
});

test("an invalid expected hash rejects before any request", async (t) => {
  const s = await serve();
  t.after(s.close);
  await assert.rejects(downloadVerified({ url: `${s.base}/file.deb`, dest: join(tmp(), "f"), sha256: "abc" }), /invalid expected sha256/);
  assert.equal(s.hits(), 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/engine/test/download.test.ts`
Expected: FAIL, module not found `../src/download.ts`.

- [ ] **Step 3: Implement**

`packages/engine/src/download.ts`:
```ts
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export class DownloadError extends Error {}

export interface DownloadOptions {
  url: string;
  dest: string;
  sha256: string;
  fetch?: typeof fetch;
  onProgress?: (received: number, total: number | undefined) => void;
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Makes `dest` hold exactly the bytes with the expected SHA-256.
 * Bytes are written to `dest.part` and renamed only after the hash matches, so `dest` is never unverified.
 */
export async function downloadVerified(o: DownloadOptions): Promise<"cached" | "downloaded" | "replaced"> {
  if (!/^[0-9a-f]{64}$/.test(o.sha256)) throw new DownloadError(`invalid expected sha256 "${o.sha256}"`);
  let replaced = false;
  if (existsSync(o.dest)) {
    if ((await fileSha256(o.dest)) === o.sha256) return "cached";
    rmSync(o.dest);
    replaced = true;
  }
  mkdirSync(dirname(o.dest), { recursive: true });
  const part = `${o.dest}.part`;
  try {
    const res = await (o.fetch ?? fetch)(o.url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new DownloadError(`GET ${o.url} failed: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || undefined;
    const hash = createHash("sha256");
    let received = 0;
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          hash.update(chunk);
          received += chunk.length;
          o.onProgress?.(received, total);
          yield chunk;
        }
      },
      createWriteStream(part),
    );
    const actual = hash.digest("hex");
    if (actual !== o.sha256) {
      throw new DownloadError(`SHA-256 mismatch for ${o.url}: expected ${o.sha256}, got ${actual}`);
    }
    renameSync(part, o.dest);
    return replaced ? "replaced" : "downloaded";
  } finally {
    rmSync(part, { force: true });
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/engine/test/download.test.ts && npm run typecheck`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/download.ts packages/engine/test/download.test.ts
git commit -m "feat(engine): SHA-256 verified downloads with cache reuse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Safe `.deb` extraction

**Model:** `opus` / `high` (trust boundary: archive extraction)

**Files:**
- Create: `packages/engine/src/deb.ts`, `packages/engine/test/helpers/archives.ts`
- Create (generated once, committed): `packages/engine/test/fixtures/hello_1.0_all.deb`
- Test: `packages/engine/test/deb.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class DebError extends Error`
  - `interface ArMember { name; offset; size }`, `readArMembers(path): ArMember[]`
  - `interface ExtractResult { files; dirs; symlinks; hardlinks }`
  - `extractDeb(debPath, outDir, select: (archivePath: string) => string | null): Promise<ExtractResult>`. `select` receives a normalized archive path without a leading `./` (e.g. `opt/Hydra/resources/app.asar`) and returns a path relative to `outDir`, or `null` to skip the entry.
- Test helpers (`test/helpers/archives.ts`): `tarEntry(name, body?, opts?)`, `tarArchive(entries)`, `gnuLongName(name)`, `paxPath(path)`, `arArchive(members)`, `debFrom(tar, compression)`.

**Format facts the code relies on:**
- **ar:** `!<arch>\n`, then 60-byte headers (name 16 chars, GNU names end in `/`; size at bytes 48–58 in decimal; magic "`" + newline at 58–60). Data is padded to an even length.
- **tar:** 512-byte headers.
  - Fields: name 0–100, mode 100–108, size 124–136 (octal, or base-256 when byte 124 has the high bit set), checksum 148–156, type 156, linkname 157–257, magic 257–263.
  - POSIX magic is `ustar\0`; only POSIX headers use the `prefix` field 345–500. GNU magic is `ustar ` and has no prefix.
  - Type `L` holds a GNU long name for the next entry, `K` a long link name, `x` per-entry pax records (`path`, `linkpath`, `size`); `g` is global pax and is ignored.
  - A zero block ends the archive.

- [ ] **Step 1: Generate the real `dpkg-deb` fixture (xz) once**

```bash
F=packages/engine/test/fixtures; mkdir -p $F; T=$(mktemp -d)
mkdir -p $T/hello/DEBIAN $T/hello/opt/Hello/resources $T/hello/usr/share/applications
printf 'Package: hello\nVersion: 1.0\nArchitecture: all\nMaintainer: Test <test@example.com>\nDescription: Revamp test fixture\n' > $T/hello/DEBIAN/control
printf 'hello from xz\n' > $T/hello/opt/Hello/hello.txt
printf '#!/bin/sh\necho hi\n' > $T/hello/opt/Hello/hello && chmod 755 $T/hello/opt/Hello/hello
printf 'resource\n' > $T/hello/opt/Hello/resources/r.txt
printf '[Desktop Entry]\nName=Hello\nExec=/opt/Hello/hello\nIcon=hello\n' > $T/hello/usr/share/applications/hello.desktop
dpkg-deb --root-owner-group -Zxz --build $T/hello $F/hello_1.0_all.deb && rm -rf $T
ar t $F/hello_1.0_all.deb
```
Expected: `debian-binary`, `control.tar.xz` (or `.gz`), `data.tar.xz`.

- [ ] **Step 2: Write the archive test helpers**

`packages/engine/test/helpers/archives.ts`:
```ts
import { gzipSync, zstdCompressSync } from "node:zlib";

type TarOpts = { type?: string; linkname?: string; mode?: number; magic?: "gnu" | "ustar"; prefix?: string; checksum?: "bad" };

function header(name: string, size: number, o: TarOpts): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write((o.mode ?? 0o644).toString(8).padStart(7, "0") + "\0", 100, "latin1");
  h.write("0000000\0", 108, "latin1");
  h.write("0000000\0", 116, "latin1");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "latin1");
  h.write("00000000000\0", 136, "latin1");
  h.write("        ", 148, "latin1");
  h.write(o.type ?? "0", 156, "latin1");
  h.write(o.linkname ?? "", 157, 100, "utf8");
  if (o.magic === "gnu") h.write("ustar  \0", 257, "latin1");
  else {
    h.write("ustar\0", 257, "latin1");
    h.write("00", 263, "latin1");
    h.write(o.prefix ?? "", 345, 155, "utf8");
  }
  let sum = 0;
  for (const b of h) sum += b;
  if (o.checksum === "bad") sum += 1;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
  return h;
}

export function tarEntry(name: string, body: Buffer | string = "", o: TarOpts = {}): Buffer {
  const data = typeof body === "string" ? Buffer.from(body) : body;
  return Buffer.concat([header(name, data.length, o), data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

export const tarArchive = (entries: Buffer[]) => Buffer.concat([...entries, Buffer.alloc(1024)]);

/** GNU long-name entry; the next entry's own name field is then ignored. */
export const gnuLongName = (name: string) => tarEntry("././@LongLink", name + "\0", { type: "L", magic: "gnu" });

export function paxPath(path: string): Buffer {
  let rec = ` path=${path}\n`;
  let len = rec.length;
  while (`${len}${rec}`.length !== len) len = `${len}${rec}`.length;
  return tarEntry("PaxHeader", `${len}${rec}`, { type: "x" });
}

export function arArchive(members: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.from("!<arch>\n", "latin1")];
  for (const m of members) {
    const h = Buffer.alloc(60, 0x20);
    h.write(`${m.name}/`, 0, "latin1");
    h.write("0", 16, "latin1");
    h.write("0", 28, "latin1");
    h.write("0", 34, "latin1");
    h.write("100644", 40, "latin1");
    h.write(String(m.data.length), 48, "latin1");
    h.write("`\n", 58, "latin1");
    parts.push(h, m.data);
    if (m.data.length % 2) parts.push(Buffer.from("\n"));
  }
  return Buffer.concat(parts);
}

export function debFrom(tar: Buffer, compression: "gz" | "zst" | "none"): Buffer {
  const data = compression === "gz" ? gzipSync(tar) : compression === "zst" ? zstdCompressSync(tar) : tar;
  const name = compression === "none" ? "data.tar" : `data.tar.${compression}`;
  return arArchive([
    { name: "debian-binary", data: Buffer.from("2.0\n") },
    { name: "control.tar.gz", data: gzipSync(tarArchive([])) },
    { name, data },
  ]);
}
```

- [ ] **Step 3: Write the failing tests**

`packages/engine/test/deb.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractDeb, readArMembers } from "../src/deb.ts";
import { debFrom, gnuLongName, paxPath, tarArchive, tarEntry } from "./helpers/archives.ts";

const FIXTURE = new URL("./fixtures/hello_1.0_all.deb", import.meta.url).pathname;

function setup(deb?: Buffer) {
  const root = mkdtempSync(join(tmpdir(), "revamp-deb-"));
  const out = join(root, "out");
  mkdirSync(out);
  const path = join(root, "x.deb");
  if (deb) writeFileSync(path, deb);
  return { root, out, path };
}
const everything = (p: string) => p;

test("extracts a real dpkg-deb xz package through select()", async () => {
  const { out } = setup();
  const r = await extractDeb(FIXTURE, out, (p) => (p.startsWith("opt/Hello/") ? p.slice("opt/Hello/".length) : null));
  assert.equal(readFileSync(join(out, "hello.txt"), "utf8"), "hello from xz\n");
  assert.equal(readFileSync(join(out, "resources/r.txt"), "utf8"), "resource\n");
  assert.equal(statSync(join(out, "hello")).mode & 0o777, 0o755);
  assert.equal(existsSync(join(out, "usr")), false);
  assert.equal(r.files, 3);
});

test("readArMembers lists the members of a real .deb", () => {
  const names = readArMembers(FIXTURE).map((m) => m.name);
  assert.equal(names[0], "debian-binary");
  assert.ok(names.includes("data.tar.xz"));
});

for (const compression of ["gz", "zst", "none"] as const) {
  test(`extracts ${compression} data, GNU long names, pax paths and ustar prefixes`, async () => {
    const long = `opt/App/${"d".repeat(120)}/file.txt`;
    const tar = tarArchive([
      tarEntry("./opt/App/", "", { type: "5", mode: 0o755 }),
      tarEntry("./opt/App/a.txt", "A"),
      gnuLongName(`./${long}`),
      tarEntry("./ignored-short-name", "LONG", { magic: "gnu" }),
      paxPath("opt/App/pax.txt"),
      tarEntry("ignored", "PAX"),
      tarEntry("b.txt", "B", { prefix: "opt/App/sub" }),
    ]);
    const { out, path } = setup(debFrom(tar, compression));
    await extractDeb(path, out, everything);
    assert.equal(readFileSync(join(out, "opt/App/a.txt"), "utf8"), "A");
    assert.equal(readFileSync(join(out, long), "utf8"), "LONG");
    assert.equal(readFileSync(join(out, "opt/App/pax.txt"), "utf8"), "PAX");
    assert.equal(readFileSync(join(out, "opt/App/sub/b.txt"), "utf8"), "B");
  });
}

test("keeps in-tree symlinks and hardlinks, strips setuid bits", async () => {
  const tar = tarArchive([
    tarEntry("app/real.txt", "R", { mode: 0o4755 }),
    tarEntry("app/link", "", { type: "2", linkname: "real.txt" }),
    tarEntry("app/hard", "", { type: "1", linkname: "app/real.txt" }),
  ]);
  const { out, path } = setup(debFrom(tar, "gz"));
  const r = await extractDeb(path, out, everything);
  assert.equal(statSync(join(out, "app/real.txt")).mode & 0o7777, 0o755);
  assert.equal(readlinkSync(join(out, "app/link")), "real.txt");
  assert.equal(readFileSync(join(out, "app/hard"), "utf8"), "R");
  assert.deepEqual([r.symlinks, r.hardlinks], [1, 1]);
});

const hostile: Array<[string, Buffer[], RegExp]> = [
  ["dot-dot paths", [tarEntry("app/../../evil.txt", "x")], /\.\./],
  ["absolute paths", [tarEntry("/tmp/evil.txt", "x")], /absolute/],
  ["symlinks out of the tree", [tarEntry("app/l", "", { type: "2", linkname: "../../../etc" })], /outside/],
  ["absolute symlinks", [tarEntry("app/l", "", { type: "2", linkname: "/etc/passwd" })], /outside|absolute/],
  ["device nodes", [tarEntry("app/dev", "", { type: "3" })], /unsupported tar entry type/],
  ["duplicate paths", [tarEntry("app/a", "1"), tarEntry("app/a", "2")], /duplicate/],
  ["bad checksums", [tarEntry("app/a", "1", { checksum: "bad" })], /checksum/],
  ["hardlinks to unknown files", [tarEntry("app/h", "", { type: "1", linkname: "app/missing" })], /hardlink/],
];
for (const [label, entries, error] of hostile) {
  test(`rejects ${label}`, async () => {
    const { root, out, path } = setup(debFrom(tarArchive(entries), "gz"));
    await assert.rejects(extractDeb(path, out, everything), error);
    assert.equal(existsSync(join(root, "evil.txt")), false);
  });
}

test("rejects files that are not ar archives or have no data member", async () => {
  const { out, path } = setup(Buffer.from("not an archive at all, just text\n"));
  await assert.rejects(extractDeb(path, out, everything), /not an ar archive/);
  const empty = setup(debFrom(tarArchive([]), "gz").subarray(0, 8));
  await assert.rejects(extractDeb(empty.path, empty.out, everything), /no data\.tar/);
});

test("skipped entries are never written", async () => {
  const { out, path } = setup(debFrom(tarArchive([tarEntry("keep.txt", "k"), tarEntry("skip.txt", "s")]), "gz"));
  await extractDeb(path, out, (p) => (p === "keep.txt" ? p : null));
  assert.equal(existsSync(join(out, "keep.txt")), true);
  assert.equal(existsSync(join(out, "skip.txt")), false);
  assert.equal(lstatSync(out).isDirectory(), true);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test packages/engine/test/deb.test.ts`
Expected: FAIL, module not found `../src/deb.ts`.

- [ ] **Step 5: Implement**

Run: `npm install -w @revamp/engine xz-decompress@^0.2.3`

`packages/engine/src/deb.ts`:
```ts
import { closeSync, createReadStream, fstatSync, linkSync, mkdirSync, openSync, readSync, symlinkSync, writeSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip, createZstdDecompress } from "node:zlib";
import xz from "xz-decompress"; // CommonJS/UMD: only the default export exists at runtime

export class DebError extends Error {}

export interface ArMember {
  name: string;
  offset: number;
  size: number;
}

export function readArMembers(path: string): ArMember[] {
  const fd = openSync(path, "r");
  try {
    const total = fstatSync(fd).size;
    const magic = Buffer.alloc(8);
    readSync(fd, magic, 0, 8, 0);
    if (magic.toString("latin1") !== "!<arch>\n") throw new DebError(`${path} is not an ar archive (bad magic)`);
    const members: ArMember[] = [];
    const header = Buffer.alloc(60);
    let pos = 8;
    while (pos + 60 <= total) {
      readSync(fd, header, 0, 60, pos);
      if (header.toString("latin1", 58, 60) !== "`\n") throw new DebError(`corrupt ar header at offset ${pos}`);
      const name = header.toString("latin1", 0, 16).trimEnd().replace(/\/$/, "");
      const size = Number.parseInt(header.toString("latin1", 48, 58).trim(), 10);
      if (!Number.isSafeInteger(size) || size < 0 || pos + 60 + size > total) {
        throw new DebError(`bad ar member size for "${name}"`);
      }
      members.push({ name, offset: pos + 60, size });
      pos += 60 + size + (size % 2);
    }
    return members;
  } finally {
    closeSync(fd);
  }
}

function dataStream(path: string, m: ArMember): AsyncIterable<Uint8Array> {
  const raw = createReadStream(path, { start: m.offset, end: m.offset + m.size - 1 });
  const through = (t: NodeJS.ReadWriteStream) => {
    raw.on("error", (e) => (t as unknown as Readable).destroy(e));
    return raw.pipe(t) as unknown as AsyncIterable<Uint8Array>;
  };
  if (m.name === "data.tar") return raw;
  if (m.name === "data.tar.gz") return through(createGunzip());
  if (m.name === "data.tar.zst") return through(createZstdDecompress());
  const web = Readable.toWeb(raw) as unknown as ReadableStream<Uint8Array>;
  return new xz.XzReadableStream(web) as unknown as WebReadableStream<Uint8Array>;
}

export interface ExtractResult {
  files: number;
  dirs: number;
  symlinks: number;
  hardlinks: number;
}

/** Streams data.tar.* out of a .deb into outDir. Never executes anything and never writes outside outDir. */
export async function extractDeb(
  debPath: string,
  outDir: string,
  select: (archivePath: string) => string | null,
): Promise<ExtractResult> {
  const member = readArMembers(debPath).find((m) => /^data\.tar(\.(gz|xz|zst))?$/.test(m.name));
  if (!member) throw new DebError(`${debPath} has no data.tar member`);
  const tar = new TarExtractor(resolve(outDir), select);
  for await (const chunk of dataStream(debPath, member)) {
    tar.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  tar.end();
  return tar.result;
}

const BLOCK = 512;
const META_LIMIT = 1 << 20; // long names and pax records larger than 1 MiB are hostile

type Body =
  | { kind: "skip" }
  | { kind: "file"; fd: number; dest: string; mode: number }
  | { kind: "meta"; type: "L" | "K" | "x"; chunks: Buffer[]; length: number };

class TarExtractor {
  result: ExtractResult = { files: 0, dirs: 0, symlinks: 0, hardlinks: 0 };
  private header = Buffer.alloc(BLOCK);
  private headerFill = 0;
  private body: Body | undefined;
  private bodyLeft = 0;
  private padLeft = 0;
  private done = false;
  private longName: string | undefined;
  private longLink: string | undefined;
  private pax: Record<string, string> = {};
  private seen = new Set<string>();
  /** archive path → extracted destination, for hardlinks */
  private extracted = new Map<string, string>();
  private readonly rootDir: string;
  private readonly select: (archivePath: string) => string | null;

  constructor(rootDir: string, select: (archivePath: string) => string | null) {
    this.rootDir = rootDir;
    this.select = select;
  }

  write(chunk: Buffer): void {
    let off = 0;
    while (off < chunk.length && !this.done) {
      if (this.bodyLeft > 0) {
        const n = Math.min(this.bodyLeft, chunk.length - off);
        this.consume(chunk.subarray(off, off + n));
        off += n;
        this.bodyLeft -= n;
        if (this.bodyLeft === 0) this.finishBody();
      } else if (this.padLeft > 0) {
        const n = Math.min(this.padLeft, chunk.length - off);
        off += n;
        this.padLeft -= n;
      } else {
        const n = Math.min(BLOCK - this.headerFill, chunk.length - off);
        chunk.copy(this.header, this.headerFill, off, off + n);
        this.headerFill += n;
        off += n;
        if (this.headerFill === BLOCK) {
          this.headerFill = 0;
          this.onHeader(this.header);
        }
      }
    }
  }

  end(): void {
    if (this.bodyLeft > 0 || this.headerFill > 0) throw new DebError("tar stream ended in the middle of an entry");
  }

  private onHeader(h: Buffer): void {
    if (h.every((b) => b === 0)) {
      this.done = true;
      return;
    }
    verifyChecksum(h);
    const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]);
    let size = parseSize(h.subarray(124, 136));
    const magic = h.toString("latin1", 257, 263);
    let name = cstring(h, 0, 100);
    if (magic === "ustar\0") {
      const prefix = cstring(h, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    if (type === "L" || type === "K" || type === "x" || type === "g") {
      if (size > META_LIMIT) throw new DebError(`oversized tar metadata entry (${size} bytes)`);
      this.startBody(type === "g" ? { kind: "skip" } : { kind: "meta", type, chunks: [], length: 0 }, size);
      return;
    }
    const path = safeArchivePath(this.pax.path ?? this.longName ?? name);
    const link = this.pax.linkpath ?? this.longLink ?? cstring(h, 157, 100);
    if (this.pax.size !== undefined) size = Number(this.pax.size);
    this.longName = this.longLink = undefined;
    this.pax = {};
    const mode = parseOctal(h.subarray(100, 108)) & 0o777; // drops setuid/setgid/sticky

    if (type === "5") {
      const rel = path === "" ? null : this.select(path);
      if (rel !== null) {
        mkdirSync(this.dest(rel), { recursive: true, mode: 0o755 });
        this.result.dirs++;
      }
      this.startBody({ kind: "skip" }, size);
      return;
    }
    if (type !== "0" && type !== "7" && type !== "1" && type !== "2") {
      throw new DebError(`unsupported tar entry type "${type}" for ${path}`);
    }
    if (this.seen.has(path)) throw new DebError(`duplicate path in archive: ${path}`);
    this.seen.add(path);
    const rel = this.select(path);
    if (rel === null) {
      this.startBody({ kind: "skip" }, size);
      return;
    }
    const dest = this.dest(rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (type === "2") {
      if (isAbsolute(link)) throw new DebError(`absolute symlink ${path} -> ${link} points outside the archive`);
      const target = resolve(dirname(dest), link);
      if (!this.inside(target)) throw new DebError(`symlink ${path} -> ${link} points outside the archive`);
      symlinkSync(link, dest);
      this.result.symlinks++;
      this.startBody({ kind: "skip" }, size);
    } else if (type === "1") {
      const target = this.extracted.get(safeArchivePath(link));
      if (!target) throw new DebError(`hardlink ${path} -> ${link} targets a file that was not extracted`);
      linkSync(target, dest);
      this.result.hardlinks++;
      this.startBody({ kind: "skip" }, size);
    } else {
      this.extracted.set(path, dest);
      this.startBody({ kind: "file", fd: openSync(dest, "wx", 0o600), dest, mode }, size);
    }
  }

  private startBody(body: Body, size: number): void {
    this.body = body;
    this.bodyLeft = size;
    this.padLeft = (BLOCK - (size % BLOCK)) % BLOCK;
    if (size === 0) this.finishBody();
  }

  private consume(data: Buffer): void {
    const b = this.body!;
    if (b.kind === "file") writeSync(b.fd, data);
    else if (b.kind === "meta") {
      b.chunks.push(Buffer.from(data));
      b.length += data.length;
    }
  }

  private finishBody(): void {
    const b = this.body!;
    this.body = undefined;
    if (b.kind === "file") {
      closeSync(b.fd);
      chmodSync(b.dest, b.mode);
      this.result.files++;
    } else if (b.kind === "meta") {
      const data = Buffer.concat(b.chunks, b.length);
      if (b.type === "L") this.longName = cstring(data, 0, data.length);
      else if (b.type === "K") this.longLink = cstring(data, 0, data.length);
      else this.pax = parsePax(data);
    }
  }

  private dest(rel: string): string {
    const d = resolve(this.rootDir, rel);
    if (!this.inside(d)) throw new DebError(`refusing to write outside the output directory: ${rel}`);
    return d;
  }

  private inside(p: string): boolean {
    return p === this.rootDir || p.startsWith(this.rootDir + sep);
  }
}

/** Normalizes "./a/b/" to "a/b" and rejects absolute paths, ".." segments and NUL bytes. */
function safeArchivePath(raw: string): string {
  if (raw.includes("\0")) throw new DebError(`NUL byte in archive path ${JSON.stringify(raw)}`);
  if (raw.startsWith("/")) throw new DebError(`absolute path in archive: ${raw}`);
  const parts = raw.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.includes("..")) throw new DebError(`".." in archive path: ${raw}`);
  return parts.join("/");
}

function cstring(buf: Buffer, start: number, length: number): string {
  const end = buf.indexOf(0, start);
  return buf.toString("utf8", start, end === -1 || end > start + length ? start + length : end);
}

function parseOctal(field: Buffer): number {
  const s = field.toString("latin1").replace(/[\0 ]+$/g, "").trim();
  return s === "" ? 0 : Number.parseInt(s, 8);
}

function parseSize(field: Buffer): number {
  if (field[0] & 0x80) {
    // GNU base-256 encoding for sizes ≥ 8 GiB
    let n = field[0] & 0x7f;
    for (let i = 1; i < field.length; i++) n = n * 256 + field[i];
    return n;
  }
  const n = parseOctal(field);
  if (!Number.isSafeInteger(n) || n < 0) throw new DebError("bad tar entry size");
  return n;
}

function verifyChecksum(h: Buffer): void {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  if (sum !== parseOctal(h.subarray(148, 156))) throw new DebError("tar header checksum mismatch");
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    const len = Number.parseInt(data.toString("latin1", pos, space), 10);
    if (space === -1 || !Number.isSafeInteger(len) || len <= 0) throw new DebError("malformed pax header");
    const rec = data.toString("utf8", space + 1, pos + len - 1); // drop trailing "\n"
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    pos += len;
  }
  return out;
}
```

The `import xz from "xz-decompress"` default import is deliberate. The package is UMD, so at runtime the named `XzReadableStream` is `undefined` and `default.XzReadableStream` is the class. This was verified, and it typechecks with TS 7.
- [ ] **Step 6: Run the tests**

Run: `node --test packages/engine/test/deb.test.ts && npm run typecheck`
Expected: all pass (`# fail 0`); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/deb.ts packages/engine/test/deb.test.ts packages/engine/test/helpers packages/engine/test/fixtures/hello_1.0_all.deb packages/engine/package.json package-lock.json
git commit -m "feat(engine): streaming .deb extraction with path, link and type checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: asar read and write

**Model:** `opus` / `high` (reads headers from downloaded, untrusted archives)

**Files:**
- Create: `packages/engine/src/asar.ts`
- Test: `packages/engine/test/asar.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class AsarError extends Error`
  - `interface AsarEntry`, `interface AsarIntegrity`, `interface AsarArchive { path; header; dataOffset }`
  - `readAsar(path): AsarArchive`
  - `listAsarFiles(a): string[]`: files only, `/`-separated, no links
  - `readAsarFile(a, path): Buffer`: handles `unpacked` entries via `<archive>.unpacked/`
  - `integrityOf(data): AsarIntegrity`
  - `assertAsarPath(path): string`
  - `writeAsar(a, outPath, changes: ReadonlyMap<string, Buffer>): void`

**Format facts (measured on Hydra 4.1.6):**
- **Prefix:** four little-endian u32s: `4`, `headerSize`, `headerSize - 4` and the JSON byte length.
- **JSON:** starts at byte 16, padded to 4 bytes, so `headerSize = align4(jsonLength) + 8`.
- **Data:** starts at `8 + headerSize`.
- **File entries:** `offset` is a decimal string relative to the data start.
- **Integrity:** SHA-256 of the whole file plus one hash per 4 MiB block, exactly as `@electron/asar`'s `getFileIntegrityFromBuffer` computes it. An empty file has one block hash (of the empty buffer).

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/asar.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackageWithOptions, extractFile, getRawHeader } from "@electron/asar";
import { integrityOf, listAsarFiles, readAsar, readAsarFile, writeAsar } from "../src/asar.ts";

async function makeArchive() {
  const root = mkdtempSync(join(tmpdir(), "revamp-asar-"));
  const src = join(root, "src");
  mkdirSync(join(src, "dir"), { recursive: true });
  mkdirSync(join(src, "native"));
  writeFileSync(join(src, "a.txt"), "alpha");
  writeFileSync(join(src, "empty.txt"), "");
  writeFileSync(join(src, "dir/b.js"), "console.log('b')\n");
  writeFileSync(join(src, "native/x.node"), "binary");
  writeFileSync(join(src, "big.bin"), Buffer.alloc(5 * 1024 * 1024 + 7, 1));
  const archive = join(root, "app.asar");
  await createPackageWithOptions(src, archive, { unpack: "*.node" });
  return { root, src, archive };
}

test("lists and reads files, including unpacked ones", async () => {
  const { src, archive } = await makeArchive();
  const a = readAsar(archive);
  assert.deepEqual(listAsarFiles(a).sort(), ["a.txt", "big.bin", "dir/b.js", "empty.txt", "native/x.node"]);
  for (const f of listAsarFiles(a)) assert.deepEqual(readAsarFile(a, f), readFileSync(join(src, f)), f);
});

test("integrityOf matches @electron/asar for empty, small and multi-block files", async () => {
  const { src, archive } = await makeArchive();
  const files = getRawHeader(archive).header.files as Record<string, any>;
  for (const name of ["a.txt", "empty.txt", "big.bin"]) {
    assert.deepEqual(integrityOf(readFileSync(join(src, name))), files[name].integrity, name);
  }
});

test("writeAsar replaces and adds files and keeps the rest byte-identical", async () => {
  const { root, src, archive } = await makeArchive();
  const out = join(root, "new.asar");
  cpSync(`${archive}.unpacked`, `${out}.unpacked`, { recursive: true });
  const changed = Buffer.from("console.log('changed')\n");
  writeAsar(readAsar(archive), out, new Map([["dir/b.js", changed], ["new/deep/c.js", Buffer.from("added")]]));
  assert.deepEqual(extractFile(out, "dir/b.js"), changed);
  assert.equal(extractFile(out, "new/deep/c.js").toString(), "added");
  assert.deepEqual(extractFile(out, "big.bin"), readFileSync(join(src, "big.bin")));
  assert.equal(extractFile(out, "a.txt").toString(), "alpha");
  assert.equal(extractFile(out, "native/x.node").toString(), "binary");
  const header = getRawHeader(out).header as any;
  assert.deepEqual(header.files.dir.files["b.js"].integrity, integrityOf(changed));
  assert.ok(listAsarFiles(readAsar(out)).includes("new/deep/c.js"));
});

test("writeAsar refuses unsafe paths, directories, files-as-dirs and unpacked entries", async () => {
  const { root, archive } = await makeArchive();
  const a = readAsar(archive);
  const out = join(root, "bad.asar");
  const buf = Buffer.from("x");
  assert.throws(() => writeAsar(a, out, new Map([["../evil.js", buf]])), /invalid path/);
  assert.throws(() => writeAsar(a, out, new Map([["dir", buf]])), /is a directory/);
  assert.throws(() => writeAsar(a, out, new Map([["a.txt/x", buf]])), /is a file/);
  assert.throws(() => writeAsar(a, out, new Map([["native/x.node", buf]])), /unpacked/);
});

test("readAsar rejects non-asar files and hostile entry names", () => {
  const root = mkdtempSync(join(tmpdir(), "revamp-asar-"));
  writeFileSync(join(root, "text.asar"), "definitely not an asar archive");
  assert.throws(() => readAsar(join(root, "text.asar")), /not an asar archive|corrupt/);
  const json = Buffer.from(JSON.stringify({ files: { "..": { size: 0, offset: "0" } } }));
  const padded = Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(padded + 8, 4);
  prefix.writeUInt32LE(padded + 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  writeFileSync(join(root, "evil.asar"), Buffer.concat([prefix, json, Buffer.alloc(padded - json.length)]));
  assert.throws(() => readAsar(join(root, "evil.asar")), /invalid entry name/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/engine/test/asar.test.ts`
Expected: FAIL, module not found `../src/asar.ts`.

- [ ] **Step 3: Implement**

`packages/engine/src/asar.ts`:
```ts
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

export class AsarError extends Error {}

export interface AsarIntegrity {
  algorithm: "SHA256";
  hash: string;
  blockSize: number;
  blocks: string[];
}

export interface AsarEntry {
  files?: Record<string, AsarEntry>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
  executable?: boolean;
  link?: string;
  integrity?: AsarIntegrity;
}

export interface AsarArchive {
  path: string;
  header: AsarEntry;
  /** Byte offset where file data starts: 8 + headerSize. */
  dataOffset: number;
}

const BLOCK_SIZE = 4 * 1024 * 1024;

export function readAsar(path: string): AsarArchive {
  const fd = openSync(path, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (readSync(fd, prefix, 0, 16, 0) !== 16 || prefix.readUInt32LE(0) !== 4) {
      throw new AsarError(`${path} is not an asar archive`);
    }
    const headerSize = prefix.readUInt32LE(4);
    const jsonLength = prefix.readUInt32LE(12);
    if (jsonLength + 8 > headerSize || 8 + headerSize > fstatSync(fd).size) {
      throw new AsarError(`${path} has a corrupt asar header`);
    }
    const json = Buffer.alloc(jsonLength);
    readFully(fd, json, 16);
    let header: AsarEntry;
    try {
      header = JSON.parse(json.toString("utf8"));
    } catch {
      throw new AsarError(`${path} has a corrupt asar header`);
    }
    validateNames(header);
    return { path, header, dataOffset: 8 + headerSize };
  } finally {
    closeSync(fd);
  }
}

function validateNames(dir: AsarEntry): void {
  for (const [name, entry] of Object.entries(dir.files ?? {})) {
    if (name === "" || name === "." || name === ".." || /[/\\\0]/.test(name)) {
      throw new AsarError(`invalid entry name ${JSON.stringify(name)} in asar header`);
    }
    if (entry.files) validateNames(entry);
  }
}

export function listAsarFiles(a: AsarArchive): string[] {
  const out: string[] = [];
  const walk = (dir: AsarEntry, prefix: string) => {
    for (const [name, entry] of Object.entries(dir.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, path);
      else if (!entry.link) out.push(path);
    }
  };
  walk(a.header, "");
  return out;
}

function lookup(header: AsarEntry, path: string): AsarEntry | undefined {
  let entry: AsarEntry | undefined = header;
  for (const part of path.split("/")) {
    if (!entry?.files || !Object.hasOwn(entry.files, part)) return undefined;
    entry = entry.files[part];
  }
  return entry;
}

export function readAsarFile(a: AsarArchive, path: string): Buffer {
  const entry = lookup(a.header, path);
  if (!entry || entry.files || entry.link) throw new AsarError(`no file "${path}" in ${a.path}`);
  if (entry.unpacked) return readFileSync(join(`${a.path}.unpacked`, ...path.split("/")));
  const buf = Buffer.alloc(entry.size ?? 0);
  const fd = openSync(a.path, "r");
  try {
    readFully(fd, buf, a.dataOffset + Number(entry.offset));
  } finally {
    closeSync(fd);
  }
  return buf;
}

export function integrityOf(data: Buffer): AsarIntegrity {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const blocks: string[] = [];
  for (let off = 0; off < data.length; off += BLOCK_SIZE) blocks.push(sha(data.subarray(off, off + BLOCK_SIZE)));
  if (data.length === 0) blocks.push(sha(data));
  return { algorithm: "SHA256", hash: sha(data), blockSize: BLOCK_SIZE, blocks };
}

/** Paths inside app.asar that come from bundles or sandbox output: plain relative segments only. */
export function assertAsarPath(path: string): string {
  if (path.split("/").some((p) => p === "" || p === "." || p === ".." || /[\\\0]/.test(p))) {
    throw new AsarError(`invalid path inside app.asar: ${JSON.stringify(path)}`);
  }
  return path;
}

/**
 * Writes a new archive: the original data region copied as-is, changed and new files appended,
 * and a rewritten header. Old bytes of replaced files stay behind unused.
 */
export function writeAsar(a: AsarArchive, outPath: string, changes: ReadonlyMap<string, Buffer>): void {
  const header = structuredClone(a.header);
  const src = openSync(a.path, "r");
  try {
    const dataLength = fstatSync(src).size - a.dataOffset;
    let next = dataLength;
    const appended: Buffer[] = [];
    for (const [path, contents] of changes) {
      const entry = fileEntryFor(header, assertAsarPath(path));
      if (entry.unpacked || entry.link) throw new AsarError(`can't replace unpacked or linked entry "${path}"`);
      entry.size = contents.length;
      entry.offset = String(next);
      entry.integrity = integrityOf(contents);
      appended.push(contents);
      next += contents.length;
    }
    const json = Buffer.from(JSON.stringify(header), "utf8");
    const padded = Math.ceil(json.length / 4) * 4;
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(padded + 8, 4);
    prefix.writeUInt32LE(padded + 4, 8);
    prefix.writeUInt32LE(json.length, 12);
    const out = openSync(outPath, "w");
    try {
      writeAll(out, prefix);
      writeAll(out, json);
      writeAll(out, Buffer.alloc(padded - json.length));
      const chunk = Buffer.alloc(8 * 1024 * 1024);
      for (let pos = 0; pos < dataLength; ) {
        const n = readSync(src, chunk, 0, Math.min(chunk.length, dataLength - pos), a.dataOffset + pos);
        if (n === 0) throw new AsarError(`${a.path} ended early`);
        writeAll(out, chunk.subarray(0, n));
        pos += n;
      }
      for (const b of appended) writeAll(out, b);
    } finally {
      closeSync(out);
    }
  } finally {
    closeSync(src);
  }
}

function fileEntryFor(header: AsarEntry, path: string): AsarEntry {
  const parts = path.split("/");
  let dir = header;
  for (const part of parts.slice(0, -1)) {
    dir.files ??= {};
    const existing = Object.hasOwn(dir.files, part) ? dir.files[part] : undefined;
    if (existing && !existing.files) throw new AsarError(`"${path}": "${part}" is a file, not a directory`);
    dir = existing ?? (dir.files[part] = { files: {} });
  }
  dir.files ??= {};
  const name = parts[parts.length - 1];
  const existing = Object.hasOwn(dir.files, name) ? dir.files[name] : undefined;
  if (existing?.files) throw new AsarError(`"${path}" is a directory`);
  return existing ?? (dir.files[name] = {});
}

function readFully(fd: number, buf: Buffer, position: number): void {
  for (let off = 0; off < buf.length; ) {
    const n = readSync(fd, buf, off, buf.length - off, position + off);
    if (n === 0) throw new AsarError("unexpected end of asar archive");
    off += n;
  }
}

function writeAll(fd: number, buf: Buffer): void {
  for (let off = 0; off < buf.length; ) off += writeSync(fd, buf, off);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/engine/test/asar.test.ts && npm run typecheck`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/asar.ts packages/engine/test/asar.test.ts
git commit -m "feat(engine): asar reader and append-only writer with integrity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: By-example pattern matcher

**Model:** `sonnet` / `medium` (the code below was prototyped and validated against the real 13.7 MB Hydra renderer; transcribe, don't redesign)

**Files:**
- Create: `packages/engine/src/pattern.ts`
- Test: `packages/engine/test/pattern.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Node`, `type Captures = ReadonlyMap<string, Node | Node[]>`
  - `interface CompiledPattern { source; root }`
  - `interface ParsedFile { code; ast; byType: Map<string, Node[]> }`
  - `interface PatternMatch { node; captures }`
  - `PARSE_OPTIONS`
  - `isNode(v)`, `parseFile(code, sourceType?)`, `compilePattern(src)`, `findMatches(p, file, within?)`, `textOf(code, nodeOrNodes)`, `matchNode(p, t, code, caps)`
  - `parentOf(root, target): { parent: Node; key: string; index: number | undefined } | undefined`

**Semantics (spec §5.3).**

How a pattern string is parsed:
- Tried in order as: an expression, a single statement, a class member, an object member, a switch case.
- Patterns starting with `function` or `class` are tried as statements first, so they mean declarations.

How blanks match:
- `$NAME` matches any single node. A repeated `$NAME` must have identical source text.
- `$_` never binds.
- A statement that is only `$NAME;` matches any one statement.
- `$$$` / `$$$NAME` match zero or more items in ordered lists: statements, arguments, array elements, parameters and class members.

How everything else matches:
- Object literals, object patterns and switch `cases` are **unordered subsets**.
- Property keys compare as strings (`url` equals `"url"`).
- Literals compare by value, so quote style doesn't matter.
- `raw`, `shorthand`, `method`, comments and redundant parentheses are ignored.

**Measured on Hydra 4.1.6:**
- Every M1 fingerprint matches exactly once.
- Each search takes 15–200 ms on the indexed renderer.
- The spliced renderer re-parses with acorn in about 2.3 s.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/pattern.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePattern, findMatches, parentOf, parseFile, textOf } from "../src/pattern.ts";

function find(pattern: string, code: string) {
  return findMatches(compilePattern(pattern), parseFile(code)).map((m) => ({
    text: textOf(code, m.node),
    caps: Object.fromEntries([...m.captures].map(([k, v]) => [k, textOf(code, v)])),
  }));
}

test("patterns parse as expression, statement, class member, object member or switch case", () => {
  assert.equal(compilePattern("f($A)").root.type, "CallExpression");
  assert.equal(compilePattern("({ a: 1 })").root.type, "ObjectExpression");
  assert.equal(compilePattern("const $X = 1").root.type, "VariableDeclaration");
  assert.equal(compilePattern("isUpdaterActive() { $$$ }").root.type, "MethodDefinition");
  assert.equal(compilePattern('"key": $V').root.type, "Property");
  assert.equal(compilePattern("value: $V").root.type, "Property");
  assert.equal(compilePattern('case "a": { $$$ }').root.type, "SwitchCase");
  assert.equal(compilePattern("function f($$$) { $$$ }").root.type, "FunctionDeclaration");
  assert.throws(() => compilePattern("$X"), /only a blank/);
  assert.throws(() => compilePattern("case case"), /not one JavaScript/);
});

test("single blanks capture; a repeated blank must repeat the same code", () => {
  assert.deepEqual(find("$A + $A", "x + x; x + y;").map((m) => m.text), ["x + x"]);
  assert.deepEqual(find("f($A, $B)", "f(1, g(2))")[0].caps, { A: "1", B: "g(2)" });
});

test("$$$ matches any number of list items and $$$NAME captures them", () => {
  assert.equal(find("f($$$, 3)", "f(3); f(1, 2, 3); f(3, 4);").length, 2);
  assert.deepEqual(find("f($$$ARGS)", "f(1, 2)")[0].caps, { ARGS: "1, 2" });
  assert.equal(find('[$$$, "b", $$$]', '["a", "b", "c"]; ["a", "c"];').length, 1);
});

test("object patterns are unordered subsets and ignore key quoting", () => {
  const code = 'x = {icon: a, "url": "/discounts", label: b}; y = {url: "/other"};';
  assert.deepEqual(find('({ url: "/discounts" })', code).map((m) => m.text), ['{icon: a, "url": "/discounts", label: b}']);
  assert.deepEqual(find('({ $K: "/other" })', code)[0].caps, { K: "url" });
});

test("switch patterns list the cases they need, in any order", () => {
  const code = 'switch (s) { case "a": { f(); break; } case "b": { g(); break; } default: h(); }';
  assert.equal(find('switch ($S) { case "b": { $$$ } }', code).length, 1);
  assert.equal(find('switch ($S) { case "z": { $$$ } }', code).length, 0);
});

test("quotes, comments and parentheses don't matter", () => {
  assert.equal(find("f('a')", '/* @__PURE__ */ f(("a"))').length, 1);
});

test("function patterns mean declarations, not expressions", () => {
  const code = "function SimilarGames({ objectId, shop }) { return 1; } const e = function SimilarGames() {};";
  assert.deepEqual(find("function SimilarGames($$$) { $$$ }", code).map((m) => m.text.slice(0, 21)), ["function SimilarGames"]);
});

test("class member patterns match methods and capture their body", () => {
  const code = "class U { isUpdaterActive() { const a = 1; return a; } check() { return this.isUpdaterActive(); } }";
  const found = find("isUpdaterActive() { $$$BODY }", code);
  assert.equal(found.length, 1);
  assert.equal(found[0].caps.BODY, "const a = 1; return a;");
});

test("a lone blank statement matches exactly one statement", () => {
  assert.equal(find("if ($C) { $S; }", "if (a) { b(); } if (c) { d(); e(); }").length, 1);
});

test("minified Heroic code: blanks capture mangled names", () => {
  const code = 'd.jsx(ut,{url:"/discounts",icon:X9,label:e("discounts.sidebar","Deals"),dataTour:"sidebar-discounts"})';
  assert.deepEqual(find('$R.jsx($LINK, { url: "/discounts" })', code)[0].caps, { R: "d", LINK: "ut" });
});

test("findMatches can search inside a range", () => {
  const code = "f(1); { f(2); }";
  const file = parseFile(code);
  const block = file.byType.get("BlockStatement")![0];
  assert.deepEqual(findMatches(compilePattern("f($X)"), file, block).map((m) => textOf(code, m.node)), ["f(2)"]);
});

test("parentOf reports the containing list and index", () => {
  const file = parseFile('const o = ["a", "b"];');
  const b = file.byType.get("Literal")!.find((n) => n.value === "b")!;
  const link = parentOf(file.ast, b)!;
  assert.deepEqual([link.parent.type, link.key, link.index], ["ArrayExpression", "elements", 1]);
});

test("parseFile parses sloppy scripts when asked", () => {
  assert.throws(() => parseFile("with (a) b;"));
  assert.equal(parseFile("with (a) b;", "script").ast.type, "Program");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm install -w @revamp/engine acorn@^8.19.0 && node --test packages/engine/test/pattern.test.ts`
Expected: FAIL, module not found `../src/pattern.ts`.

- [ ] **Step 3: Implement (transcribe exactly)**

`packages/engine/src/pattern.ts`:
```ts
import { parse, type Options } from "acorn";

export type Node = { type: string; start: number; end: number; [key: string]: any };
export type Captures = ReadonlyMap<string, Node | Node[]>;
export interface CompiledPattern {
  source: string;
  root: Node;
}
export interface ParsedFile {
  code: string;
  ast: Node;
  /** Every node, grouped by type, in source order. */
  byType: Map<string, Node[]>;
}
export interface PatternMatch {
  node: Node;
  captures: Captures;
}

export const PARSE_OPTIONS: Options = {
  ecmaVersion: "latest",
  sourceType: "module",
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowHashBang: true,
};

const SINGLE = /^\$[A-Z_][A-Z0-9_]*$/;
const MULTI = /^\$\$\$([A-Z_][A-Z0-9_]*)?$/;
const META_KEYS = new Set(["type", "start", "end", "loc", "range"]);
const IGNORED_KEYS = new Set(["type", "start", "end", "loc", "range", "raw", "shorthand", "method"]);
const EMPTY: Captures = new Map();

export const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && typeof (v as Node).type === "string" && typeof (v as Node).start === "number";

export function parseFile(code: string, sourceType: "module" | "script" = "module"): ParsedFile {
  const ast = parse(code, { ...PARSE_OPTIONS, sourceType }) as unknown as Node;
  const byType = new Map<string, Node[]>();
  const stack: Node[] = [ast];
  while (stack.length > 0) {
    const n = stack.pop()!;
    let list = byType.get(n.type);
    if (!list) byType.set(n.type, (list = []));
    list.push(n);
    const kids = children(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return { code, ast, byType };
}

function children(n: Node): Node[] {
  const out: Node[] = [];
  for (const key in n) {
    if (META_KEYS.has(key)) continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const x of v) if (isNode(x)) out.push(x);
    } else if (isNode(v)) out.push(v);
  }
  return out;
}

export interface ParentLink {
  parent: Node;
  key: string;
  index: number | undefined;
}

/** Finds the node that directly contains `target`, and under which key (and list index). */
export function parentOf(root: Node, target: Node): ParentLink | undefined {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    for (const key in n) {
      if (META_KEYS.has(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          const x = v[i];
          if (x === target) return { parent: n, key, index: i };
          if (isNode(x) && x.start <= target.start && x.end >= target.end) stack.push(x);
        }
      } else if (v === target) return { parent: n, key, index: undefined };
      else if (isNode(v) && v.start <= target.start && v.end >= target.end) stack.push(v);
    }
  }
  return undefined;
}

export function compilePattern(source: string): CompiledPattern {
  const root = parsePattern(source);
  const bare = root.type === "ExpressionStatement" ? root.expression : root;
  if (bare.type === "Identifier" && (SINGLE.test(bare.name) || MULTI.test(bare.name))) {
    throw new Error(`pattern "${source}" is only a blank; add concrete code around it`);
  }
  return { source, root };
}

function parsePattern(src: string): Node {
  const p = (code: string) => parse(code, PARSE_OPTIONS) as unknown as Node;
  const asExpression = () => {
    const body = p(`(${src}\n)`).body;
    return body.length === 1 && body[0].type === "ExpressionStatement" ? body[0].expression : undefined;
  };
  const asStatement = () => {
    const body = p(src).body;
    // `key: value` would parse as a labeled statement; authors mean an object member.
    return body.length === 1 && body[0].type !== "LabeledStatement" ? body[0] : undefined;
  };
  // `function f() {}` and `class C {}` also parse as expressions; authors mean declarations.
  const declarationFirst = /^\s*(async\s+)?(function|class)\b/.test(src);
  const attempts: Array<() => Node | undefined> = [
    ...(declarationFirst ? [asStatement, asExpression] : [asExpression, asStatement]),
    () => {
      const members = p(`class _ {\n${src}\n}`).body[0].body.body;
      return members.length === 1 ? members[0] : undefined;
    },
    () => {
      const props = p(`({\n${src}\n})`).body[0].expression.properties;
      return props.length === 1 ? props[0] : undefined;
    },
    () => {
      const cases = p(`switch (_) {\n${src}\n}`).body[0].cases;
      return cases.length === 1 ? cases[0] : undefined;
    },
  ];
  for (const attempt of attempts) {
    try {
      const node = attempt();
      if (node) return node;
    } catch {
      // not valid in this context; try the next one
    }
  }
  throw new Error(`pattern is not one JavaScript expression, statement, class member, object member or switch case: ${src}`);
}

export function findMatches(p: CompiledPattern, file: ParsedFile, within?: { start: number; end: number }): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const t of file.byType.get(p.root.type) ?? []) {
    if (within && (t.start < within.start || t.end > within.end)) continue;
    const captures = matchNode(p.root, t, file.code, EMPTY);
    if (captures) out.push({ node: t, captures });
  }
  return out.sort((a, b) => a.node.start - b.node.start);
}

const isBlank = (n: Node) => n.type === "Identifier" && SINGLE.test(n.name);
const isStatementType = (t: string) => t.endsWith("Statement") || t.endsWith("Declaration");

export function textOf(code: string, v: Node | Node[]): string {
  if (Array.isArray(v)) return v.length === 0 ? "" : code.slice(v[0].start, v[v.length - 1].end);
  return code.slice(v.start, v.end);
}

function bind(caps: Captures, name: string, value: Node | Node[], code: string): Captures | null {
  if (name === "" || name === "_") return caps;
  const prev = caps.get(name);
  if (prev !== undefined) return textOf(code, prev) === textOf(code, value) ? caps : null;
  return new Map(caps).set(name, value);
}

/** The name of a `$$$`/`$$$NAME` list blank ("" when unnamed), or undefined if `n` is not one. */
function listWildcard(n: Node | null): string | undefined {
  if (!n) return undefined;
  let id: Node | undefined;
  if (n.type === "Identifier") id = n;
  else if (n.type === "ExpressionStatement") id = n.expression;
  else if (n.type === "Property" && n.shorthand) id = n.key;
  else if (n.type === "PropertyDefinition" && n.value === null) id = n.key;
  else if (n.type === "SwitchCase" && n.consequent.length === 0) id = n.test ?? undefined;
  if (id?.type !== "Identifier") return undefined;
  const m = MULTI.exec(id.name);
  return m ? (m[1] ?? "") : undefined;
}

export function matchNode(p: Node | null, t: Node | null, code: string, caps: Captures): Captures | null {
  if (p === null || t === null) return p === t ? caps : null;
  if (p.type === "Identifier" && SINGLE.test(p.name)) return bind(caps, p.name.slice(1), t, code);
  if (p.type === "ExpressionStatement" && isBlank(p.expression) && isStatementType(t.type)) {
    return bind(caps, p.expression.name.slice(1), t, code);
  }
  if (p.type !== t.type) return null;
  switch (p.type) {
    case "Literal":
      return literalEqual(p, t) ? caps : null;
    case "TemplateElement":
      return p.value.cooked === t.value.cooked ? caps : null;
    case "ObjectExpression":
    case "ObjectPattern":
      return matchSubset(p.properties, t.properties, code, caps);
    case "SwitchStatement": {
      const c = matchNode(p.discriminant, t.discriminant, code, caps);
      return c && matchSubset(p.cases, t.cases, code, c);
    }
    case "Property":
      return matchProperty(p, t, code, caps);
  }
  let c: Captures | null = caps;
  for (const key of Object.keys(p)) {
    if (IGNORED_KEYS.has(key)) continue;
    const pv = p[key];
    const tv = t[key];
    if (Array.isArray(pv)) c = Array.isArray(tv) ? matchList(pv, tv, code, c) : null;
    else if (isNode(pv)) c = isNode(tv) ? matchNode(pv, tv, code, c) : null;
    else if (pv === null || typeof pv !== "object") c = pv === tv ? c : null;
    else c = JSON.stringify(pv) === JSON.stringify(tv) ? c : null;
    if (!c) return null;
  }
  return c;
}

function literalEqual(p: Node, t: Node): boolean {
  if (p.regex || t.regex) {
    return !!p.regex && !!t.regex && p.regex.pattern === t.regex.pattern && p.regex.flags === t.regex.flags;
  }
  if (p.bigint !== undefined || t.bigint !== undefined) return p.bigint === t.bigint;
  return p.value === t.value;
}

function propKey(n: Node): string | undefined {
  if (n.computed) return undefined;
  if (n.key.type === "Identifier") return n.key.name;
  if (n.key.type === "Literal") return String(n.key.value);
  return undefined;
}

function matchProperty(p: Node, t: Node, code: string, caps: Captures): Captures | null {
  if (p.kind !== t.kind || p.computed !== t.computed) return null;
  let c: Captures | null;
  if (!p.computed && p.key.type === "Identifier" && SINGLE.test(p.key.name)) c = bind(caps, p.key.name.slice(1), t.key, code);
  else if (!p.computed) c = propKey(p) !== undefined && propKey(p) === propKey(t) ? caps : null;
  else c = matchNode(p.key, t.key, code, caps);
  return c && matchNode(p.value, t.value, code, c);
}

function matchSubset(ps: Node[], ts: Node[], code: string, caps: Captures): Captures | null {
  const wanted = ps.filter((p) => listWildcard(p) === undefined);
  const used = new Array<boolean>(ts.length).fill(false);
  const go = (i: number, c: Captures): Captures | null => {
    if (i === wanted.length) return c;
    for (let j = 0; j < ts.length; j++) {
      if (used[j]) continue;
      const c2 = matchNode(wanted[i], ts[j], code, c);
      if (!c2) continue;
      used[j] = true;
      const r = go(i + 1, c2);
      used[j] = false;
      if (r) return r;
    }
    return null;
  };
  return go(0, caps);
}

function matchList(ps: (Node | null)[], ts: (Node | null)[], code: string, caps: Captures): Captures | null {
  const go = (i: number, j: number, c: Captures): Captures | null => {
    if (i === ps.length) return j === ts.length ? c : null;
    const wild = listWildcard(ps[i]);
    if (wild !== undefined) {
      for (let k = j; k <= ts.length; k++) {
        const c2 = bind(c, wild, ts.slice(j, k).filter(isNode), code);
        const r = c2 && go(i + 1, k, c2);
        if (r) return r;
      }
      return null;
    }
    if (j >= ts.length) return null;
    const c2 = matchNode(ps[i], ts[j], code, c);
    return c2 && go(i + 1, j + 1, c2);
  };
  return go(0, 0, caps);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/engine/test/pattern.test.ts && npm run typecheck`
Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/pattern.ts packages/engine/test/pattern.test.ts packages/engine/package.json package-lock.json
git commit -m "feat(engine): by-example pattern matcher over acorn ASTs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Edit buffer (splices, conflicts, per-patch transactions)

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/engine/src/edits.ts`
- Test: `packages/engine/test/edits.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Edit { file; start; end; text; patch; seq }`
  - `class EditConflictError extends Error`
  - `class EditBuffer` with:
    - `current: string | undefined`: the label of the running patch
    - `record(file, start, end, text)`: an insert is `start === end`
    - `drop(patch)`
    - `files(keep: ReadonlySet<string>): string[]`
    - `patchesFor(file, keep): string[]`
    - `apply(file, original, keep): string`

**Rules (spec §5.4):**
- Offsets always refer to the original text.
- Overlapping replace/remove ranges, or an insert strictly inside a replaced range, throw `EditConflictError` naming both patches.
- Inserts at the same offset keep recording order.
- An insert at a range's start goes before the replacement; one at its end goes after.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/edits.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditBuffer } from "../src/edits.ts";

function buffer(patch = "P") {
  const b = new EditBuffer();
  b.current = patch;
  return b;
}

test("replaces and inserts apply against the original offsets", () => {
  const b = buffer();
  b.record("f", 1, 3, "XY");
  b.record("f", 3, 3, "+");
  b.record("f", 0, 0, "<");
  b.record("f", 6, 6, ">");
  assert.equal(b.apply("f", "abcdef", new Set(["P"])), "<aXY+def>");
});

test("same-offset inserts keep their order and go before a range starting there", () => {
  const b = buffer();
  b.record("f", 2, 2, "1");
  b.record("f", 2, 2, "2");
  b.record("f", 2, 4, "R");
  assert.equal(b.apply("f", "abcdef", new Set(["P"])), "ab12Ref");
});

test("overlapping ranges and inserts inside replaced code name both patches", () => {
  const b = buffer("One");
  b.record("f", 0, 3, "x");
  b.current = "Two";
  b.record("f", 2, 4, "y");
  assert.throws(() => b.apply("f", "abcdef", new Set(["One", "Two"])), /"One" and "Two"/);
  const c = buffer("One");
  c.record("f", 0, 4, "");
  c.current = "Two";
  c.record("f", 2, 2, "z");
  assert.throws(() => c.apply("f", "abcdef", new Set(["One", "Two"])), /"One" and "Two"/);
});

test("dropped and not-kept patches leave no trace", () => {
  const b = buffer("A");
  b.record("f", 0, 1, "X");
  b.current = "B";
  b.record("f", 1, 2, "Y");
  b.record("g", 0, 0, "!");
  b.drop("B");
  assert.equal(b.apply("f", "ab", new Set(["A", "B"])), "Xb");
  assert.equal(b.apply("f", "ab", new Set()), "ab");
  assert.deepEqual(b.files(new Set(["A", "B"])), ["f"]);
  assert.deepEqual(b.patchesFor("f", new Set(["A"])), ["A"]);
});

test("edits outside a running patch or past the end are refused", () => {
  assert.throws(() => new EditBuffer().record("f", 0, 0, "x"), /while a patch runs/);
  assert.throws(() => buffer().record("f", 3, 1, "x"), /invalid edit range/);
  const b = buffer();
  b.record("f", 0, 9, "x");
  assert.throws(() => b.apply("f", "abc", new Set(["P"])), /past the end/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/engine/test/edits.test.ts`
Expected: FAIL, module not found `../src/edits.ts`.

- [ ] **Step 3: Implement**

`packages/engine/src/edits.ts`:
```ts
export interface Edit {
  file: string;
  start: number;
  end: number;
  text: string;
  patch: string;
  seq: number;
}

export class EditConflictError extends Error {}

/** Text splices against original file contents, each tagged with the patch that made it. */
export class EditBuffer {
  private edits: Edit[] = [];
  private seq = 0;
  /** Label of the patch whose edits are being recorded; the job runner sets it around each patch. */
  current: string | undefined;

  record(file: string, start: number, end: number, text: string): void {
    if (this.current === undefined) throw new Error("edits can only be made while a patch runs");
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error(`invalid edit range ${start}..${end} in ${file}`);
    }
    this.edits.push({ file, start, end, text, patch: this.current, seq: this.seq++ });
  }

  /** Forgets every edit of a patch that failed or was skipped. */
  drop(patch: string): void {
    this.edits = this.edits.filter((e) => e.patch !== patch);
  }

  files(keep: ReadonlySet<string>): string[] {
    return [...new Set(this.edits.filter((e) => keep.has(e.patch)).map((e) => e.file))];
  }

  patchesFor(file: string, keep: ReadonlySet<string>): string[] {
    return [...new Set(this.edits.filter((e) => e.file === file && keep.has(e.patch)).map((e) => e.patch))];
  }

  apply(file: string, original: string, keep: ReadonlySet<string>): string {
    const mine = this.edits.filter((e) => e.file === file && keep.has(e.patch));
    for (const e of mine) {
      if (e.end > original.length) throw new Error(`an edit by "${e.patch}" is past the end of ${file}`);
    }
    const byPosition = (a: Edit, b: Edit) => a.start - b.start || a.seq - b.seq;
    const ranges = mine.filter((e) => e.end > e.start).sort(byPosition);
    const inserts = mine.filter((e) => e.end === e.start).sort(byPosition);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start < ranges[i - 1].end) throw conflict(file, ranges[i - 1], ranges[i]);
    }
    for (const ins of inserts) {
      const inside = ranges.find((r) => ins.start > r.start && ins.start < r.end);
      if (inside) throw conflict(file, inside, ins);
    }
    let out = "";
    let cursor = 0;
    let next = 0;
    const flushInserts = (upTo: number) => {
      while (next < inserts.length && inserts[next].start <= upTo) {
        out += original.slice(cursor, inserts[next].start) + inserts[next].text;
        cursor = inserts[next].start;
        next++;
      }
    };
    for (const r of ranges) {
      flushInserts(r.start);
      out += original.slice(cursor, r.start) + r.text;
      cursor = r.end;
    }
    flushInserts(original.length);
    return out + original.slice(cursor);
  }
}

function conflict(file: string, a: Edit, b: Edit): EditConflictError {
  return new EditConflictError(
    `patches "${a.patch}" and "${b.patch}" edit overlapping code in ${file} (offsets ${a.start}..${a.end} and ${b.start}..${b.end})`,
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/engine/test/edits.test.ts && npm run typecheck`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/edits.ts packages/engine/test/edits.test.ts
git commit -m "feat(engine): per-patch edit buffer with conflict detection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sources, matches and fingerprint resolution

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/engine/src/sources.ts`, `packages/engine/src/match.ts`, `packages/engine/src/fingerprint.ts`
- Test: `packages/engine/test/match.test.ts`, `packages/engine/test/fingerprint.test.ts`

**Interfaces:**
- Consumes:
  - Task 5: `AsarArchive`, `listAsarFiles`, `readAsarFile`
  - Task 6: `parseFile`, `ParsedFile`, `compilePattern`, `findMatches`, `parentOf`, `Captures`, `Node`
  - Task 7: `EditBuffer`
  - SDK types `Match`, `Capture`, `Fingerprint`
- Produces:
  - `sources.ts`:
    - `interface SourceStore { list(): string[]; read(path): Buffer }`
    - `memoryStore(files: Record<string, string | Buffer>)`, `asarStore(a)`
    - `class Sources` with `list()`, `has(path)`, `jsFiles(scope)`, `buffer(path)`, `text(path)`, `parsed(path)`
  - `match.ts`:
    - `interface Host { sources: Sources; edits: EditBuffer }`
    - `interface CaptureSpec { start; end; node?; items? }`
    - classes `Range`, `MatchImpl` (implements SDK `Match`), `CaptureImpl` (implements SDK `Capture`)
    - `fromPattern(host, file, node, captures): MatchImpl`
  - `fingerprint.ts`:
    - `class FingerprintError extends Error { fingerprint; step; detail }`
    - `class Fingerprints { constructor(host); resolve(fp): MatchImpl[] }`

**Behavior:**
- **List awareness.** When a match's node sits in a comma list (`elements`, `arguments`, `params`, `properties`, `declarations`, `specifiers`, or `expressions` outside template literals):
  - `insertBefore`/`insertAfter` add `, `.
  - `remove()` also removes one neighbouring comma.
- **Line lists.** In statement-like lists (`body`, `consequent`, `cases`), inserts add a newline.
- **Steps.** Fingerprint steps run in the order of spec §5.3. Their error texts are what users see (spec §5.6).

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/match.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditBuffer } from "../src/edits.ts";
import { fromPattern } from "../src/match.ts";
import { compilePattern, findMatches } from "../src/pattern.ts";
import { memoryStore, Sources } from "../src/sources.ts";

function matchIn(code: string, pattern: string) {
  const host = { sources: new Sources(memoryStore({ "a.js": code })), edits: new EditBuffer() };
  host.edits.current = "P";
  const matches = findMatches(compilePattern(pattern), host.sources.parsed("a.js")).map((m) =>
    fromPattern(host, "a.js", m.node, m.captures),
  );
  return { matches, result: () => host.edits.apply("a.js", code, new Set(["P"])) };
}

test("inserts next to array elements and object properties add commas", () => {
  let t = matchIn('x = ["a", "b"];', '"a"');
  t.matches[0].insertAfter('"z"');
  assert.equal(t.result(), 'x = ["a", "z", "b"];');
  t = matchIn('x = ["a", "b"];', '"a"');
  t.matches[0].insertBefore('"z"');
  assert.equal(t.result(), 'x = ["z", "a", "b"];');
  t = matchIn("o = { a: 1, b: 2 };", "a: 1");
  t.matches[0].insertAfter("c: 3");
  assert.equal(t.result(), "o = { a: 1, c: 3, b: 2 };");
});

test("inserts next to switch cases and statements add a newline", () => {
  const t = matchIn("switch (s) { case 1: { f(); } }", "case 1: { $$$ }");
  t.matches[0].insertAfter("case 2: { g(); }");
  assert.equal(t.result(), "switch (s) { case 1: { f(); }\ncase 2: { g(); } }");
});

test("remove() takes one neighbouring comma with it", () => {
  for (const [code, pattern, expected] of [
    ["[1, 2, 3]", "2", "[1, 3]"],
    ["[1, 2, 3]", "3", "[1, 2]"],
    ["[1]", "1", "[]"],
  ]) {
    const t = matchIn(code, pattern);
    t.matches[0].remove();
    assert.equal(t.result(), expected);
  }
});

test("captures stringify to their source and can be edited", () => {
  const t = matchIn("f(a, b)", "f($X, $Y)");
  const [m] = t.matches;
  assert.equal(`${m.$X}`, "a");
  m.$Y.replace("c");
  assert.equal(t.result(), "f(a, c)");
});

test("list captures span their items; empty list captures can't be edited", () => {
  const t = matchIn("g(1, 2)", "g($$$ARGS)");
  assert.equal(t.matches[0].$ARGS.text, "1, 2");
  t.matches[0].$ARGS.replace("3");
  assert.equal(t.result(), "g(3)");
  const e = matchIn("f()", "f($$$ARGS)");
  assert.equal(e.matches[0].$ARGS.text, "");
  assert.throws(() => e.matches[0].$ARGS.replace("1"), /empty list capture/);
});

test("find() searches inside the match and needs exactly one hit", () => {
  const t = matchIn("function f() { g(1); g(2); } g(3);", "function f() { $$$ }");
  const [m] = t.matches;
  assert.equal(m.findAll("g($X)").length, 2);
  assert.throws(() => m.find("g($X)"), /expected 1 match, found 2/);
  m.find("g(2)").replace("h()");
  assert.equal(t.result(), "function f() { g(1); h(); } g(3);");
  assert.equal(m.line, 1);
});
```

`packages/engine/test/fingerprint.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "@revamp/sdk";
import { EditBuffer } from "../src/edits.ts";
import { FingerprintError, Fingerprints } from "../src/fingerprint.ts";
import { memoryStore, Sources } from "../src/sources.ts";

const resolver = (files: Record<string, string>) =>
  new Fingerprints({ sources: new Sources(memoryStore(files)), edits: new EditBuffer() });
const files = {
  "out/main.js": "const a = 1;\nfoo(a, 2);\nfoo(b, 3);\n",
  "out/other.js": "bar();\n",
  "node_modules/lib/index.js": "foo(lib, 2);\n",
  "out/style.css": "foo(a, 2)",
};

function failure(fn: () => unknown): FingerprintError {
  try {
    fn();
  } catch (e) {
    if (e instanceof FingerprintError) return e;
    throw e;
  }
  assert.fail("expected a FingerprintError");
}

test("strings → pattern → count returns one match with captures and a line number", () => {
  const [m] = resolver(files).resolve(fingerprint({ name: "foo two", strings: ["foo("], pattern: "foo($X, 2)" }));
  assert.equal(m.file, "out/main.js");
  assert.equal(m.line, 2);
  assert.equal(`${m.$X}`, "a");
});

test("each failing step is named in the error", () => {
  const r = resolver(files);
  let e = failure(() => r.resolve(fingerprint({ name: "nope", strings: ["nope", "foo("], pattern: "foo($X)" })));
  assert.equal(e.step, "strings");
  assert.match(e.message, /fingerprint "nope" failed at step "strings".*"nope" in 0 file\(s\), "foo\(" in 1 file\(s\)/);
  e = failure(() => r.resolve(fingerprint({ name: "foo four", strings: ["foo("], pattern: "foo($X, 4)" })));
  assert.equal(e.step, "pattern");
  assert.match(e.message, /strings matched 1 file\(s\): out\/main\.js; pattern foo\(\$X, 4\) matched 0 nodes/);
  e = failure(() =>
    r.resolve(fingerprint({ name: "w", strings: ["foo("], pattern: "foo($X, 2)", where: { "in renderer": (m) => m.file.startsWith("out/renderer/") } })),
  );
  assert.equal(e.step, "where:in renderer");
  e = failure(() => r.resolve(fingerprint({ name: "any foo", strings: ["foo("], pattern: "foo($X, $Y)" })));
  assert.equal(e.step, "count");
  assert.match(e.message, /expected exactly 1 match, found 2: out\/main\.js:2, out\/main\.js:3/);
});

test("scope app skips node_modules, scope all searches it, count many returns every match", () => {
  const r = resolver(files);
  const all = r.resolve(fingerprint({ name: "all foo two", strings: ["foo("], pattern: "foo($X, 2)", scope: "all", count: "many" }));
  assert.deepEqual(all.map((m) => m.file).sort(), ["node_modules/lib/index.js", "out/main.js"]);
});

test("results and errors are cached per fingerprint", () => {
  const r = resolver(files);
  const fp = fingerprint({ name: "foo two", strings: ["foo("], pattern: "foo($X, 2)" });
  assert.equal(r.resolve(fp), r.resolve(fp));
  const bad = fingerprint({ name: "bad", strings: ["zzz"], pattern: "x()" });
  assert.equal(failure(() => r.resolve(bad)), failure(() => r.resolve(bad)));
});

test("regex fingerprints expose named groups as captures", () => {
  const r = resolver({ "out/v.js": 'const VERSION = "1.2.3";\n' });
  const [m] = r.resolve(fingerprint({ name: "version", strings: ["VERSION"], regex: /VERSION = "(?<V>[\d.]+)"/g }));
  assert.equal(m.node, undefined);
  assert.equal(m.$V.text, "1.2.3");
});

test("sloppy scripts still parse; unparsable files are reported", () => {
  const r = resolver({ "lib/old.js": "with (a) { foo(1, 2); }\n", "lib/broken.js": "foo(1, 2) +;\n" });
  assert.equal(r.resolve(fingerprint({ name: "old", strings: ["with ("], pattern: "foo(1, 2)" })).length, 1);
  const e = failure(() => r.resolve(fingerprint({ name: "broken", strings: ["+;"], pattern: "foo(1, 2)" })));
  assert.match(e.message, /could not parse lib\/broken\.js/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test packages/engine/test/match.test.ts packages/engine/test/fingerprint.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`packages/engine/src/sources.ts`:
```ts
import { listAsarFiles, readAsarFile, type AsarArchive } from "./asar.ts";
import { parseFile, type ParsedFile } from "./pattern.ts";

export interface SourceStore {
  list(): string[];
  /** Throws if the file does not exist. */
  read(path: string): Buffer;
}

export function memoryStore(files: Record<string, string | Buffer>): SourceStore {
  return {
    list: () => Object.keys(files),
    read: (path) => {
      if (!Object.hasOwn(files, path)) throw new Error(`no file "${path}" in the app`);
      const v = files[path];
      return typeof v === "string" ? Buffer.from(v) : v;
    },
  };
}

export function asarStore(a: AsarArchive): SourceStore {
  const files = listAsarFiles(a);
  const known = new Set(files);
  return {
    list: () => files,
    read: (path) => {
      if (!known.has(path)) throw new Error(`no file "${path}" in the app`);
      return readAsarFile(a, path);
    },
  };
}

const JS = /\.(c|m)?js$/;
const IN_NODE_MODULES = /(^|\/)node_modules\//;

/** Read-through cache over one app's files: raw bytes for prefiltering, text and ASTs for matching. */
export class Sources {
  readonly store: SourceStore;
  private listing: Set<string> | undefined;
  private texts = new Map<string, string>();
  private asts = new Map<string, ParsedFile>();

  constructor(store: SourceStore) {
    this.store = store;
  }

  list(): string[] {
    return [...this.known()];
  }

  has(path: string): boolean {
    return this.known().has(path);
  }

  jsFiles(scope: "app" | "all"): string[] {
    return this.list().filter((p) => JS.test(p) && (scope === "all" || !IN_NODE_MODULES.test(p)));
  }

  /** Raw bytes, not cached: prefiltering may touch thousands of files once. */
  buffer(path: string): Buffer {
    return this.store.read(path);
  }

  text(path: string): string {
    let t = this.texts.get(path);
    if (t === undefined) {
      t = this.store.read(path).toString("utf8");
      this.texts.set(path, t);
    }
    return t;
  }

  /** Parses as an ES module; non-.mjs files fall back to a sloppy script. */
  parsed(path: string): ParsedFile {
    let f = this.asts.get(path);
    if (!f) {
      const code = this.text(path);
      try {
        f = parseFile(code);
      } catch (moduleError) {
        if (path.endsWith(".mjs")) throw moduleError;
        try {
          f = parseFile(code, "script");
        } catch {
          throw moduleError;
        }
      }
      this.asts.set(path, f);
    }
    return f;
  }

  private known(): Set<string> {
    return (this.listing ??= new Set(this.store.list()));
  }
}
```

`packages/engine/src/match.ts`:
```ts
import type { Capture, Match } from "@revamp/sdk";
import type { EditBuffer } from "./edits.ts";
import { compilePattern, findMatches, parentOf, type Captures, type Node, type ParentLink } from "./pattern.ts";
import type { Sources } from "./sources.ts";

export interface Host {
  sources: Sources;
  edits: EditBuffer;
}

export interface CaptureSpec {
  start: number;
  end: number;
  node?: Node;
  items?: Node[];
}

const COMMA_LISTS = new Set(["elements", "arguments", "params", "properties", "declarations", "specifiers", "expressions"]);
const isCommaList = (l: ParentLink) => COMMA_LISTS.has(l.key) && l.parent.type !== "TemplateLiteral";

/** An editable span of one file: the base of matches and captures. start < 0 marks an empty list capture. */
export class Range {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly node: Node | undefined;
  protected readonly host: Host;

  constructor(host: Host, file: string, start: number, end: number, node: Node | undefined) {
    this.host = host;
    this.file = file;
    this.start = start;
    this.end = end;
    this.node = node;
  }

  get text(): string {
    return this.start < 0 ? "" : this.host.sources.text(this.file).slice(this.start, this.end);
  }

  toString(): string {
    return this.text;
  }

  replace(code: string): void {
    this.edit(this.start, this.end, code);
  }

  insertBefore(code: string): void {
    const list = this.listKind();
    this.edit(this.start, this.start, list === "comma" ? `${code}, ` : list === "lines" ? `${code}\n` : code);
  }

  insertAfter(code: string): void {
    const list = this.listKind();
    this.edit(this.end, this.end, list === "comma" ? `, ${code}` : list === "lines" ? `\n${code}` : code);
  }

  remove(): void {
    const link = this.link();
    if (link?.index !== undefined && isCommaList(link)) {
      const siblings = link.parent[link.key] as Node[];
      if (link.index + 1 < siblings.length) return this.edit(this.start, siblings[link.index + 1].start, "");
      if (link.index > 0) return this.edit(siblings[link.index - 1].end, this.end, "");
    }
    this.edit(this.start, this.end, "");
  }

  private link(): ParentLink | undefined {
    return this.node ? parentOf(this.host.sources.parsed(this.file).ast, this.node) : undefined;
  }

  private listKind(): "comma" | "lines" | undefined {
    const link = this.link();
    if (link?.index === undefined) return undefined;
    return isCommaList(link) ? "comma" : "lines";
  }

  private edit(start: number, end: number, text: string): void {
    if (this.start < 0) throw new Error(`can't edit an empty list capture in ${this.file}`);
    this.host.edits.record(this.file, start, end, text);
  }
}

export class CaptureImpl extends Range implements Capture {
  readonly items: readonly Node[] | undefined;

  constructor(host: Host, file: string, spec: CaptureSpec) {
    super(host, file, spec.start, spec.end, spec.node);
    this.items = spec.items;
  }
}

export class MatchImpl extends Range implements Match {
  readonly line: number;
  readonly [capture: `$${string}`]: Capture;

  constructor(host: Host, file: string, start: number, end: number, node: Node | undefined, captures: ReadonlyMap<string, CaptureSpec>) {
    super(host, file, start, end, node);
    this.line = lineAt(host.sources.text(file), start);
    for (const [name, spec] of captures) {
      Object.defineProperty(this, `$${name}`, { value: new CaptureImpl(host, file, spec), enumerable: true });
    }
  }

  find(pattern: string): Match {
    const all = this.findAll(pattern);
    if (all.length !== 1) {
      throw new Error(`find(\`${pattern}\`) inside ${this.file}:${this.line} expected 1 match, found ${all.length}`);
    }
    return all[0];
  }

  findAll(pattern: string): Match[] {
    if (!this.node) throw new Error("find() works on pattern matches, not regex matches");
    const parsed = this.host.sources.parsed(this.file);
    return findMatches(compilePattern(pattern), parsed, this).map((m) => fromPattern(this.host, this.file, m.node, m.captures));
  }
}

export function fromPattern(host: Host, file: string, node: Node, captures: Captures): MatchImpl {
  const specs = new Map<string, CaptureSpec>();
  for (const [name, v] of captures) {
    if (!Array.isArray(v)) specs.set(name, { start: v.start, end: v.end, node: v });
    else if (v.length === 0) specs.set(name, { start: -1, end: -1, items: v });
    else specs.set(name, { start: v[0].start, end: v[v.length - 1].end, items: v });
  }
  return new MatchImpl(host, file, node.start, node.end, node, specs);
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) line++;
  return line;
}
```

`packages/engine/src/fingerprint.ts`:
```ts
import type { Fingerprint } from "@revamp/sdk";
import { fromPattern, MatchImpl, type CaptureSpec, type Host } from "./match.ts";
import { compilePattern, findMatches } from "./pattern.ts";

export class FingerprintError extends Error {
  readonly fingerprint: string;
  readonly step: string;
  readonly detail: string;

  constructor(fingerprint: string, step: string, detail: string) {
    super(`fingerprint "${fingerprint}" failed at step "${step}": ${detail}`);
    this.fingerprint = fingerprint;
    this.step = step;
    this.detail = detail;
  }
}

const brief = (items: string[], max = 5) =>
  items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`;

/** Resolves fingerprints against one app's files. Results and errors are cached for the whole job. */
export class Fingerprints {
  private readonly host: Host;
  private cache = new Map<Fingerprint, MatchImpl[] | FingerprintError>();

  constructor(host: Host) {
    this.host = host;
  }

  resolve(fp: Fingerprint): MatchImpl[] {
    let r = this.cache.get(fp);
    if (r === undefined) {
      try {
        r = this.compute(fp);
      } catch (e) {
        if (!(e instanceof FingerprintError)) throw e;
        r = e;
      }
      this.cache.set(fp, r);
    }
    if (r instanceof FingerprintError) throw r;
    return r;
  }

  private compute(fp: Fingerprint): MatchImpl[] {
    const { sources } = this.host;
    const scope = fp.scope ?? "app";
    const files = sources.jsFiles(scope);
    const hits = files.filter((f) => {
      const b = sources.buffer(f);
      return fp.strings.every((s) => b.includes(s));
    });
    if (hits.length === 0) {
      const counts = fp.strings.map((s) => `${JSON.stringify(s)} in ${files.filter((f) => sources.buffer(f).includes(s)).length} file(s)`);
      throw new FingerprintError(
        fp.name,
        "strings",
        `no file contains all strings (${counts.join(", ")}; searched ${files.length} ${scope === "app" ? "app " : ""}JS files)`,
      );
    }

    let matches: MatchImpl[] = [];
    if (fp.pattern !== undefined) {
      let pattern;
      try {
        pattern = compilePattern(fp.pattern);
      } catch (e) {
        throw new FingerprintError(fp.name, "pattern", (e as Error).message);
      }
      const unparsable: string[] = [];
      for (const f of hits) {
        let parsed;
        try {
          parsed = sources.parsed(f);
        } catch (e) {
          unparsable.push(`${f} (${(e as Error).message})`);
          continue;
        }
        for (const m of findMatches(pattern, parsed)) matches.push(fromPattern(this.host, f, m.node, m.captures));
      }
      if (matches.length === 0) {
        throw new FingerprintError(
          fp.name,
          "pattern",
          `strings matched ${hits.length} file(s): ${brief(hits)}; pattern ${fp.pattern} matched 0 nodes` +
            (unparsable.length > 0 ? `; could not parse ${brief(unparsable)}` : ""),
        );
      }
    } else {
      const re = fp.regex!;
      const flags = re.flags.includes("d") ? re.flags : `${re.flags}d`;
      for (const f of hits) {
        for (const m of sources.text(f).matchAll(new RegExp(re.source, flags))) {
          const specs = new Map<string, CaptureSpec>();
          for (const [name, span] of Object.entries(m.indices?.groups ?? {})) {
            if (span) specs.set(name, { start: span[0], end: span[1] });
          }
          matches.push(new MatchImpl(this.host, f, m.index, m.index + m[0].length, undefined, specs));
        }
      }
      if (matches.length === 0) {
        throw new FingerprintError(fp.name, "regex", `strings matched ${hits.length} file(s): ${brief(hits)}; regex ${re} matched nothing`);
      }
    }

    for (const [name, check] of Object.entries(fp.where ?? {})) {
      const before = matches.length;
      matches = matches.filter((m) => check(m));
      if (matches.length === 0) throw new FingerprintError(fp.name, `where:${name}`, `${before} match(es) before this check, 0 after`);
    }
    if ((fp.count ?? "one") === "one" && matches.length !== 1) {
      throw new FingerprintError(
        fp.name,
        "count",
        `expected exactly 1 match, found ${matches.length}: ${brief(matches.map((m) => `${m.file}:${m.line}`))}`,
      );
    }
    return matches;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/engine/test/match.test.ts packages/engine/test/fingerprint.test.ts && npm run typecheck`
Expected: `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/sources.ts packages/engine/src/match.ts packages/engine/src/fingerprint.ts packages/engine/test/match.test.ts packages/engine/test/fingerprint.test.ts
git commit -m "feat(engine): fingerprint resolution with list-aware editable matches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Patch graph and the job runner

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/engine/src/graph.ts`, `packages/engine/src/job.ts`
- Test: `packages/engine/test/job.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `Selection`
  - Task 5: `assertAsarPath`
  - Task 6: `PARSE_OPTIONS`
  - Task 7: `EditBuffer`
  - Task 8: `Sources`, `SourceStore`, `Fingerprints`
  - SDK: `AppDef`, `Patch`, `PatchContext`, `TextFile`, `Manifest`
- Produces:
  - `graph.ts`:
    - `type PatchStatus = "applied" | "failed" | "skipped" | "incompatible" | "disabled"`
    - `interface PatchResult { name; status; required; internal; message? }`
    - `interface Plan { order; results; labels }`
    - `planPatches(app, version, patches, selection, force): Plan`
    - `resolveOptions(patch, given): Record<string, unknown>`
  - `job.ts`:
    - `ASAR_PATH = "resources/app.asar"`
    - `interface BundleModule { manifest; apps; patches }`
    - `interface JobInput { appId; version; selection; force; stockDesktop }`
    - `interface JobOutput { results; aborted: string | undefined; outputs: Map<string, Buffer>; desktopEntry; logs }`
    - `runJob(bundle, input, store): JobOutput`
    - `interface SandboxPatchOutput { results; aborted: string | null; files: string[]; desktopEntry; logs }`
    - `interface BundleDescription`, `AppInfo`, `PatchInfo`
    - `describeBundle(bundle): BundleDescription`

**Semantics (spec §5.5):**
- **Selection.** Patches that concern the app are:
  - universal ones
  - ones whose `compatibleWith` names the app
  - required ones

  Of those, the job runs:
  - required patches
  - patches in `enable`
  - non-universal patches that aren't in `disable` and are `default !== false`

  Universal patches run only when required or enabled. Disabling a required patch, or naming an unknown patch, throws. An incompatible version gives status `incompatible` unless `force`.
- **Order.** Dependencies are added transitively, including internal patches. Order is topological; ties go to named patches by name, then internal patches by discovery order.
- **Transactions.**
  - Each patch's edits, added files and desktop-entry changes are kept only if it ends `applied`.
  - A failed dependency makes its dependents `skipped`.
  - `finalize` runs in reverse order over applied patches.
  - A finalize failure fails that patch and skips its dependents.
- **Required failure.** If any required patch is not `applied`, the job returns `aborted` with no outputs.
- **Output check.** Every changed `.js`/`.mjs`/`.cjs` file must re-parse, otherwise the job throws naming the file and the patches that edited it.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/job.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineApp, definePatch, fingerprint, option, type Patch } from "@revamp/sdk";
import { describeBundle, runJob, type BundleModule, type JobInput } from "../src/job.ts";
import { memoryStore } from "../src/sources.ts";

const app = defineApp({
  id: "demo",
  name: "Demo",
  release: { github: "example/demo", tag: "v{version}", asset: "demo_{version}_amd64.deb" },
  installDir: "opt/Demo",
  executable: "demo",
  desktopFile: "usr/share/applications/demo.desktop",
  versions: { "1.0.0": { sha256: "a".repeat(64) }, "2.0.0": { sha256: "b".repeat(64) } },
});
const hello = fingerprint({ name: "hello call", strings: ['"hello"'], pattern: 'log("hello")' });
const files = { "package.json": '{"name":"demo"}', "out/main.js": 'log("hello");\nlog("world");\n' };
const manifest = { name: "Test", version: "1.0.0", minEngine: "0.1.0", author: "t", license: "GPL-3.0-only", source: "test" };
const bundle = (patches: Patch<any>[], required: Patch<any>[] = []): BundleModule => ({ manifest, apps: [{ ...app, required }], patches });
const input = (o: Partial<JobInput> = {}): JobInput => ({
  appId: "demo",
  version: "1.0.0",
  selection: { enable: [], disable: [], options: {} },
  force: false,
  stockDesktop: { Name: "Demo", Exec: "/opt/Demo/demo" },
  ...o,
});
const run = (b: BundleModule, i = input()) => runJob(b, i, memoryStore(files));
const statuses = (out: ReturnType<typeof run>) => out.results.map((r) => [r.name, r.status]);

test("applies patches, writes outputs and merges desktop entry changes", () => {
  const greet = definePatch({
    name: "Greet",
    compatibleWith: [{ app }],
    execute(ctx) {
      ctx.match(hello).replace('log("hi")');
      ctx.desktopEntry.Name = "Demo (Revamped)";
    },
  });
  const pkg = definePatch({
    name: "Pkg",
    compatibleWith: [{ app }],
    execute(ctx) {
      const f = ctx.file("package.json");
      f.setJson({ ...f.json<object>(), desktopName: "x.desktop" });
      ctx.addFile("out/extra.js", "1;");
      ctx.log("added extra.js");
    },
  });
  const out = run(bundle([greet, pkg]));
  assert.equal(out.aborted, undefined);
  assert.deepEqual(statuses(out), [["Greet", "applied"], ["Pkg", "applied"]]);
  assert.equal(out.outputs.get("out/main.js")!.toString(), 'log("hi");\nlog("world");\n');
  assert.deepEqual(JSON.parse(out.outputs.get("package.json")!.toString()), { name: "demo", desktopName: "x.desktop" });
  assert.equal(out.outputs.get("out/extra.js")!.toString(), "1;");
  assert.deepEqual(out.desktopEntry, { Name: "Demo (Revamped)", Exec: "/opt/Demo/demo" });
  assert.deepEqual(out.logs, ["[Pkg] added extra.js"]);
});

test("a failing patch leaves no edits and its dependents are skipped", () => {
  const bad = definePatch({
    name: "Bad",
    compatibleWith: [{ app }],
    execute(ctx) {
      ctx.match(hello).replace("X");
      throw new Error("boom");
    },
  });
  const after = definePatch({ name: "After", compatibleWith: [{ app }], dependsOn: [bad], execute() {} });
  const out = run(bundle([bad, after]));
  assert.deepEqual(statuses(out), [["Bad", "failed"], ["After", "skipped"]]);
  assert.equal(out.results[0].message, "boom");
  assert.match(out.results[1].message!, /dependency "Bad" failed/);
  assert.equal(out.outputs.size, 0);
});

test("a fingerprint miss fails the patch naming the fingerprint and step", () => {
  const miss = fingerprint({ name: "missing call", strings: ['"nope"'], pattern: "x()" });
  const p = definePatch({ name: "Miss", compatibleWith: [{ app }], execute: (ctx) => void ctx.match(miss) });
  assert.match(run(bundle([p])).results[0].message!, /fingerprint "missing call" failed at step "strings"/);
});

test("a failed required patch aborts the job", () => {
  const must = definePatch({ name: "Must", execute: () => { throw new Error("boom"); } });
  const out = run(bundle([must], [must]));
  assert.equal(out.aborted, 'required patch "Must" failed: boom');
  assert.equal(out.outputs.size, 0);
});

test("defaults, universal patches, versions, force, enable and disable", () => {
  const uni = definePatch({ name: "Universal", execute() {} });
  const off = definePatch({ name: "Off", default: false, compatibleWith: [{ app }], execute() {} });
  const v2 = definePatch({ name: "Only2", compatibleWith: [{ app, versions: ["2.0.0"] }], execute() {} });
  const other = definePatch({ name: "Other app", compatibleWith: [{ app: { ...app, id: "other" } }], execute() {} });
  const b = bundle([uni, off, v2, other]);
  assert.deepEqual(statuses(run(b)), [["Universal", "disabled"], ["Off", "disabled"], ["Only2", "incompatible"]]);
  const sel = { enable: ["Universal", "Off"], disable: [], options: {} };
  assert.deepEqual(statuses(run(b, input({ selection: sel, force: true }))), [["Universal", "applied"], ["Off", "applied"], ["Only2", "applied"]]);
  assert.throws(() => run(b, input({ selection: { enable: ["Nope"], disable: [], options: {} } })), /unknown patch "Nope"/);
  const must = definePatch({ name: "Must", execute() {} });
  assert.throws(() => run(bundle([must], [must]), input({ selection: { enable: [], disable: ["Must"], options: {} } })), /required/);
});

test("dependencies first, ties by name, internal patches included, finalize in reverse", () => {
  const calls: string[] = [];
  const mk = (name: string, deps: Patch<any>[]) =>
    definePatch({ name, compatibleWith: [{ app }], dependsOn: deps, execute: () => void calls.push(`exec ${name}`), finalize: () => void calls.push(`fin ${name}`) });
  const internal = definePatch({ execute: () => void calls.push("exec internal") });
  const b = mk("B", []);
  const out = run(bundle([mk("C", [b]), b, mk("A", [internal])]));
  assert.deepEqual(calls, ["exec B", "exec C", "exec internal", "exec A", "fin A", "fin C", "fin B"]);
  assert.ok(out.results.some((r) => r.internal && r.status === "applied"));
});

test("options: defaults, given values, validation and unknown keys", () => {
  const seen: unknown[] = [];
  const p = definePatch({
    name: "Opt",
    compatibleWith: [{ app }],
    options: { n: option.number({ title: "N", default: 1, validate: (v) => (v > 0 ? undefined : "must be positive") }) },
    execute: (ctx) => void seen.push(ctx.options.n),
  });
  const withOptions = (o: Record<string, unknown>) => run(bundle([p]), input({ selection: { enable: [], disable: [], options: { Opt: o } } }));
  run(bundle([p]));
  withOptions({ n: 5 });
  assert.deepEqual(seen, [1, 5]);
  assert.match(withOptions({ n: -1 }).results[0].message!, /must be positive/);
  assert.match(withOptions({ zzz: 1 }).results[0].message!, /unknown option "zzz"/);
  assert.match(withOptions({ n: "x" }).results[0].message!, /must be a number/);
});

test("overlapping edits from two patches fail the job naming both", () => {
  const one = definePatch({ name: "One", compatibleWith: [{ app }], execute: (ctx) => ctx.match(hello).replace("a()") });
  const two = definePatch({ name: "Two", compatibleWith: [{ app }], execute: (ctx) => ctx.match(hello).replace("b()") });
  assert.throws(() => run(bundle([one, two])), /"One" and "Two"/);
});

test("output that no longer parses fails the job naming the patch", () => {
  const breaker = definePatch({ name: "Breaker", compatibleWith: [{ app }], execute: (ctx) => ctx.match(hello).replace("log(") });
  assert.throws(() => run(bundle([breaker])), /out\/main\.js is not valid JavaScript.*"Breaker"/s);
});

test("addFile refuses unsafe and existing paths", () => {
  const unsafe = definePatch({ name: "Unsafe", compatibleWith: [{ app }], execute: (ctx) => ctx.addFile("../x.js", "1") });
  const clash = definePatch({ name: "Clash", compatibleWith: [{ app }], execute: (ctx) => ctx.addFile("out/main.js", "1") });
  const out = run(bundle([unsafe, clash]));
  assert.match(out.results.find((r) => r.name === "Unsafe")!.message!, /invalid path/);
  assert.match(out.results.find((r) => r.name === "Clash")!.message!, /already has/);
});

test("describeBundle lists apps and named patches without functions", () => {
  const p = definePatch({ name: "Greet", description: "Says hi", compatibleWith: [{ app }], options: { on: option.bool({ title: "On", default: true }) }, execute() {} });
  const d = describeBundle(bundle([p, definePatch({ execute() {} })]));
  assert.equal(d.apps[0].id, "demo");
  assert.deepEqual(d.patches, [
    { name: "Greet", description: "Says hi", apps: [{ app: "demo", versions: null }], default: true, options: { on: { type: "bool", title: "On", description: "", default: true } } },
  ]);
  assert.doesNotThrow(() => JSON.stringify(d));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/engine/test/job.test.ts`
Expected: FAIL, module not found `../src/job.ts`.

- [ ] **Step 3: Implement**

`packages/engine/src/graph.ts`:
```ts
import type { AppDef, Patch } from "@revamp/sdk";
import type { Selection } from "./config.ts";

export type PatchStatus = "applied" | "failed" | "skipped" | "incompatible" | "disabled";

export interface PatchResult {
  name: string;
  status: PatchStatus;
  required: boolean;
  /** Unnamed patches reached through dependsOn; hidden from users unless they fail. */
  internal: boolean;
  message?: string;
}

export interface Plan {
  /** Patches to run, dependencies first. */
  order: Patch[];
  results: Map<Patch, PatchResult>;
  labels: Map<Patch, string>;
}

export function planPatches(app: AppDef, version: string, bundlePatches: Patch[], selection: Selection, force: boolean): Plan {
  const named = [...new Set([...app.required, ...bundlePatches])].filter((p) => p.name);
  const byName = new Map<string, Patch>();
  for (const p of named) {
    if (byName.has(p.name!)) throw new Error(`two patches are named "${p.name}"`);
    byName.set(p.name!, p);
  }
  for (const n of [...selection.enable, ...selection.disable]) {
    if (!byName.has(n)) throw new Error(`unknown patch "${n}" for ${app.name}`);
  }
  const required = new Set(app.required);
  for (const n of selection.disable) {
    if (required.has(byName.get(n)!)) throw new Error(`patch "${n}" is required for ${app.name} and can't be disabled`);
  }

  const results = new Map<Patch, PatchResult>();
  const labels = new Map<Patch, string>();
  const chosen: Patch[] = [];
  for (const p of named) {
    const universal = p.compatibleWith === undefined;
    const targets = (p.compatibleWith ?? []).filter((c) => c.app.id === app.id);
    if (!universal && targets.length === 0) continue; // a patch for another app
    const compatible = universal || targets.some((c) => !c.versions || c.versions.includes(version));
    const isRequired = required.has(p);
    const wanted =
      isRequired || selection.enable.includes(p.name!) || (!universal && !selection.disable.includes(p.name!) && p.default !== false);
    labels.set(p, p.name!);
    const result: PatchResult = { name: p.name!, status: "disabled", required: isRequired, internal: false };
    results.set(p, result);
    if (!wanted) continue;
    if (!compatible && !force) {
      result.status = "incompatible";
      result.message = `not compatible with ${app.name} ${version}`;
      continue;
    }
    chosen.push(p);
  }

  const nodes: Patch[] = [];
  const visit = (p: Patch, path: Patch[]) => {
    if (path.includes(p)) throw new Error(`dependency cycle: ${[...path, p].map((x) => x.name ?? "(internal)").join(" → ")}`);
    if (nodes.includes(p)) return;
    for (const d of p.dependsOn ?? []) visit(d, [...path, p]);
    nodes.push(p);
  };
  for (const p of chosen) visit(p, []);
  nodes.forEach((p, i) => {
    if (!labels.has(p)) labels.set(p, p.name ?? `(internal patch #${i + 1})`);
    if (!results.has(p)) results.set(p, { name: labels.get(p)!, status: "disabled", required: false, internal: !p.name });
  });

  // ponytail: O(n²) Kahn's algorithm; fine for hundreds of patches.
  const key = (p: Patch) => (p.name ? `0${p.name}` : `1${String(nodes.indexOf(p)).padStart(6, "0")}`);
  const order: Patch[] = [];
  const placed = new Set<Patch>();
  while (order.length < nodes.length) {
    const ready = nodes.filter((p) => !placed.has(p) && (p.dependsOn ?? []).every((d) => placed.has(d)));
    ready.sort((a, b) => (key(a) < key(b) ? -1 : 1));
    placed.add(ready[0]);
    order.push(ready[0]);
  }
  return { order, results, labels };
}

export function resolveOptions(p: Patch, given: Record<string, unknown>): Record<string, unknown> {
  const defs = p.options ?? {};
  for (const k of Object.keys(given)) if (!Object.hasOwn(defs, k)) throw new Error(`unknown option "${k}"`);
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(defs)) {
    const value = Object.hasOwn(given, k) ? given[k] : def.default;
    if (value === undefined) {
      if (def.required) throw new Error(`option "${k}" is required`);
      out[k] = undefined;
      continue;
    }
    const want = def.type === "bool" ? "boolean" : def.type;
    if (typeof value !== want) throw new Error(`option "${k}" must be a ${want}`);
    const problem = def.validate?.(value);
    if (problem) throw new Error(`option "${k}": ${problem}`);
    out[k] = value;
  }
  return out;
}
```

`packages/engine/src/job.ts`:
```ts
import { parse } from "acorn";
import type { AppDef, Manifest, Patch, PatchContext, TextFile } from "@revamp/sdk";
import { assertAsarPath } from "./asar.ts";
import type { Selection } from "./config.ts";
import { EditBuffer } from "./edits.ts";
import { Fingerprints } from "./fingerprint.ts";
import { planPatches, resolveOptions, type PatchResult } from "./graph.ts";
import { PARSE_OPTIONS } from "./pattern.ts";
import { Sources, type SourceStore } from "./sources.ts";

export const ASAR_PATH = "resources/app.asar";

export interface BundleModule {
  manifest: Manifest;
  apps: AppDef[];
  patches: Patch[];
}

export interface JobInput {
  appId: string;
  version: string;
  selection: Selection;
  force: boolean;
  stockDesktop: Record<string, string>;
}

export interface JobOutput {
  results: PatchResult[];
  /** Set when a required patch did not apply; nothing may be installed then. */
  aborted: string | undefined;
  /** Changed and added files inside app.asar. */
  outputs: Map<string, Buffer>;
  desktopEntry: Record<string, string>;
  logs: string[];
}

/** What the sandboxed runner prints for a patch job (outputs are written to files). */
export interface SandboxPatchOutput {
  results: PatchResult[];
  aborted: string | null;
  files: string[];
  desktopEntry: Record<string, string>;
  logs: string[];
}

type DesktopChanges = Record<string, string | null>;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function runJob(bundle: BundleModule, input: JobInput, store: SourceStore): JobOutput {
  const app = bundle.apps.find((a) => a.id === input.appId);
  if (!app) throw new Error(`bundle "${bundle.manifest.name}" has no app "${input.appId}"`);
  const plan = planPatches(app, input.version, bundle.patches, input.selection, input.force);
  const sources = new Sources(store);
  const edits = new EditBuffer();
  const fingerprints = new Fingerprints({ sources, edits });
  const added = new Map<Patch, Map<string, Buffer>>();
  const desktop = new Map<Patch, DesktopChanges>();
  const options = new Map<Patch, Record<string, unknown>>();
  const logs: string[] = [];

  const result = (p: Patch) => plan.results.get(p)!;
  const label = (p: Patch) => plan.labels.get(p)!;
  const applied = (p: Patch) => result(p).status === "applied";
  const failedDependency = (p: Patch) => (p.dependsOn ?? []).find((d) => !applied(d));
  const discard = (p: Patch) => {
    edits.drop(label(p));
    added.delete(p);
    desktop.delete(p);
  };
  const desktopSoFar = () => mergeDesktop(input.stockDesktop, plan.order.filter(applied).map((p) => desktop.get(p)));

  const runPhase = (p: Patch, phase: "execute" | "finalize") => {
    const base = desktopSoFar();
    const draft = { ...base };
    const files = new Map(added.get(p));
    edits.current = label(p);
    try {
      const ctx: PatchContext = {
        app: { id: app.id, version: input.version },
        options: options.get(p)! as PatchContext["options"],
        match(fp) {
          if ((fp.count ?? "one") !== "one") throw new Error(`fingerprint "${fp.name}" can match many times; use ctx.matchAll`);
          return fingerprints.resolve(fp)[0];
        },
        matchAll(fp) {
          if ((fp.count ?? "one") !== "many") throw new Error(`fingerprint "${fp.name}" matches exactly once; use ctx.match`);
          return fingerprints.resolve(fp);
        },
        file: (path) => textFile(sources, edits, path),
        addFile(path, contents) {
          assertAsarPath(path);
          if (sources.has(path)) throw new Error(`addFile("${path}"): the app already has that file`);
          files.set(path, Buffer.from(contents));
        },
        desktopEntry: draft,
        log: (m) => void logs.push(`[${label(p)}] ${m}`),
      };
      p[phase]!(ctx);
      added.set(p, files);
      desktop.set(p, { ...desktop.get(p), ...diff(base, draft) });
    } finally {
      edits.current = undefined;
    }
  };

  for (const p of plan.order) {
    const r = result(p);
    const bad = failedDependency(p);
    if (bad) {
      r.status = "skipped";
      r.message = `dependency "${label(bad)}" ${result(bad).status}`;
      continue;
    }
    try {
      options.set(p, resolveOptions(p, input.selection.options[p.name ?? ""] ?? {}));
      runPhase(p, "execute");
      r.status = "applied";
    } catch (e) {
      r.status = "failed";
      r.message = message(e);
      discard(p);
    }
  }
  for (const p of [...plan.order].reverse()) {
    if (!applied(p) || !p.finalize) continue;
    try {
      runPhase(p, "finalize");
    } catch (e) {
      result(p).status = "failed";
      result(p).message = `finalize: ${message(e)}`;
      discard(p);
    }
  }
  for (const p of plan.order) {
    const bad = failedDependency(p);
    if (applied(p) && bad) {
      result(p).status = "skipped";
      result(p).message = `dependency "${label(bad)}" ${result(bad).status}`;
      discard(p);
    }
  }

  const results = [...plan.results.values()];
  const broken = results.find((r) => r.required && r.status !== "applied");
  if (broken) {
    const why = `required patch "${broken.name}" ${broken.status}${broken.message ? `: ${broken.message}` : ""}`;
    return { results, aborted: why, outputs: new Map(), desktopEntry: input.stockDesktop, logs };
  }

  const keep = new Set(plan.order.filter(applied).map(label));
  const outputs = new Map<string, Buffer>();
  for (const file of edits.files(keep)) {
    const text = edits.apply(file, sources.text(file), keep);
    if (/\.(c|m)?js$/.test(file)) assertParses(file, text, edits.patchesFor(file, keep));
    outputs.set(file, Buffer.from(text, "utf8"));
  }
  for (const p of plan.order.filter(applied)) {
    for (const [path, buf] of added.get(p) ?? []) {
      if (outputs.has(path)) throw new Error(`two patches write "${path}"`);
      outputs.set(path, buf);
    }
  }
  return { results, aborted: undefined, outputs, desktopEntry: desktopSoFar(), logs };
}

function textFile(sources: Sources, edits: EditBuffer, path: string): TextFile {
  const original = sources.text(assertAsarPath(path));
  const set = (text: string) => edits.record(path, 0, original.length, text);
  return {
    path,
    text: original,
    setText: set,
    json: <T,>() => JSON.parse(original) as T,
    setJson: (value) => set(JSON.stringify(value, null, 2) + "\n"),
  };
}

function assertParses(file: string, text: string, patches: string[]): void {
  try {
    parse(text, PARSE_OPTIONS);
  } catch (e) {
    if (!file.endsWith(".mjs")) {
      try {
        parse(text, { ...PARSE_OPTIONS, sourceType: "script" });
        return;
      } catch {
        // report the module error below
      }
    }
    const by = patches.map((p) => `"${p}"`).join(", ");
    throw new Error(`patched ${file} is not valid JavaScript (${message(e)}); edited by ${by}`);
  }
}

function diff(base: Record<string, string>, draft: Record<string, string>): DesktopChanges {
  const out: DesktopChanges = {};
  for (const [k, v] of Object.entries(draft)) if (base[k] !== v) out[k] = String(v);
  for (const k of Object.keys(base)) if (!Object.hasOwn(draft, k)) out[k] = null;
  return out;
}

function mergeDesktop(stock: Record<string, string>, changes: Array<DesktopChanges | undefined>): Record<string, string> {
  const out = { ...stock };
  for (const c of changes) {
    for (const [k, v] of Object.entries(c ?? {})) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
  }
  return out;
}

export interface AppInfo {
  id: string;
  name: string;
  release: AppDef["release"];
  installDir: string;
  executable: string;
  desktopFile: string;
  versions: AppDef["versions"];
  required: string[];
}

export interface PatchInfo {
  name: string;
  description: string;
  apps: Array<{ app: string; versions: string[] | null }> | null;
  default: boolean;
  options: Record<string, { type: string; title: string; description: string; default: unknown }>;
}

export interface BundleDescription {
  manifest: Manifest;
  apps: AppInfo[];
  patches: PatchInfo[];
}

/** Plain-JSON view of a bundle: what patches.json holds and what the parent process may read. */
export function describeBundle(b: BundleModule): BundleDescription {
  return {
    manifest: { ...b.manifest },
    apps: b.apps.map((a) => ({
      id: a.id,
      name: a.name,
      release: { ...a.release },
      installDir: a.installDir,
      executable: a.executable,
      desktopFile: a.desktopFile,
      versions: structuredClone(a.versions),
      required: a.required.map((p) => p.name ?? "(internal)"),
    })),
    patches: b.patches
      .filter((p) => p.name)
      .map((p) => ({
        name: p.name!,
        description: p.description ?? "",
        apps: p.compatibleWith ? p.compatibleWith.map((c) => ({ app: c.app.id, versions: c.versions ?? null })) : null,
        default: p.compatibleWith ? p.default !== false : false,
        options: Object.fromEntries(
          Object.entries(p.options ?? {}).map(([k, d]) => [k, { type: d.type, title: d.title, description: d.description ?? "", default: d.default ?? null }]),
        ),
      })),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/engine/test/job.test.ts && npm run typecheck`
Expected: `# pass 11`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/graph.ts packages/engine/src/job.ts packages/engine/test/job.test.ts
git commit -m "feat(engine): patch graph and transactional job runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Sandboxed runner

**Model:** `opus` / `high` (trust boundary: running bundle code)

**Files:**
- Create: `packages/engine/src/runner.ts`, `packages/engine/src/sandbox.ts`
- Create: `packages/engine/test/helpers/demo.ts`, `packages/engine/test/fixtures/sandbox-probe.mjs`
- Test: `packages/engine/test/sandbox.test.ts`
- Modify: `packages/engine/src/job.ts`: add the `RunnerJob` type

**Interfaces:**
- Consumes:
  - Task 5: `readAsar`, `assertAsarPath`
  - Task 8: `asarStore`
  - Task 9: `ASAR_PATH`, `runJob`, `describeBundle`, `BundleModule`, `JobInput`, `SandboxPatchOutput`, `BundleDescription`
  - Task 4 test helpers: `debFrom`, `tarArchive`, `tarEntry`
- Produces:
  - `job.ts`: `type RunnerJob = { mode: "describe"; bundle } | ({ mode: "patch"; bundle; staging; outDir } & JobInput)`
  - `sandbox.ts`:
    - `class SandboxError extends Error`
    - `interface SandboxAccess { read: string[]; write: string[] }`
    - `runSandboxed<T>(job, access, { entry?, timeoutMs? }): Promise<T>`
  - `runner.ts`: no exports. It is the child's entry point and must never be imported.
  - Test helpers (`test/helpers/demo.ts`):
    - `writeDemoBundle(path, { sha256, minEngine?, extra? })`
    - `demoAsar(): Promise<Buffer>`
    - `writeDemoApp(dir)`
    - `demoDeb(): Promise<Buffer>`

**Sandbox rules (spec §4.4, dev mode):**
- **The child:** `process.execPath --permission`, with `--allow-fs-read` for the repo root (runner source and `node_modules`) plus `access.read`, and `--allow-fs-write` for `access.write`.
- **No other grants:** no `--allow-net`, `--allow-child-process`, `--allow-worker`, `--allow-addons` or `--allow-wasi`.
- **Environment:** only `PATH` and `REVAMP_SANDBOX=1`, so no tokens leak.
- **Protocol:** the job goes in as JSON on stdin and the result comes out as JSON on stdout. Errors go to stderr with exit code 1.
- **Timeout:** 180 s by default, then SIGKILL.
- The SEA spawn form (`--node-options=…`) arrives in M4 with the SEA build.

- [ ] **Step 1: Add the job type**

Append to `packages/engine/src/job.ts`:
```ts
/** The JSON a parent sends to the sandboxed runner on stdin. */
export type RunnerJob =
  | { mode: "describe"; bundle: string }
  | ({ mode: "patch"; bundle: string; staging: string; outDir: string } & JobInput);
```

- [ ] **Step 2: Write the probe fixture and the demo helpers**

`packages/engine/test/fixtures/sandbox-probe.mjs`:
```js
// Tries things the sandbox must forbid and reports what happened. Used by sandbox.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const job = JSON.parse(Buffer.concat(chunks).toString());
if (job.mode === "hang") for (;;);

const attempt = async (fn) => {
  try {
    await fn();
    return "allowed";
  } catch (e) {
    return e.code ?? e.cause?.code ?? e.message;
  }
};
const report = {
  readAllowed: await attempt(() => readFileSync(job.allowedFile)),
  readOutside: await attempt(() => readFileSync(job.outsideFile)),
  writeAllowed: await attempt(() => writeFileSync(job.allowedWrite, "ok")),
  writeOutside: await attempt(() => writeFileSync(job.outsideWrite, "no")),
  spawn: await attempt(() => {
    const r = spawnSync("true");
    if (r.error) throw r.error;
  }),
  fetch: await attempt(() => fetch(job.url)),
};
process.stdout.write(JSON.stringify(report));
```

`packages/engine/test/helpers/demo.ts`:
```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackageWithOptions } from "@electron/asar";
import { debFrom, tarArchive, tarEntry } from "./archives.ts";

/**
 * Writes a self-contained bundle: plain objects and no imports, shaped like esbuild's output for a real bundle.
 * `extra` is JavaScript run before the exports; it can push to `patches` and `app.required`.
 */
export function writeDemoBundle(path: string, o: { sha256: string; minEngine?: string; extra?: string }): void {
  writeFileSync(
    path,
    `const app = {
  kind: "app", id: "demo", name: "Demo",
  release: { github: "example/demo", tag: "v{version}", asset: "demo_{version}_amd64.deb" },
  installDir: "opt/Demo", executable: "demo", desktopFile: "usr/share/applications/demo.desktop",
  versions: { "1.0.0": { sha256: "${o.sha256}" }, "2.0.0": { sha256: "${"0".repeat(64)}", experimental: true } },
  required: [],
};
const greeting = { kind: "fingerprint", name: "greeting", strings: ['"hello"'], pattern: 'console.log("hello")' };
const patches = [{
  kind: "patch", name: "Say goodbye", compatibleWith: [{ app }],
  execute(ctx) {
    ctx.match(greeting).replace('console.log("goodbye")');
    ctx.desktopEntry.Name = "Demo (Revamped)";
  },
}];
${o.extra ?? ""}
export const manifest = { name: "Demo bundle", version: "1.0.0", minEngine: "${o.minEngine ?? "0.1.0"}", author: "test", license: "GPL-3.0-only", source: "test" };
export const apps = [app];
export { patches };
`,
  );
}

/** An app.asar holding package.json and out/main.js (which logs "hello"). */
export async function demoAsar(): Promise<Buffer> {
  const src = mkdtempSync(join(tmpdir(), "revamp-demo-src-"));
  mkdirSync(join(src, "out"));
  writeFileSync(join(src, "out/main.js"), 'console.log("hello");\n');
  writeFileSync(join(src, "package.json"), '{"name":"demo","main":"out/main.js"}\n');
  const archive = join(mkdtempSync(join(tmpdir(), "revamp-demo-asar-")), "app.asar");
  await createPackageWithOptions(src, archive, {});
  return readFileSync(archive);
}

/** An installed-app tree: <dir>/resources/app.asar. */
export async function writeDemoApp(dir: string): Promise<void> {
  mkdirSync(join(dir, "resources"), { recursive: true });
  writeFileSync(join(dir, "resources/app.asar"), await demoAsar());
}

/** A .deb shaped like Hydra's: the app under opt/Demo, a desktop file and two icon sizes. */
export async function demoDeb(): Promise<Buffer> {
  return debFrom(
    tarArchive([
      tarEntry("./opt/Demo/", "", { type: "5", mode: 0o755 }),
      tarEntry("./opt/Demo/demo", "#!/bin/sh\necho demo\n", { mode: 0o755 }),
      tarEntry("./opt/Demo/resources/", "", { type: "5", mode: 0o755 }),
      tarEntry("./opt/Demo/resources/app.asar", await demoAsar()),
      tarEntry(
        "./usr/share/applications/demo.desktop",
        "[Desktop Entry]\nName=Demo\nExec=/opt/Demo/demo %U\nIcon=demo\nType=Application\nMimeType=x-scheme-handler/demo;\n",
      ),
      tarEntry("./usr/share/icons/hicolor/64x64/apps/demo.png", "small-png"),
      tarEntry("./usr/share/icons/hicolor/256x256/apps/demo.png", "big-png"),
    ]),
    "gz",
  );
}
```

- [ ] **Step 3: Write the failing tests**

`packages/engine/test/sandbox.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BundleDescription, SandboxPatchOutput } from "../src/job.ts";
import { runSandboxed, SandboxError } from "../src/sandbox.ts";
import { writeDemoApp, writeDemoBundle } from "./helpers/demo.ts";

const PROBE = fileURLToPath(new URL("./fixtures/sandbox-probe.mjs", import.meta.url));
const SHA = "a".repeat(64);
const tmp = () => mkdtempSync(join(tmpdir(), "revamp-sb-"));

test("the sandbox allows its own dirs and blocks other files, processes and the network", async (t) => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.end("hi");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const root = tmp();
  const allowed = join(root, "in");
  const out = join(root, "out");
  mkdirSync(allowed);
  mkdirSync(out);
  writeFileSync(join(allowed, "f.txt"), "x");
  writeFileSync(join(root, "secret.txt"), "s");
  const report = await runSandboxed<Record<string, string>>(
    {
      allowedFile: join(allowed, "f.txt"),
      outsideFile: join(root, "secret.txt"),
      allowedWrite: join(out, "w.txt"),
      outsideWrite: join(root, "w.txt"),
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    },
    { read: [allowed], write: [out] },
    { entry: PROBE },
  );
  assert.equal(report.readAllowed, "allowed");
  assert.equal(report.writeAllowed, "allowed");
  assert.equal(report.readOutside, "ERR_ACCESS_DENIED");
  assert.equal(report.writeOutside, "ERR_ACCESS_DENIED");
  assert.equal(report.spawn, "ERR_ACCESS_DENIED");
  assert.notEqual(report.fetch, "allowed"); // needs Node ≥ 25: earlier versions don't restrict the network
  assert.equal(hits, 0);
});

test("a run over its time limit is killed", async () => {
  await assert.rejects(runSandboxed({ mode: "hang" }, { read: [], write: [] }, { entry: PROBE, timeoutMs: 500 }), /timed out/);
});

test("describe loads a bundle and returns plain JSON", async () => {
  const bundle = join(tmp(), "demo.mjs");
  writeDemoBundle(bundle, { sha256: SHA });
  const d = await runSandboxed<BundleDescription>({ mode: "describe", bundle }, { read: [bundle], write: [] });
  assert.equal(d.manifest.name, "Demo bundle");
  assert.equal(d.apps[0].id, "demo");
  assert.deepEqual(d.patches.map((p) => p.name), ["Say goodbye"]);
});

async function patchDemo(extra?: string) {
  const root = tmp();
  const staging = join(root, "staging");
  const outDir = join(staging, ".revamp-out");
  const bundle = join(root, "demo.mjs");
  writeDemoBundle(bundle, { sha256: SHA, extra });
  await writeDemoApp(staging);
  mkdirSync(outDir);
  const job = {
    mode: "patch",
    bundle,
    staging,
    outDir,
    appId: "demo",
    version: "1.0.0",
    selection: { enable: [], disable: [], options: {} },
    force: false,
    stockDesktop: { Name: "Demo" },
  };
  const result = await runSandboxed<SandboxPatchOutput>(job, { read: [staging, bundle], write: [outDir] });
  return { result, outDir };
}

test("a patch job writes changed files into the out dir and reports results", async () => {
  const { result, outDir } = await patchDemo();
  assert.equal(result.aborted, null);
  assert.deepEqual(result.files, ["out/main.js"]);
  assert.equal(readFileSync(join(outDir, "files/out/main.js"), "utf8"), 'console.log("goodbye");\n');
  assert.equal(result.desktopEntry.Name, "Demo (Revamped)");
});

test("bundle code can't read files outside the job", async () => {
  const snoop = `patches.push({ kind: "patch", name: "Snoop", compatibleWith: [{ app }],
    execute() { process.getBuiltinModule("node:fs").readFileSync("/etc/hostname"); } });`;
  const { result } = await patchDemo(snoop);
  const r = result.results.find((x) => x.name === "Snoop")!;
  assert.equal(r.status, "failed");
  assert.match(r.message!, /restricted|ERR_ACCESS_DENIED/);
});

test("a file that isn't a bundle is reported", async () => {
  const bad = join(tmp(), "bad.mjs");
  writeFileSync(bad, "export const x = 1;\n");
  await assert.rejects(
    runSandboxed({ mode: "describe", bundle: bad }, { read: [bad], write: [] }),
    (e) => e instanceof SandboxError && /not a Revamp bundle/.test(e.message),
  );
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test packages/engine/test/sandbox.test.ts`
Expected: FAIL, module not found `../src/sandbox.ts`.

- [ ] **Step 5: Implement**

`packages/engine/src/sandbox.ts`:
```ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./runner.ts", import.meta.url));
/** Dev mode runs this repo's TypeScript in the child, so it may read the repo (sources and node_modules). */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_TIMEOUT_MS = 180_000;

export class SandboxError extends Error {}

export interface SandboxAccess {
  read: string[];
  write: string[];
}

/**
 * Runs `entry` (default: the bundle runner) in a child Node process under the permission model.
 * Reads are limited to the repo and access.read and writes to access.write. There is no network,
 * no child processes, workers, addons or WASI, and the environment holds only PATH.
 * The job goes in on stdin; the child's stdout must be JSON.
 */
export function runSandboxed<T>(job: unknown, access: SandboxAccess, o: { entry?: string; timeoutMs?: number } = {}): Promise<T> {
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [
    "--permission",
    ...[REPO_ROOT, ...access.read].map((p) => `--allow-fs-read=${p}`),
    ...access.write.map((p) => `--allow-fs-write=${p}`),
    o.entry ?? RUNNER,
  ];
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

`packages/engine/src/runner.ts`:
```ts
// Entry point of the sandboxed child process started by sandbox.ts. Never import this module:
// it reads a job from stdin as soon as it loads.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { assertAsarPath, readAsar } from "./asar.ts";
import { ASAR_PATH, describeBundle, runJob, type BundleModule, type RunnerJob, type SandboxPatchOutput } from "./job.ts";
import { asarStore } from "./sources.ts";

function loadBundle(path: string): BundleModule {
  // require(esm): import() of files on disk is unavailable inside a Node 26 SEA, and require works in both modes.
  const mod = createRequire(import.meta.url)(path);
  if (typeof mod?.manifest?.name !== "string" || !Array.isArray(mod.apps) || !Array.isArray(mod.patches)) {
    throw new Error(`${path} is not a Revamp bundle (it needs manifest, apps and patches exports)`);
  }
  return mod as BundleModule;
}

async function main(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const job = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RunnerJob;
  const bundle = loadBundle(job.bundle);
  if (job.mode === "describe") return JSON.stringify(describeBundle(bundle));

  const out = runJob(bundle, job, asarStore(readAsar(join(job.staging, ASAR_PATH))));
  for (const [path, buf] of out.outputs) {
    const dest = join(job.outDir, "files", ...assertAsarPath(path).split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
  const result: SandboxPatchOutput = {
    results: out.results,
    aborted: out.aborted ?? null,
    files: [...out.outputs.keys()],
    desktopEntry: out.desktopEntry,
    logs: out.logs,
  };
  return JSON.stringify(result);
}

main().then(
  (json) => void process.stdout.write(json),
  (e) => {
    process.stderr.write(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);
```

- [ ] **Step 6: Run the tests**

Run: `node --test packages/engine/test/sandbox.test.ts && npm run typecheck`
Expected: `# pass 6`, `# fail 0`. If the network assertion fails, `node --version` is not 26: fix PATH (Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/runner.ts packages/engine/src/sandbox.ts packages/engine/src/job.ts packages/engine/test/sandbox.test.ts packages/engine/test/helpers/demo.ts packages/engine/test/fixtures/sandbox-probe.mjs
git commit -m "feat(engine): run bundle code in a permission-model sandbox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Official bundle: Hydra app and the three M1 patches

**Model:** `sonnet` / `medium`

**Files:**
- Create: `bundles/official/package.json`, `bundles/official/src/index.ts`, `bundles/official/src/apps.ts`
- Create: `bundles/official/src/universal/disable-self-update.ts`, `bundles/official/src/universal/side-by-side-identity.ts`
- Create: `bundles/official/src/hydra/recently-downloaded-sort.ts`
- Create: `bundles/official/test/fixtures/hydra-4.1.6/{renderer-excerpt.js,main-excerpt.js,AppUpdater-excerpt.js,AppImageUpdater-excerpt.js}`
- Create: `packages/engine/src/index.ts` (first exports; Task 13 adds more)
- Test: `bundles/official/test/patches.test.ts`

**Interfaces:**
- Consumes:
  - SDK `defineApp`, `definePatch`, `fingerprint`, `option`, `Manifest`
  - engine `runJob`, `memoryStore`
- Produces:
  - Bundle exports `manifest`, `apps`, `patches` (the shape `BundleModule` expects)
  - App `hydra`
  - Patches `disableSelfUpdate`, `sideBySideIdentity`, `recentlyDownloadedSort`
  - Their fingerprints, exported for reuse by M2's "Recently added sort"
  - Build output `bundles/official/dist/official.mjs`, a single ESM file with no imports

**Facts the patches rely on (verified on the real Hydra 4.1.6 bundle, each fingerprint matches exactly once):**
- **Sort helper.** The renderer's sort helper is `[...games].sort((a2, b2) => { switch (sortBy2) { case "recently_played": {…} … } return …; })`.
  - A second `sortLibraryGames` (Big Picture) uses `if` chains and must not match.
  - The fork's comparator is `(b.download?.timestamp ?? 0) - (a.download?.timestamp ?? 0)`.
- **Five edit sites,** mirroring fork commit `288f38b0d`:
  - the switch case
  - the sidebar `sortOptions` entry (with `ClockIcon` → new entry uses `DownloadIcon`)
  - `SIDEBAR_SORT_OPTIONS` (`new Set`)
  - the library `FilterOptions` options
  - the `SORT_OPTIONS$1` validation list
- **Icons.** `var DownloadIcon = createIconComponent("DownloadIcon", "octicon octicon-download", …)` lives in the same renderer file.
- **Labels.** M1 labels use i18next's `defaultValue` ("Recently downloaded"); M2 adds real en/bg/pt-BR keys.
- **Updater.** electron-updater's `isUpdaterActive()` exists in `AppUpdater.js` and `AppImageUpdater.js` (`node_modules/electron-updater/out/`). It is bundled into Heroic's `build/main/main.js`. Returning `false` makes `checkForUpdates()` resolve `null`, which Hydra only logs.
- **Main process.** It calls `app$z.setAsDefaultProtocolClient(...)` twice (dev and prod branches). The asar `package.json` is `{"name":"hydralauncher","version":"4.1.6","main":"./out/main/index.js","type":"module", …}` with no `desktopName`.

- [ ] **Step 1: Write the package, the excerpt fixtures and the first engine exports**

`bundles/official/package.json`:
```json
{
  "name": "@revamp/bundle-official",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-3.0-only",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --platform=neutral --target=es2024 --outfile=dist/official.mjs"
  },
  "dependencies": { "@revamp/sdk": "*" },
  "devDependencies": { "@revamp/engine": "*" }
}
```

`packages/engine/src/index.ts`:
```ts
export { memoryStore } from "./sources.ts";
export { describeBundle, runJob, type BundleModule, type JobInput, type JobOutput } from "./job.ts";
export type { PatchResult, PatchStatus } from "./graph.ts";
export type { Selection } from "./config.ts";
```

The fixtures are real Hydra 4.1.6 / electron-updater 6.6.2 code (both MIT), trimmed. Keep them byte-exact.

`bundles/official/test/fixtures/hydra-4.1.6/renderer-excerpt.js`:
```js
// Excerpts from Hydra 4.1.6 out/renderer/assets/index-Cpo9haoY.js (MIT, github.com/hydralauncher/hydra),
// trimmed for Revamp's patch tests. The last two blocks are decoys the patches must not touch.
const sortLibraryGames$1 = /* @__PURE__ */ __name((games, sortBy2) => {
  return [...games].sort((a2, b2) => {
    switch (sortBy2) {
      case "recently_played": {
        const difference = getPlayTimeDifference(a2, b2);
        if (difference !== 0) return difference;
        break;
      }
      case "most_played": {
        const difference = getMostPlayedDifference(a2, b2);
        if (difference !== 0) return difference;
        break;
      }
      case "title_desc": {
        return compareLibraryGamesByTitle(a2, b2, false);
      }
    }
    return compareLibraryGamesByTitle(a2, b2);
  });
}, "sortLibraryGames$1");
var ClockIcon = /* @__PURE__ */ createIconComponent("ClockIcon", "octicon octicon-clock", function() {
  return {};
});
var DownloadIcon = /* @__PURE__ */ createIconComponent("DownloadIcon", "octicon octicon-download", function() {
  return {};
});
function SidebarFilterMenu({ sortBy: sortBy2 }) {
  const { t: t2 } = useTranslation(["sidebar", "library"]);
  const sortOptions = [
    {
      value: "title_asc",
      label: t2("sort_title", { ns: "library" }),
      icon: /* @__PURE__ */ jsxRuntimeExports.jsx(SortDescIcon, { size: 14 })
    },
    {
      value: "recently_played",
      label: t2("recently_played", { ns: "library" }),
      icon: /* @__PURE__ */ jsxRuntimeExports.jsx(ClockIcon, { size: 14 })
    },
    {
      value: "most_played",
      label: t2("sort_most_played", { ns: "library" }),
      icon: /* @__PURE__ */ jsxRuntimeExports.jsx(HourglassIcon, { size: 14 })
    }
  ];
  return sortOptions;
}
const SIDEBAR_SORT_OPTIONS = /* @__PURE__ */ new Set([
  "title_asc",
  "recently_played",
  "most_played",
  "achievements"
]);
function readSidebarSortBy() {
  const saved = localStorage.getItem("sidebar-sort-by");
  return SIDEBAR_SORT_OPTIONS.has(saved) ? saved : "title_asc";
}
function FilterOptions({
  sortBy: sortBy2,
  onSortChange
}) {
  const { t: t2 } = useTranslation("library");
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    LibrarySelect,
    {
      value: sortBy2,
      ariaLabel: t2("sort_by"),
      options: [
        { value: "title_asc", label: t2("sort_title_asc") },
        { value: "recently_played", label: t2("recently_played") },
        { value: "most_played", label: t2("sort_most_played") },
        { value: "title_desc", label: t2("sort_title_desc") }
      ]
    }
  );
}
const SORT_OPTIONS$1 = [
  "title_asc",
  "recently_played",
  "most_played",
  "achievements",
  "installed_first",
  "title_desc"
];
function readLibrarySortBy() {
  const savedSortBy = localStorage.getItem("library-sort-by");
  return savedSortBy && SORT_OPTIONS$1.includes(savedSortBy) ? savedSortBy : "title_asc";
}
function sortLibraryGames(library2, sortBy2) {
  return [...library2].sort((a2, b2) => {
    if (sortBy2 === "last_played") {
      return sortByLastPlayed(a2, b2);
    }
    return compareTitles(a2, b2);
  });
}
const BIG_PICTURE_FILTERS = [
  { value: "recently_played", label: "Recent", focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_RECENTLY_PLAYED_ID },
  { value: "favorites", label: "Favorites", focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_FAVORITES_ID }
];
```

`bundles/official/test/fixtures/hydra-4.1.6/main-excerpt.js`:
```js
// Excerpt from Hydra 4.1.6 out/main/index.js (MIT, github.com/hydralauncher/hydra), trimmed for Revamp's patch tests.
const PROTOCOL = "hydralauncher";
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app$z.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
            path.resolve(process.argv[1])
        ]);
    }
} else {
    app$z.setAsDefaultProtocolClient(PROTOCOL);
}
```

`bundles/official/test/fixtures/hydra-4.1.6/AppUpdater-excerpt.js`:
```js
"use strict";
// Excerpt from electron-updater 6.6.2 out/AppUpdater.js (MIT), trimmed for Revamp's patch tests.
class AppUpdater {
    isUpdaterActive() {
        const isEnabled = this.app.isPackaged || this.forceDevUpdateConfig;
        if (!isEnabled) {
            this._logger.info("Skip checkForUpdates because application is not packed and dev update config is not forced");
            return false;
        }
        return true;
    }
    checkForUpdates() {
        if (!this.isUpdaterActive()) {
            return Promise.resolve(null);
        }
        return this.doCheckForUpdates();
    }
}
exports.AppUpdater = AppUpdater;
```

`bundles/official/test/fixtures/hydra-4.1.6/AppImageUpdater-excerpt.js`:
```js
"use strict";
// Excerpt from electron-updater 6.6.2 out/AppImageUpdater.js (MIT), trimmed for Revamp's patch tests.
class AppImageUpdater extends BaseUpdater_1.BaseUpdater {
    isUpdaterActive() {
        if (process.env["APPIMAGE"] == null) {
            this._logger.warn("APPIMAGE env is not defined, current application is not an AppImage");
            return false;
        }
        return super.isUpdaterActive();
    }
}
exports.AppImageUpdater = AppImageUpdater;
```

Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`bundles/official/test/patches.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore, runJob, type Selection } from "@revamp/engine";
import * as bundle from "../src/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/hydra-4.1.6/${name}`, import.meta.url), "utf8");
const RENDERER = "out/renderer/assets/index-Cpo9haoY.js";
const UPDATERS = ["node_modules/electron-updater/out/AppUpdater.js", "node_modules/electron-updater/out/AppImageUpdater.js"];
const STOCK = {
  Name: "Hydra",
  Exec: "/opt/Hydra/hydralauncher %U",
  Icon: "hydralauncher",
  StartupWMClass: "Hydra",
  MimeType: "x-scheme-handler/hydralauncher;",
  Categories: "Game;",
};

function hydraFiles(overrides: Record<string, string> = {}) {
  return {
    "package.json": '{\n  "name": "hydralauncher",\n  "version": "4.1.6",\n  "main": "./out/main/index.js",\n  "type": "module"\n}\n',
    "out/main/index.js": fixture("main-excerpt.js"),
    [RENDERER]: fixture("renderer-excerpt.js"),
    [UPDATERS[0]]: fixture("AppUpdater-excerpt.js"),
    [UPDATERS[1]]: fixture("AppImageUpdater-excerpt.js"),
    ...overrides,
  };
}

const NONE: Selection = { enable: [], disable: [], options: {} };
const job = (selection = NONE, files = hydraFiles()) =>
  runJob(bundle, { appId: "hydra", version: "4.1.6", selection, force: false, stockDesktop: STOCK }, memoryStore(files));

test("all M1 patches apply to the Hydra 4.1.6 excerpts", () => {
  const out = job();
  assert.equal(out.aborted, undefined);
  assert.deepEqual(out.results.map((r) => [r.name, r.status]), [
    ["Disable self-update", "applied"],
    ["Side-by-side identity", "applied"],
    ["Recently downloaded sort", "applied"],
  ]);
});

test("Disable self-update makes every isUpdaterActive() return false", () => {
  const out = job();
  for (const file of UPDATERS) assert.match(out.outputs.get(file)!.toString(), /isUpdaterActive\(\) \{\s*return false;\s*\}/, file);
});

test("Side-by-side identity sets desktopName, menu name and window class, and keeps links by default", () => {
  const out = job();
  assert.equal(JSON.parse(out.outputs.get("package.json")!.toString()).desktopName, "revamp-hydra.desktop");
  assert.deepEqual(out.desktopEntry, { ...STOCK, Name: "Hydra (Revamped)", StartupWMClass: "revamp-hydra" });
  assert.equal(out.outputs.has("out/main/index.js"), false);
});

test("claimLinks=false stops protocol registration and drops MimeType", () => {
  const out = job({ ...NONE, options: { "Side-by-side identity": { claimLinks: false } } });
  assert.equal(out.outputs.get("out/main/index.js")!.toString().includes("setAsDefaultProtocolClient"), false);
  assert.equal("MimeType" in out.desktopEntry, false);
});

test("Recently downloaded sort edits the five places and leaves the decoys alone", () => {
  const code = job().outputs.get(RENDERER)!.toString();
  assert.match(code, /case "recently_downloaded": \{\s*const difference = \(b2\.download\?\.timestamp \?\? 0\) - \(a2\.download\?\.timestamp \?\? 0\);/);
  assert.ok(
    code.includes(
      '{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { ns: "library", defaultValue: "Recently downloaded" }), icon: jsxRuntimeExports.jsx(DownloadIcon, { size: 14 }) }',
    ),
  );
  assert.ok(code.includes('{ value: "recently_downloaded", label: t2("sort_recently_downloaded", { defaultValue: "Recently downloaded" }) }'));
  assert.equal(code.match(/"recently_downloaded"/g)?.length, 5);
  const original = fixture("renderer-excerpt.js");
  const decoys = (s: string) => s.slice(s.indexOf("function sortLibraryGames("));
  assert.equal(decoys(code), decoys(original));
});

test("a renderer without the sort case fails only that patch, naming the fingerprint and step", () => {
  const changed = fixture("renderer-excerpt.js").replace('case "recently_played": {', 'case "recently_played_v2": {');
  const out = job(NONE, hydraFiles({ [RENDERER]: changed }));
  const r = out.results.find((x) => x.name === "Recently downloaded sort")!;
  assert.equal(r.status, "failed");
  assert.match(r.message!, /fingerprint "library sort switch" failed at step "pattern"/);
  assert.equal(out.aborted, undefined);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test bundles/official/test/patches.test.ts`
Expected: FAIL, module not found `../src/index.ts`.

- [ ] **Step 4: Implement the bundle**

`bundles/official/src/universal/disable-self-update.ts`:
```ts
import { definePatch, fingerprint } from "@revamp/sdk";

/** electron-updater's gate: when it returns false, checkForUpdates() resolves null and nothing is downloaded. */
export const updaterActive = fingerprint({
  name: "electron-updater isUpdaterActive",
  strings: ["isUpdaterActive()"],
  scope: "all",
  count: "many",
  pattern: "isUpdaterActive() { $$$BODY }",
});

export const disableSelfUpdate = definePatch({
  name: "Disable self-update",
  description:
    "Turns off the app's built-in updater (electron-updater), so it never installs releases over the stock app. Revamp handles updates instead.",
  execute(ctx) {
    for (const m of ctx.matchAll(updaterActive)) m.$BODY.replace("return false;");
  },
});
```

`bundles/official/src/universal/side-by-side-identity.ts`:
```ts
import { definePatch, fingerprint, option } from "@revamp/sdk";

export const protocolRegistration = fingerprint({
  name: "setAsDefaultProtocolClient call",
  strings: ["setAsDefaultProtocolClient("],
  count: "many",
  pattern: "$APP.setAsDefaultProtocolClient($$$)",
});

export const sideBySideIdentity = definePatch({
  name: "Side-by-side identity",
  description:
    "Gives the patched copy its own menu name and window class (Electron's desktopName), so it doesn't merge with the stock app in menus and panels.",
  options: {
    claimLinks: option.bool({
      title: "Open app links in the Revamped copy",
      description: "When off, the Revamped copy never registers itself for the app's links, so links keep opening the stock app.",
      default: true,
    }),
  },
  execute(ctx) {
    const id = `revamp-${ctx.app.id}`;
    const pkg = ctx.file("package.json");
    pkg.setJson({ ...pkg.json<Record<string, unknown>>(), desktopName: `${id}.desktop` });
    ctx.desktopEntry.Name = `${ctx.desktopEntry.Name ?? ctx.app.id} (Revamped)`;
    ctx.desktopEntry.StartupWMClass = id;
    if (ctx.options.claimLinks === false) {
      for (const call of ctx.matchAll(protocolRegistration)) call.replace("false");
      delete ctx.desktopEntry.MimeType;
    }
  },
});
```

`bundles/official/src/apps.ts`:
```ts
import { defineApp } from "@revamp/sdk";
import { disableSelfUpdate } from "./universal/disable-self-update.ts";
import { sideBySideIdentity } from "./universal/side-by-side-identity.ts";

export const hydra = defineApp({
  id: "hydra",
  name: "Hydra",
  release: { github: "hydralauncher/hydra", tag: "v{version}", asset: "hydralauncher_{version}_amd64.deb" },
  installDir: "opt/Hydra",
  executable: "hydralauncher",
  desktopFile: "usr/share/applications/hydralauncher.desktop",
  versions: {
    "4.1.6": { sha256: "fc075d4c9334fa7462cdfe4faef625f61e6933df48fa03e1939b635951147363" },
  },
  required: [disableSelfUpdate, sideBySideIdentity],
});
```

`bundles/official/src/hydra/recently-downloaded-sort.ts`:
```ts
import { definePatch, fingerprint } from "@revamp/sdk";
import { hydra } from "../apps.ts";

export const librarySortSwitch = fingerprint({
  name: "library sort switch",
  strings: ['"recently_played"', '"most_played"'],
  pattern: '[...$GAMES].sort(($A, $B) => { switch ($BY) { case "recently_played": { $$$ } } $$$ })',
});

export const octiconDownload = fingerprint({
  name: "octicon DownloadIcon",
  strings: ['"octicon octicon-download"'],
  pattern: 'var $ICON = $CREATE("DownloadIcon", "octicon octicon-download", $$$)',
});

export const sidebarSortEntry = fingerprint({
  name: "sidebar sort menu entry",
  strings: ['"recently_played"', '"sort_most_played"'],
  pattern: '({ value: "recently_played", label: $T("recently_played", { ns: "library" }), icon: $JSX.jsx($ICON, { size: 14 }) })',
});

export const sidebarSortSet = fingerprint({
  name: "sidebar allowed sorts",
  strings: ['"recently_played"', '"sidebar-sort-by"'],
  pattern: 'new Set([$$$, "recently_played", $$$])',
});

export const librarySortList = fingerprint({
  name: "library allowed sorts",
  strings: ['"recently_played"', '"library-sort-by"'],
  pattern: 'const $OPTS = [$$$, "recently_played", $$$]',
});

export const libraryFilterOption = fingerprint({
  name: "library sort menu entry",
  strings: ['"recently_played"', '"sort_title_asc"'],
  pattern: '({ value: "recently_played", label: $T("recently_played") })',
});

const LABEL = "Recently downloaded";

export const recentlyDownloadedSort = definePatch({
  name: "Recently downloaded sort",
  description: "Adds 'Recently downloaded' (newest download first) to the library and sidebar sort menus.",
  compatibleWith: [{ app: hydra, versions: ["4.1.6"] }],
  execute(ctx) {
    const sort = ctx.match(librarySortSwitch);
    sort.find('case "recently_played": { $$$ }').insertAfter(
      `case "recently_downloaded": {\n` +
        `        const difference = (${sort.$B}.download?.timestamp ?? 0) - (${sort.$A}.download?.timestamp ?? 0);\n` +
        `        if (difference !== 0) return difference;\n` +
        `        break;\n` +
        `      }`,
    );

    const icon = ctx.match(octiconDownload);
    const entry = ctx.match(sidebarSortEntry);
    if (icon.file !== entry.file) throw new Error(`DownloadIcon (${icon.file}) and the sidebar sort menu (${entry.file}) are in different files`);
    entry.insertAfter(
      `{ value: "recently_downloaded", label: ${entry.$T}("sort_recently_downloaded", { ns: "library", defaultValue: "${LABEL}" }), icon: ${entry.$JSX}.jsx(${icon.$ICON}, { size: 14 }) }`,
    );

    ctx.match(sidebarSortSet).find('"recently_played"').insertAfter('"recently_downloaded"');
    ctx.match(librarySortList).find('"recently_played"').insertAfter('"recently_downloaded"');

    const option = ctx.match(libraryFilterOption);
    option.insertAfter(`{ value: "recently_downloaded", label: ${option.$T}("sort_recently_downloaded", { defaultValue: "${LABEL}" }) }`);
  },
});
```

`bundles/official/src/index.ts`:
```ts
import type { Manifest } from "@revamp/sdk";
import { hydra } from "./apps.ts";
import { recentlyDownloadedSort } from "./hydra/recently-downloaded-sort.ts";
import { disableSelfUpdate } from "./universal/disable-self-update.ts";
import { sideBySideIdentity } from "./universal/side-by-side-identity.ts";

export const manifest: Manifest = {
  name: "Revamp official",
  version: "0.1.0",
  minEngine: "0.1.0",
  author: "xb00tt",
  license: "GPL-3.0-only",
  source: "github:xb00tt/revamp",
};

export const apps = [hydra];
export const patches = [disableSelfUpdate, sideBySideIdentity, recentlyDownloadedSort];
```

- [ ] **Step 5: Run the tests and build the bundle file**

```bash
node --test bundles/official/test/patches.test.ts && npm run typecheck
npm run build -w @revamp/bundle-official
grep -c '^import ' bundles/official/dist/official.mjs || true
node -e 'import("./bundles/official/dist/official.mjs").then(m => console.log(m.manifest.name, m.apps.length, m.patches.length))'
```
Expected:
- the tests show `# pass 6`, `# fail 0`
- the `grep` count is `0` (no imports)
- the last line prints `Revamp official 1 3`

- [ ] **Step 6: Commit**

```bash
git add bundles/official packages/engine/src/index.ts package-lock.json
git commit -m "feat(bundle): Hydra 4.1.6 with self-update off, side-by-side identity and recently downloaded sort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Install, rollback, retention and the menu entry

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/engine/src/install.ts`
- Test: `packages/engine/test/install.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `Paths`, `appDir`, `assertSafeName`, `serializeDesktopEntry`, `Selection`
  - Task 9: `PatchResult`
- Produces:
  - `interface Receipt { app; version; release: { asset; sha256 }; bundle: { name; version; sha256 }; patches; selection; installedAt }`
  - `ICON_FILE = "revamp-icon.png"`
  - `newStaging(paths, appId): string`
  - `interface InstallInput { paths; appId; version; executable; staging; receipt; desktopEntry }`
  - `installStaged(i): string` (the install dir)
  - `currentVersion(root)`
  - `interface InstalledVersion { version; receipt }`, `installedVersions(root)` (newest first)
  - `pruneVersions(root): string[]`
  - `desktopFilePath(paths, appId)`
  - `interface InstalledApp { appId; current; versions }`, `listInstalls(paths)`
  - `rollback(paths, appId): string`
  - `uninstall(paths, appId)`
  - `environmentWarnings(appName, sysctlPath?): string[]`

**Rules (spec §4.3 step 6, §4.5):**
- **Atomic swaps.** `current` is a relative symlink (`current -> 4.1.6`) swapped atomically: write a temp symlink, then `rename` it.
- **Re-patching an installed version.** The old directory is moved aside, staging is renamed in, then the old one is deleted.
- **Retention.** Keep the `current` target and the most recently installed other version.
- **Menu entry.**
  - `Exec` = `"<…/apps/<app>/current/<executable>"` plus the stock entry's field code (`%U` etc.).
  - `Icon` = `…/current/revamp-icon.png` when that file exists, otherwise the stock icon name.
  - Paths containing `"`, `` ` ``, `$` or `\` are refused because a desktop `Exec` can't hold them safely.
  - After writing, run `update-desktop-database` on the applications dir; a missing tool is ignored.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/install.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDesktopEntry } from "../src/desktop.ts";
import {
  environmentWarnings,
  ICON_FILE,
  installStaged,
  listInstalls,
  newStaging,
  rollback,
  uninstall,
  type Receipt,
} from "../src/install.ts";
import { revampPaths, type Paths } from "../src/paths.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "revamp-inst-"));
const newPaths = (home = join(tmp(), "home")) => revampPaths({ HOME: home });
const receipt = (version: string, installedAt: string): Receipt => ({
  app: "demo",
  version,
  release: { asset: "demo.deb", sha256: "a".repeat(64) },
  bundle: { name: "b", version: "1", sha256: "b".repeat(64) },
  patches: [],
  selection: { enable: [], disable: [], options: {} },
  installedAt,
});

function install(p: Paths, version: string, installedAt: string, marker = version) {
  const staging = newStaging(p, "demo");
  writeFileSync(join(staging, "demo"), marker);
  writeFileSync(join(staging, ICON_FILE), "png");
  return installStaged({
    paths: p,
    appId: "demo",
    version,
    executable: "demo",
    staging,
    receipt: receipt(version, installedAt),
    desktopEntry: { Name: "Demo (Revamped)", Exec: "/opt/Demo/demo %U", Icon: "demo", StartupWMClass: "revamp-demo" },
  });
}
const root = (p: Paths) => join(p.data, "apps/demo");

test("installs the version, points current at it and writes the menu entry", () => {
  const p = newPaths();
  const dir = install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  assert.equal(dir, join(root(p), "1.0.0"));
  assert.equal(readlinkSync(join(root(p), "current")), "1.0.0");
  assert.deepEqual(readdirSync(root(p)).sort(), ["1.0.0", "current"]);
  assert.equal(JSON.parse(readFileSync(join(dir, "revamp.json"), "utf8")).version, "1.0.0");
  const entry = parseDesktopEntry(readFileSync(join(p.applications, "revamp-demo.desktop"), "utf8"));
  const current = join(root(p), "current");
  assert.equal(entry.Exec, `"${join(current, "demo")}" %U`);
  assert.equal(entry.Icon, join(current, ICON_FILE));
  assert.equal(entry.Name, "Demo (Revamped)");
  assert.equal(entry.StartupWMClass, "revamp-demo");
});

test("keeps only current plus the previous version", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  install(p, "1.1.0", "2026-10-14T11:00:00.000Z");
  install(p, "1.2.0", "2026-10-14T12:00:00.000Z");
  assert.deepEqual(readdirSync(root(p)).sort(), ["1.1.0", "1.2.0", "current"]);
  assert.equal(readlinkSync(join(root(p), "current")), "1.2.0");
});

test("re-patching the current version replaces it in place", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  install(p, "1.1.0", "2026-10-14T11:00:00.000Z", "old build");
  install(p, "1.1.0", "2026-10-14T12:00:00.000Z", "new build");
  assert.deepEqual(readdirSync(root(p)).sort(), ["1.0.0", "1.1.0", "current"]);
  assert.equal(readFileSync(join(root(p), "current/demo"), "utf8"), "new build");
});

test("rollback switches current to the other kept version", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  assert.throws(() => rollback(p, "demo"), /no previous version/);
  install(p, "1.1.0", "2026-10-14T11:00:00.000Z");
  assert.equal(rollback(p, "demo"), "1.0.0");
  assert.equal(readlinkSync(join(root(p), "current")), "1.0.0");
  assert.equal(rollback(p, "demo"), "1.1.0");
});

test("listInstalls and uninstall", () => {
  const p = newPaths();
  install(p, "1.0.0", "2026-10-14T10:00:00.000Z");
  const [demo] = listInstalls(p);
  assert.equal(demo.appId, "demo");
  assert.equal(demo.current, "1.0.0");
  assert.deepEqual(demo.versions.map((v) => v.version), ["1.0.0"]);
  uninstall(p, "demo");
  assert.equal(existsSync(root(p)), false);
  assert.equal(existsSync(join(p.applications, "revamp-demo.desktop")), false);
  assert.deepEqual(listInstalls(p), []);
  assert.throws(() => uninstall(p, "demo"), /not installed/);
});

test("refuses install paths a desktop Exec line can't hold", () => {
  const p = newPaths(join(tmp(), "we$ird"));
  assert.throws(() => install(p, "1.0.0", "2026-10-14T10:00:00.000Z"), /can't hold/);
  assert.equal(existsSync(join(root(p), "1.0.0")), false);
});

test("the userns warning appears only when the sysctl is 1", () => {
  const f = join(tmp(), "sysctl");
  writeFileSync(f, "1\n");
  assert.equal(environmentWarnings("Demo", f).length, 2);
  writeFileSync(f, "0\n");
  assert.equal(environmentWarnings("Demo", f).length, 1);
  assert.match(environmentWarnings("Demo", join(tmp(), "missing"))[0], /only one of them can run at a time/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/engine/test/install.test.ts`
Expected: FAIL, module not found `../src/install.ts`.

- [ ] **Step 3: Implement**

`packages/engine/src/install.ts`:
```ts
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Selection } from "./config.ts";
import { serializeDesktopEntry } from "./desktop.ts";
import type { PatchResult } from "./graph.ts";
import { appDir, assertSafeName, type Paths } from "./paths.ts";

export interface Receipt {
  app: string;
  version: string;
  release: { asset: string; sha256: string };
  bundle: { name: string; version: string; sha256: string };
  patches: PatchResult[];
  selection: Selection;
  installedAt: string;
}

export const ICON_FILE = "revamp-icon.png";

export function newStaging(paths: Paths, appId: string): string {
  const root = appDir(paths, appId);
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, ".staging-"));
}

export interface InstallInput {
  paths: Paths;
  appId: string;
  version: string;
  executable: string;
  staging: string;
  receipt: Receipt;
  desktopEntry: Record<string, string>;
}

/** Moves a finished staging dir into place, points `current` at it, writes the menu entry and prunes old versions. */
export function installStaged(i: InstallInput): string {
  const root = appDir(i.paths, i.appId);
  const exe = join(root, "current", i.executable);
  if (/["`$\\]/.test(exe)) throw new Error(`a .desktop Exec line can't hold the install path ${exe}`);
  const dest = join(root, assertSafeName("version", i.version));
  writeFileSync(join(i.staging, "revamp.json"), JSON.stringify(i.receipt, null, 2) + "\n");
  let aside: string | undefined;
  if (existsSync(dest)) {
    aside = join(root, `.replaced-${i.version}-${process.pid}`);
    renameSync(dest, aside);
  }
  renameSync(i.staging, dest);
  if (aside) rmSync(aside, { recursive: true, force: true });
  pointCurrent(root, i.version);
  writeDesktopFile(i.paths, i.appId, exe, i.desktopEntry);
  pruneVersions(root);
  return dest;
}

function pointCurrent(root: string, version: string): void {
  const tmp = join(root, `.current-${process.pid}`);
  rmSync(tmp, { force: true });
  symlinkSync(version, tmp);
  renameSync(tmp, join(root, "current"));
}

export function currentVersion(root: string): string | undefined {
  try {
    return readlinkSync(join(root, "current"));
  } catch {
    return undefined;
  }
}

export interface InstalledVersion {
  version: string;
  receipt: Receipt;
}

/** Finished installs (those with a receipt), newest first. */
export function installedVersions(root: string): InstalledVersion[] {
  if (!existsSync(root)) return [];
  const out: InstalledVersion[] = [];
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    try {
      out.push({ version: d.name, receipt: JSON.parse(readFileSync(join(root, d.name, "revamp.json"), "utf8")) });
    } catch {
      // no receipt: not a finished install
    }
  }
  return out.sort((a, b) => b.receipt.installedAt.localeCompare(a.receipt.installedAt));
}

/** Keeps the version `current` points to plus the most recently installed other one. */
export function pruneVersions(root: string): string[] {
  const current = currentVersion(root);
  const removed = installedVersions(root)
    .filter((v) => v.version !== current)
    .slice(1)
    .map((v) => v.version);
  for (const v of removed) rmSync(join(root, v), { recursive: true, force: true });
  return removed;
}

export const desktopFilePath = (paths: Paths, appId: string) =>
  join(paths.applications, `revamp-${assertSafeName("app id", appId)}.desktop`);

function writeDesktopFile(paths: Paths, appId: string, exe: string, entry: Record<string, string>): void {
  const current = join(appDir(paths, appId), "current");
  const fieldCode = /%[fFuU]/.exec(entry.Exec ?? "")?.[0];
  const final: Record<string, string> = { ...entry, Exec: `"${exe}"${fieldCode ? ` ${fieldCode}` : ""}` };
  delete final.TryExec;
  if (existsSync(join(current, ICON_FILE))) final.Icon = join(current, ICON_FILE);
  mkdirSync(paths.applications, { recursive: true });
  const file = desktopFilePath(paths, appId);
  writeFileSync(`${file}.tmp`, serializeDesktopEntry(final));
  renameSync(`${file}.tmp`, file);
  refreshDesktopDatabase(paths);
}

function refreshDesktopDatabase(paths: Paths): void {
  spawnSync("update-desktop-database", [paths.applications], { stdio: "ignore" }); // optional tool
}

export interface InstalledApp {
  appId: string;
  current: string | undefined;
  versions: InstalledVersion[];
}

export function listInstalls(paths: Paths): InstalledApp[] {
  const apps = join(paths.data, "apps");
  if (!existsSync(apps)) return [];
  return readdirSync(apps, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => ({ appId: d.name, current: currentVersion(join(apps, d.name)), versions: installedVersions(join(apps, d.name)) }))
    .filter((a) => a.versions.length > 0);
}

export function rollback(paths: Paths, appId: string): string {
  const root = appDir(paths, appId);
  const current = currentVersion(root);
  const previous = installedVersions(root).find((v) => v.version !== current);
  if (!previous) throw new Error(`no previous version of ${appId} to roll back to`);
  pointCurrent(root, previous.version);
  return previous.version;
}

export function uninstall(paths: Paths, appId: string): void {
  const root = appDir(paths, appId);
  if (!existsSync(root)) throw new Error(`${appId} is not installed`);
  rmSync(root, { recursive: true, force: true });
  rmSync(desktopFilePath(paths, appId), { force: true });
  rmSync(join(paths.config, "apps", `${appId}.json`), { force: true });
  refreshDesktopDatabase(paths);
}

export function environmentWarnings(appName: string, sysctl = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns"): string[] {
  const out = [`Revamped ${appName} shares settings with the stock app, so only one of them can run at a time.`];
  try {
    if (readFileSync(sysctl, "utf8").trim() === "1") {
      out.push(
        "This system restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1), so Electron's sandbox can't start in an app installed in your home folder. See docs/electron-sandbox.md.",
      );
    }
  } catch {
    // not an AppArmor system
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/engine/test/install.test.ts && npm run typecheck`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/install.ts packages/engine/test/install.test.ts
git commit -m "feat(engine): side-by-side install with current symlink, retention and menu entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `patchApp`: the whole job, end to end

**Model:** `opus` / `high` (orchestrates download verification, extraction and the sandbox)

**Files:**
- Create: `packages/engine/src/api.ts`
- Modify: `packages/engine/src/index.ts` (append exports)
- Test: `packages/engine/test/api.test.ts`

**Interfaces:**
- Consumes everything above. In particular:
  - Task 3: `downloadVerified`, `fileSha256`
  - Task 4: `extractDeb`
  - Task 5: `readAsar`, `writeAsar`, `assertAsarPath`
  - Task 9: `ASAR_PATH`, `AppInfo`, `BundleDescription`, `SandboxPatchOutput`
  - Task 10: `runSandboxed`
  - Task 12: `newStaging`, `installStaged`, `ICON_FILE`, `environmentWarnings`
  - Task 2: `loadSelection`, `mergeSelection`, `saveSelection`, `releasePath`, `assertSafeName`, `revampPaths`, `compareVersions`, `ENGINE_VERSION`
  - Test helpers `demoDeb`, `writeDemoBundle`
- Produces:
  - `interface PatchAppOptions { appId; bundlePath; version?; force?; enable?; disable?; dryRun?; paths?; releaseBaseUrl?; fetch?; log? }`
  - `interface PatchAppResult { appId; appName; version; results; installed; dryRun; installDir?; aborted?; exitCode: 0|1|2; warnings; logs }`
  - `describe(bundlePath): Promise<BundleDescription>`
  - `newestStable(versions): string | undefined`
  - `patchApp(o): Promise<PatchAppResult>`

**Flow (spec §4.3):**
1. Run `describe` in the sandbox.
2. Check `minEngine`, the app, the version and experimental status. All of this happens **before** any download.
3. Run `downloadVerified` into the cache.
4. Create the staging dir.
5. Extract: `installDir/**` goes to the staging root; the stock desktop file and the hicolor PNGs go to `.revamp-meta/`.
6. Read the desktop entry and copy the largest icon to `revamp-icon.png`.
7. Run the patch job in the sandbox.
8. If the job aborted, return exit code 1. For a dry run, return without installing.
9. Repack the asar.
10. Run `installStaged` and save the selection.

The staging dir is always removed in `finally`; after a successful install it has already been renamed away, so that is a no-op.

Exit codes:
- `0`: every selected patch applied
- `1`: nothing installed (a required patch failed)
- `2`: installed, but some optional patch failed or was skipped

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/api.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFile } from "@electron/asar";
import { patchApp, type PatchAppOptions } from "../src/api.ts";
import { parseDesktopEntry } from "../src/desktop.ts";
import { revampPaths } from "../src/paths.ts";
import { demoDeb, writeDemoBundle } from "./helpers/demo.ts";

async function setup(bundleOptions: { extra?: string; minEngine?: string } = {}) {
  const deb = await demoDeb();
  const sha256 = createHash("sha256").update(deb).digest("hex");
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/example/demo/releases/download/v1.0.0/demo_1.0.0_amd64.deb") res.end(deb);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "revamp-api-"));
  const bundlePath = join(root, "demo.mjs");
  const writeBundle = (o = bundleOptions) => writeDemoBundle(bundlePath, { sha256, ...o });
  writeBundle();
  const paths = revampPaths({ HOME: join(root, "home") });
  const opts: PatchAppOptions = {
    appId: "demo",
    bundlePath,
    paths,
    releaseBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
  return { opts, paths, writeBundle, hits: () => hits, close: () => server.close() };
}
const appRoot = (s: { paths: { data: string } }) => join(s.paths.data, "apps/demo");

test("downloads, patches, repacks and installs; the second run reuses the download", async (t) => {
  const s = await setup();
  t.after(s.close);
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 0);
  assert.equal(r.installed, true);
  assert.deepEqual(r.results.map((x) => [x.name, x.status]), [["Say goodbye", "applied"]]);
  const dir = join(appRoot(s), "1.0.0");
  assert.equal(r.installDir, dir);
  assert.equal(extractFile(join(dir, "resources/app.asar"), "out/main.js").toString(), 'console.log("goodbye");\n');
  assert.equal(readFileSync(join(dir, "revamp-icon.png"), "utf8"), "big-png");
  assert.equal(statSync(join(dir, "demo")).mode & 0o111, 0o111);
  assert.equal(existsSync(join(dir, ".revamp-meta")), false);
  assert.equal(existsSync(join(dir, ".revamp-out")), false);
  const entry = parseDesktopEntry(readFileSync(join(s.paths.applications, "revamp-demo.desktop"), "utf8"));
  assert.equal(entry.Name, "Demo (Revamped)");
  assert.equal(entry.MimeType, "x-scheme-handler/demo;");
  const receipt = JSON.parse(readFileSync(join(dir, "revamp.json"), "utf8"));
  assert.equal(receipt.release.asset, "demo_1.0.0_amd64.deb");
  assert.equal(receipt.bundle.name, "Demo bundle");
  const before = s.hits();
  assert.equal((await patchApp(s.opts)).exitCode, 0);
  assert.equal(s.hits(), before);
});

test("a dry run reports results and installs nothing", async (t) => {
  const s = await setup();
  t.after(s.close);
  const r = await patchApp({ ...s.opts, dryRun: true });
  assert.equal(r.installed, false);
  assert.equal(r.results[0].status, "applied");
  assert.deepEqual(readdirSync(appRoot(s)), []);
});

test("unsupported requests fail before anything is downloaded", async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(patchApp({ ...s.opts, appId: "nope" }), /has no app "nope" \(it has: demo\)/);
  await assert.rejects(patchApp({ ...s.opts, version: "9.9.9" }), /not supported.*supported: 1\.0\.0, 2\.0\.0/);
  await assert.rejects(patchApp({ ...s.opts, version: "2.0.0" }), /experimental.*--force/);
  s.writeBundle({ minEngine: "99.0.0" });
  await assert.rejects(patchApp(s.opts), /needs Revamp 99\.0\.0 or newer/);
  s.writeBundle({ extra: 'app.release.asset = "../evil_{version}.deb";' });
  await assert.rejects(patchApp(s.opts), /unsafe asset/);
  assert.equal(s.hits(), 0);
});

test("a failed required patch installs nothing and keeps the previous install intact", async (t) => {
  const s = await setup();
  t.after(s.close);
  await patchApp(s.opts);
  s.writeBundle({
    extra: 'const must = { kind: "patch", name: "Must", execute() { throw new Error("boom"); } }; patches.push(must); app.required.push(must);',
  });
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 1);
  assert.equal(r.installed, false);
  assert.match(r.aborted!, /required patch "Must" failed: boom/);
  assert.equal(readlinkSync(join(appRoot(s), "current")), "1.0.0");
  assert.equal(extractFile(join(appRoot(s), "1.0.0/resources/app.asar"), "out/main.js").toString(), 'console.log("goodbye");\n');
  assert.deepEqual(readdirSync(appRoot(s)).filter((n) => n.startsWith(".")), []);
});

test("an optional patch failure still installs and exits 2", async (t) => {
  const s = await setup({
    extra: 'patches.push({ kind: "patch", name: "Broken", compatibleWith: [{ app }], execute() { throw new Error("nope"); } });',
  });
  t.after(s.close);
  const r = await patchApp(s.opts);
  assert.equal(r.exitCode, 2);
  assert.equal(r.installed, true);
  assert.equal(r.results.find((x) => x.name === "Broken")!.message, "nope");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/engine/test/api.test.ts`
Expected: FAIL, module not found `../src/api.ts`.

- [ ] **Step 3: Implement**

`packages/engine/src/api.ts`:
```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertAsarPath, readAsar, writeAsar } from "./asar.ts";
import { loadSelection, mergeSelection, saveSelection } from "./config.ts";
import { extractDeb } from "./deb.ts";
import { parseDesktopEntry } from "./desktop.ts";
import { downloadVerified, fileSha256 } from "./download.ts";
import type { PatchResult } from "./graph.ts";
import { environmentWarnings, ICON_FILE, installStaged, newStaging } from "./install.ts";
import { ASAR_PATH, type AppInfo, type BundleDescription, type SandboxPatchOutput } from "./job.ts";
import { assertSafeName, releasePath, revampPaths, type Paths } from "./paths.ts";
import { runSandboxed } from "./sandbox.ts";
import { compareVersions, ENGINE_VERSION } from "./version.ts";

export interface PatchAppOptions {
  appId: string;
  bundlePath: string;
  version?: string;
  force?: boolean;
  enable?: string[];
  disable?: string[];
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

export async function patchApp(o: PatchAppOptions): Promise<PatchAppResult> {
  const paths = o.paths ?? revampPaths();
  const log = o.log ?? (() => {});
  const bundlePath = resolve(o.bundlePath);
  const desc = await describe(bundlePath);
  const bundleName = desc.manifest.name;
  if (compareVersions(desc.manifest.minEngine, ENGINE_VERSION) > 0) {
    throw new Error(`bundle "${bundleName}" needs Revamp ${desc.manifest.minEngine} or newer (this is ${ENGINE_VERSION})`);
  }
  const app = desc.apps.find((a) => a.id === o.appId);
  if (!app) throw new Error(`bundle "${bundleName}" has no app "${o.appId}" (it has: ${desc.apps.map((a) => a.id).join(", ") || "none"})`);
  assertSafeName("app id", app.id);
  const version = o.version ?? newestStable(app.versions);
  if (!version || !Object.hasOwn(app.versions, version)) {
    const supported = Object.keys(app.versions).sort(compareVersions).join(", ");
    throw new Error(`${app.name} ${version ?? "(no stable version)"} is not supported by bundle "${bundleName}" (supported: ${supported})`);
  }
  const info = app.versions[version];
  if (info.experimental && !o.force) throw new Error(`${app.name} ${version} is experimental in this bundle; add --force to patch it anyway`);
  const asset = assertSafeName("asset", fill(app.release.asset, version));
  const tag = fill(app.release.tag, version);
  const selection = mergeSelection(loadSelection(paths, app.id), { enable: o.enable, disable: o.disable });

  const debPath = releasePath(paths, app.id, version, asset);
  log(`Downloading ${asset}…`);
  const url = `${o.releaseBaseUrl ?? "https://github.com"}/${app.release.github}/releases/download/${tag}/${asset}`;
  const how = await downloadVerified({ url, dest: debPath, sha256: info.sha256, fetch: o.fetch });
  if (how === "replaced") log("The cached download had the wrong SHA-256, so it was downloaded again.");

  const staging = newStaging(paths, app.id);
  try {
    log("Extracting…");
    await extractDeb(debPath, staging, installSelector(app));
    const stockDesktop = takeMeta(staging, app);

    log("Patching…");
    const outDir = join(staging, ".revamp-out");
    mkdirSync(outDir);
    const job = await runSandboxed<SandboxPatchOutput>(
      { mode: "patch", bundle: bundlePath, staging, outDir, appId: app.id, version, selection, force: o.force ?? false, stockDesktop },
      { read: [staging, bundlePath], write: [outDir] },
    );
    const base = { appId: app.id, appName: app.name, version, results: job.results, logs: job.logs, dryRun: o.dryRun ?? false, warnings: [] };
    if (job.aborted) return { ...base, installed: false, aborted: job.aborted, exitCode: 1 };
    const exitCode = job.results.some((r) => r.status === "failed" || r.status === "skipped") ? 2 : 0;
    if (o.dryRun) return { ...base, installed: false, exitCode };

    log("Repacking…");
    const asarPath = join(staging, ASAR_PATH);
    const changes = new Map(job.files.map((f) => [f, readFileSync(join(outDir, "files", ...assertAsarPath(f).split("/")))]));
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
    return { ...base, installed: true, installDir, exitCode, warnings: environmentWarnings(app.name) };
  } finally {
    rmSync(staging, { recursive: true, force: true }); // no-op after a successful install renamed it
  }
}

/** installDir/** goes to the staging root; the stock desktop file and hicolor PNG icons go to .revamp-meta/. */
function installSelector(app: AppInfo): (path: string) => string | null {
  const prefix = `${app.installDir.replace(/^\/+|\/+$/g, "")}/`;
  const desktop = app.desktopFile.replace(/^\/+/, "");
  return (p) => {
    if (p.startsWith(prefix)) return p.slice(prefix.length);
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
      if (size !== undefined) copyFileSync(join(icons, String(size), `${entry.Icon}.png`), join(staging, ICON_FILE));
    }
    return entry;
  } finally {
    rmSync(meta, { recursive: true, force: true });
  }
}
```

Append to `packages/engine/src/index.ts`:
```ts
export { describe, newestStable, patchApp, type PatchAppOptions, type PatchAppResult } from "./api.ts";
export { listInstalls, rollback, uninstall, type InstalledApp } from "./install.ts";
export { revampPaths, type Paths } from "./paths.ts";
export { ENGINE_VERSION } from "./version.ts";
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `node --test packages/engine/test/api.test.ts && npm test && npm run typecheck`
Expected: api `# pass 5`. Full suite `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/api.ts packages/engine/src/index.ts packages/engine/test/api.test.ts
git commit -m "feat(engine): patchApp orchestrates download, extract, sandboxed patching, repack and install

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: The `revamp` CLI

**Model:** `sonnet` / `medium`

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/src/main.ts`, `packages/cli/src/format.ts`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes (`@revamp/engine`): `patchApp`, `listInstalls`, `rollback`, `uninstall`, `revampPaths`, `PatchAppResult`, `InstalledApp`, `PatchStatus`.
- Produces:
  - `formatPatchResult(r): string`, `formatInstalls(apps): string`
  - The commands `revamp patch|list|rollback|uninstall`, run as `npm run revamp -- <args>` in M1. The SEA binary comes in M4.

**Output (spec §5.6):**
- A headline `"<App> <version>: <applied>/<ran> patches apply (<outcome>)"`.
- One line per patch: `✓` applied, `✗` failed, `–` skipped, then `[disabled]`/`[incompatible]` for patches that didn't run.
- Failure messages indented under their patch.
- Internal patches are shown only when they failed.
- Progress lines go to stderr; results to stdout.
- The exit code is `patchApp`'s (0/1/2), or 1 on errors.

- [ ] **Step 1: Write the package and the failing tests**

`packages/cli/package.json`:
```json
{
  "name": "@revamp/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-3.0-only",
  "dependencies": { "@revamp/engine": "*" }
}
```
Run: `npm install`

`packages/cli/test/cli.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PatchAppResult } from "@revamp/engine";
import { formatInstalls, formatPatchResult } from "../src/format.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const cli = (args: string[], home = mkdtempSync(join(tmpdir(), "revamp-cli-"))) =>
  spawnSync(process.execPath, [MAIN, ...args], { encoding: "utf8", env: { ...process.env, HOME: home, XDG_DATA_HOME: "", XDG_CONFIG_HOME: "" } });

test("formatPatchResult shows each patch, failures under it, and notes", () => {
  const r: PatchAppResult = {
    appId: "hydra",
    appName: "Hydra",
    version: "4.1.6",
    installed: true,
    dryRun: false,
    installDir: "/x/apps/hydra/4.1.6",
    exitCode: 2,
    warnings: ["W"],
    logs: [],
    results: [
      { name: "Disable self-update", status: "applied", required: true, internal: false },
      { name: "Recently downloaded sort", status: "failed", required: false, internal: false, message: 'fingerprint "library sort switch" failed at step "pattern": …' },
      { name: "(internal patch #3)", status: "applied", required: false, internal: true },
      { name: "Off", status: "disabled", required: false, internal: false },
    ],
  };
  assert.equal(
    formatPatchResult(r),
    [
      "Hydra 4.1.6: 1/2 patches apply (installed to /x/apps/hydra/4.1.6)",
      "  ✓ Disable self-update (required)",
      "  ✗ Recently downloaded sort",
      '      fingerprint "library sort switch" failed at step "pattern": …',
      "    Off [disabled]",
      "Note: W",
    ].join("\n"),
  );
  assert.match(formatPatchResult({ ...r, installed: false, aborted: 'required patch "X" failed', exitCode: 1 }), /nothing installed: required patch "X" failed/);
});

test("formatInstalls lists versions and marks the current one", () => {
  assert.equal(formatInstalls([]), "No Revamped apps installed.");
  const receipt = (version: string) => ({
    app: "hydra",
    version,
    release: { asset: "a", sha256: "a" },
    bundle: { name: "b", version: "1", sha256: "b" },
    selection: { enable: [], disable: [], options: {} },
    installedAt: "2026-10-14T21:30:00.000Z",
    patches: [{ name: "Recently downloaded sort", status: "applied" as const, required: false, internal: false }],
  });
  assert.equal(
    formatInstalls([{ appId: "hydra", current: "4.1.6", versions: [{ version: "4.1.6", receipt: receipt("4.1.6") }] }]),
    "hydra 4.1.6 (current)  installed 2026-10-14 21:30  Recently downloaded sort",
  );
});

test("the CLI prints usage, lists nothing in an empty home, and rejects unknown commands", () => {
  assert.equal(cli(["--help"]).status, 0);
  assert.match(cli(["--help"]).stdout, /revamp patch <app>/);
  const list = cli(["list"]);
  assert.equal(list.status, 0);
  assert.equal(list.stdout.trim(), "No Revamped apps installed.");
  const bad = cli(["frobnicate"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown command "frobnicate"/);
  assert.match(cli(["rollback"]).stderr, /needs an app/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/cli/test/cli.test.ts`
Expected: FAIL, module not found `../src/format.ts`.

- [ ] **Step 3: Implement**

`packages/cli/src/format.ts`:
```ts
import type { InstalledApp, PatchAppResult, PatchStatus } from "@revamp/engine";

const MARK: Record<PatchStatus, string> = { applied: "✓", failed: "✗", skipped: "–", incompatible: " ", disabled: " " };

export function formatPatchResult(r: PatchAppResult): string {
  const shown = r.results.filter((x) => !x.internal || x.status === "failed");
  const ran = shown.filter((x) => x.status !== "disabled" && x.status !== "incompatible");
  const applied = ran.filter((x) => x.status === "applied").length;
  const outcome = r.aborted
    ? `nothing installed: ${r.aborted}`
    : r.installed
      ? `installed to ${r.installDir}`
      : r.dryRun
        ? "dry run, nothing installed"
        : "not installed";
  const lines = [`${r.appName} ${r.version}: ${applied}/${ran.length} patches apply (${outcome})`];
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
      const when = v.receipt.installedAt.slice(0, 16).replace("T", " ");
      const patches = v.receipt.patches.filter((p) => p.status === "applied" && !p.internal && !p.required).map((p) => p.name);
      lines.push(`${a.appId} ${v.version}${v.version === a.current ? " (current)" : ""}  installed ${when}  ${patches.join(", ")}`.trimEnd());
    }
  }
  return lines.join("\n");
}
```

`packages/cli/src/main.ts`:
```ts
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listInstalls, patchApp, revampPaths, rollback, uninstall } from "@revamp/engine";
import { formatInstalls, formatPatchResult } from "./format.ts";

// M1 runs from the repo; M4 replaces this with bundle sources.
const DEFAULT_BUNDLE = fileURLToPath(new URL("../../../bundles/official/dist/official.mjs", import.meta.url));

const USAGE = `Usage:
  revamp patch <app> [--version <v>] [--force] [--enable <patch>]... [--disable <patch>]... [--bundle <file>] [--dry-run]
  revamp list
  revamp rollback <app>
  revamp uninstall <app> [--yes]`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "string" },
      force: { type: "boolean" },
      enable: { type: "string", multiple: true },
      disable: { type: "string", multiple: true },
      bundle: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, appId] = positionals;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!command) {
    console.error(USAGE);
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
        bundlePath: values.bundle ?? DEFAULT_BUNDLE,
        version: values.version,
        force: values.force,
        enable: values.enable,
        disable: values.disable,
        dryRun: values["dry-run"],
        paths,
        log: (line) => console.error(line),
      });
      console.log(formatPatchResult(result));
      return result.exitCode;
    }
    case "list":
      console.log(formatInstalls(listInstalls(paths)));
      return 0;
    case "rollback":
      console.log(`${needApp()}: now using ${rollback(paths, needApp())}`);
      return 0;
    case "uninstall": {
      const id = needApp();
      if (!values.yes) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`Remove Revamped ${id} (all versions, its menu entry and saved choices)? [y/N] `);
        rl.close();
        if (!/^y(es)?$/i.test(answer.trim())) return 1;
      }
      uninstall(paths, id);
      console.log(`Removed Revamped ${id}.`);
      return 0;
    }
    default:
      console.error(`Unknown command "${command}".\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`revamp: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/cli/test/cli.test.ts && npm test && npm run typecheck`
Expected: cli `# pass 3`. Full suite `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli package-lock.json
git commit -m "feat(cli): revamp patch, list, rollback and uninstall

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Real-release integration test, docs and M1 acceptance

**Model:** `sonnet` / `medium` (the final whole-branch review afterwards is `opus` / `high`)

**Files:**
- Create: `test/integration/hydra.test.ts`, `docs/electron-sandbox.md`, `README.md`

**Interfaces:**
- Consumes: `patchApp`, `revampPaths` from `@revamp/engine`; the built `bundles/official/dist/official.mjs`.
- Produces: `npm run test:integration`, plus the acceptance evidence for M1.

- [ ] **Step 1: Write the integration test**

`test/integration/hydra.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, getRawHeader, listPackage } from "@electron/asar";
import { patchApp, revampPaths } from "@revamp/engine";

const BUNDLE = fileURLToPath(new URL("../../bundles/official/dist/official.mjs", import.meta.url));
const enabled = process.env.REVAMP_INTEGRATION === "1";

test(
  "M1: patch the real Hydra 4.1.6 release into a throwaway home",
  { skip: enabled ? false : "set REVAMP_INTEGRATION=1 (npm run test:integration)", timeout: 15 * 60_000 },
  async (t) => {
    // The real cache is shared, so the 149 MB .deb downloads once; installs go to a temp home (≈700 MB, removed after).
    const home = mkdtempSync(join(tmpdir(), "revamp-it-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const paths = { ...revampPaths({ HOME: home }), cache: revampPaths().cache };
    const cached = existsSync(join(paths.cache, "releases/hydra/4.1.6/hydralauncher_4.1.6_amd64.deb"));
    const started = performance.now();
    const r = await patchApp({ appId: "hydra", bundlePath: BUNDLE, paths, log: (l) => console.log(l) });
    const seconds = (performance.now() - started) / 1000;
    console.log(`patch job took ${seconds.toFixed(1)} s (download ${cached ? "cached" : "included"})`);

    assert.equal(r.exitCode, 0, JSON.stringify(r.results, null, 2));
    assert.deepEqual(
      r.results.filter((x) => !x.internal).map((x) => [x.name, x.status]),
      [
        ["Disable self-update", "applied"],
        ["Side-by-side identity", "applied"],
        ["Recently downloaded sort", "applied"],
      ],
    );
    if (cached) assert.ok(seconds < 60, `patching took ${seconds.toFixed(1)} s; expected seconds, not minutes`);

    const apps = join(paths.data, "apps/hydra");
    assert.equal(readlinkSync(join(apps, "current")), "4.1.6");
    const dir = join(apps, "4.1.6");
    const asar = join(dir, "resources/app.asar");
    assert.equal(statSync(join(dir, "hydralauncher")).mode & 0o111, 0o111);
    assert.ok(existsSync(join(dir, "resources/app.asar.unpacked")));

    assert.equal(JSON.parse(extractFile(asar, "package.json").toString()).desktopName, "revamp-hydra.desktop");
    for (const f of ["node_modules/electron-updater/out/AppUpdater.js", "node_modules/electron-updater/out/AppImageUpdater.js"]) {
      assert.match(extractFile(asar, f).toString(), /isUpdaterActive\(\) \{\s*return false;\s*\}/, f);
    }
    const rendererFiles = listPackage(asar, { isPack: false })
      .map((p) => p.replace(/^[/\\]/, ""))
      .filter((p) => /^out\/renderer\/assets\/[^/]+\.js$/.test(p));
    const patched = rendererFiles.map((p) => extractFile(asar, p).toString()).filter((code) => code.includes('case "recently_downloaded"'));
    assert.equal(patched.length, 1);
    assert.equal(patched[0].match(/"recently_downloaded"/g)?.length, 5);

    // Files the patches didn't touch must be byte-identical: their bytes still match the header's original hashes.
    const sample: Array<[string, string]> = [];
    const walk = (node: any, prefix: string) => {
      for (const [name, e] of Object.entries<any>(node.files ?? {})) {
        const p = prefix ? `${prefix}/${name}` : name;
        if (e.files) walk(e, p);
        else if (!e.unpacked && e.integrity && !p.startsWith("out/") && !p.includes("electron-updater") && p !== "package.json") sample.push([p, e.integrity.hash]);
      }
    };
    walk(getRawHeader(asar).header, "");
    for (const [p, hash] of sample.filter((_, i) => i % 500 === 0)) {
      assert.equal(createHash("sha256").update(extractFile(asar, p)).digest("hex"), hash, p);
    }

    const desktop = readFileSync(join(paths.applications, "revamp-hydra.desktop"), "utf8");
    assert.match(desktop, /^Name=Hydra \(Revamped\)$/m);
    assert.match(desktop, /^StartupWMClass=revamp-hydra$/m);
    assert.match(desktop, /^Exec=".*\/apps\/hydra\/current\/hydralauncher" %U$/m);
    const icon = /^Icon=(.*)$/m.exec(desktop)![1];
    assert.ok(existsSync(icon), icon);
  },
);
```

- [ ] **Step 2: Run it (downloads 149 MB the first time)**

Run: `npm run test:integration`
Expected:
- The bundle builds.
- The log shows `Downloading…`, `Extracting…`, `Patching…`, `Repacking…`, `Installing…`.
- `patch job took N s`.
- `# pass 1`, `# fail 0`.

Run it a second time to check the cached timing assertion (`< 60 s`). If extraction alone takes most of the time (xz is about 14 s), that is expected; note the number for the M1 review.

- [ ] **Step 3: Write the docs**

`docs/electron-sandbox.md`:
````markdown
# Electron's sandbox and Revamped apps

Revamped apps live in your home folder (`~/.local/share/revamp/apps/`), so their `chrome-sandbox` helper can't be
setuid-root. Electron then sandboxes its renderers with unprivileged user namespaces.

Check your system:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
```

- `0` (Linux Mint 22, most distributions): nothing to do.
- `1` (stock Ubuntu 24.04 and newer): Revamped apps fail to start with a sandbox error. Revamp v1 does not change
  this for you; pick one of the options below.

## Option 1: an AppArmor profile for the Revamped path (needs root once)

This mirrors the profile Hydra ships for `/opt/Hydra` (`resources/apparmor-profile`). Save as
`/etc/apparmor.d/revamp-hydra`:

```
abi <abi/4.0>,
include <tunables/global>

profile revamp-hydra "/home/*/.local/share/revamp/apps/hydra/*/hydralauncher" flags=(unconfined) {
  userns,
  include if exists <local/revamp-hydra>
}
```

Then load it:

```bash
sudo apparmor_parser -r /etc/apparmor.d/revamp-hydra
```

## Option 2: run without Chromium's sandbox

Add `--no-sandbox` to the `Exec=` line of `~/.local/share/applications/revamp-hydra.desktop`, right after the
quoted program path. This turns off a security layer of the app; prefer option 1.
````

`README.md`:
````markdown
# Revamp

Revamp is Morphe for Linux Electron apps. It downloads an app's official release, verifies it, patches the shipped
JavaScript inside `app.asar`, and installs the result next to the stock app ("Hydra (Revamped)"). Patched builds
are never distributed: everyone patches locally. License: GPL-3.0-only.

Design: [docs/superpowers/specs/2026-10-14-revamp-v1-design.md](docs/superpowers/specs/2026-10-14-revamp-v1-design.md).

## Develop

Revamp needs Node 26 (the repo refuses older versions):

```bash
export PATH="$HOME/.local/node-26/bin:$PATH"
npm install
npm test
npm run typecheck
```

Patch Hydra with the bundle in this repo:

```bash
npm run build -w @revamp/bundle-official
npm run revamp -- patch hydra
```

The other commands are `npm run revamp -- list`, `npm run revamp -- rollback hydra` and
`npm run revamp -- uninstall hydra`.

If a Revamped app won't start on Ubuntu 24.04 or newer, see [docs/electron-sandbox.md](docs/electron-sandbox.md).
````

- [ ] **Step 4: Commit**

```bash
git add test/integration/hydra.test.ts docs/electron-sandbox.md README.md
git commit -m "test: real Hydra 4.1.6 integration test; docs: sandbox note and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: M1 acceptance on the owner's machine (manual; the owner runs or watches)**

```bash
dpkg --verify hydralauncher; echo "stock check exit $?"
npm run build -w @revamp/bundle-official
time npm run revamp -- patch hydra
npm run revamp -- list
```

Then, with stock Hydra **closed** (they share a single-instance lock):

1. Open the menu, find **Hydra (Revamped)** and launch it. It should open with your library, because settings are shared.
2. Run `xprop WM_CLASS` and click the Revamped window. Expect `"revamp-hydra", "revamp-hydra"`. Stock Hydra (launched separately later) shows `hydralauncher`, so the two don't group in the panel.
3. Library → sort menu: **Recently downloaded** appears and orders games by newest download. The same option appears in the sidebar sort menu. Restart the app: the choice is remembered.
4. No update prompt or download appears (self-update off).
5. Run `dpkg --verify hydralauncher` again. It must print nothing and exit 0: `/opt/Hydra` is unchanged.
6. The `time` output for the patch command shows seconds, not minutes (download already cached).

Record the results (timing, any deviations) in the PR or the M1 review notes. M1 is done when all six hold.
