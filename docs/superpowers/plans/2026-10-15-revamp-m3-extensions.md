# Revamp M3 (extensions: "More like this") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamped Hydra 4.1.6 shows the fork's improved "More like this" on every game page: games ranked by shared Steam tags, the shared tags as a caption, an "Already in library" badge, and session caching. When anything goes wrong it shows Hydra's own section instead. This is the last feature the owner needs before retiring the fork.

**In plain words, what M3 adds:**
- **The extension.** The fork's "More like this" code is copied almost unchanged into a small extension. Revamp builds it at bundle-build time and ships it inside Hydra as one extra file, `revamp-hydra.js`, which loads just before Hydra's own code.
- **Shared pieces come from Hydra.** The extension doesn't bring its own React, translations, router, store, cards, carousel or icons. A few "registry" patches find Hydra's own copies in Hydra's stock "More like this" section and leave them in a shared place (`globalThis.__revamp.registry`). The extension picks them up only when it renders, so one React runs and it matches Hydra's styling.
- **Swapping the section.** One patch routes Hydra's stock section through a wrapper. If the extension is there, the wrapper shows the new section; if it fails, the wrapper shows Hydra's own.
- **Report header fix.** It now counts only the patches you choose. Failed helper patches are still listed underneath, as the reason something was skipped.

**Architecture:**
- **SDK (`@revamp/sdk/shims/*`):** generic runtime code that is compiled into extensions, never into the engine:
  - `registry.ts`: `revamp()`, `need(name)`
  - `react.ts` and `jsx-runtime.ts`: forward every call to the app's React at call time
  - `mount.ts`: `mount(id, Original)` plus an error boundary built from the app's React on first use
- **Bundle (`bundles/official`):**
  - `src/hydra/extension/` is the extension source:
    - the fork's files under `hooks/` and `pages/`, with only their imports remapped
    - `app.ts`, call-time wrappers for Hydra's internals
    - `index.tsx`, which installs `mount()` and registers the replacement
  - `scripts/build.ts` compiles the extension with esbuild and embeds it in `dist/official.mjs` through `define`.
  - Three new kinds of patch:
    - an internal "Hydra extension loader": adds the file and the `<script>` tag
    - four internal registry patches: capture names from stock code, check each with `resolve()`, and assign them just before Hydra's root render
    - the named "More like this ranking": the mount line, which depends on all the above
- **No engine changes.** The patches use M1/M2's `ctx.addFile`, `ctx.file`, fingerprints, `find` and `resolve()`.

**Tech Stack:**
- Unchanged from M2: Node 26.12, TypeScript, acorn, esbuild.
- Test and type-only additions (nothing ships): `react@18.3.1`, `react-test-renderer@18.3.1` and `@types/react@18.3.26`. React 18.3.1 is the version Hydra 4.1.6 ships, and @types/react 18.3.26 is the fork's.

**Spec:** `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`. This plan implements §6 (extensions), the M3 rows of §10, and §13 M3. M1 and M2 plans in `docs/superpowers/plans/` describe the code it builds on.

**Validated before hand-off.** Every code block in this plan was extracted into a fresh clone of `main` (`3b477bb`), applied task by task, and run on Node 26.12.0 with TypeScript 7.0.2:
- Each task's "verify it fails" step failed as described, and its "verify it passes" step passed with the stated count: 151, 188, 191, 196 and 196 unit tests after Tasks 1–5. Both `tsc` projects were clean after every task.
- Each task's commit command left a clean tree, and the result is identical to the build the plan was written from.
- `npm run test:integration`: 3/3 against the real releases, with downloads cached:
  - Hydra 4.1.6: all 6 patches apply, including "More like this ranking" and its five helpers; about 21 s.
  - Heroic 2.22.3: about 12 s.
  - Hydra 4.0.6 forced: 3/6 apply; about 19 s.
- Task 3's test loads the built 22 kB extension with an empty registry, then renders the ranked section through `mount()` with React 18.3.1.
- **Not validated here:** running Revamped Hydra itself, which is the owner's check in Task 6, step 4.

Executors should transcribe the code, not redesign it. A failure most likely means a typo, a wrong Node version, or a step applied out of order.

**Design choices worth knowing.** Points 1–4 depart from the letter of spec §6; each keeps its intent. Points 5 and 6 are deliberate simplifications.
1. **UI libraries come from Hydra, not compiled in.** §6 says to compile pure libraries (embla-carousel-react, react-loading-skeleton, @primer/octicons-react, lodash-es) into the extension. M3 takes Hydra's own copies from the registry instead, for four reasons:
   - react-loading-skeleton reads Hydra's `SkeletonTheme` React context, so by §6's own rule ("anything holding React context comes from the registry") it can't be duplicated.
   - Octicons calls `React.forwardRef` when its module loads, which is before Hydra's React exists.
   - Hydra's own copies are exactly the versions the fork was built against.
   - Every one of them is captured from the stock section the feature replaces, so they add no new way to break on a new Hydra.
   - Cost: if a future Hydra drops one of them from that section, the feature is skipped and the stock section stays.
2. **Registry entries are assigned before the root render, not after each definition.** §6 inserts each assignment right after its definition. Many definitions have no behavior string to anchor on, while the stock code that *uses* them does. So each registry patch captures names from their uses and assigns them all just before `ReactDOM.createRoot(…).render(…)`, the last statement of Hydra's module. There every top-level binding is initialized and nothing has rendered yet.
   - Each captured name must pass `resolve()` (declared at the top level of the same file). Otherwise that registry patch fails and the feature is skipped. Without this check, an out-of-scope name would throw while Hydra loads and blank its UI.
   - `setTags` is only ever destructured from `catalogueSearchSlice.actions`, so it registers as that property path.
3. **Four registry patches, not one per entry.** They group the 18 entries by the stock code they come from: game page (10), game data (3), library (3), Steam tags (2). Failure scope is the same, because "More like this" is the only feature and depends on all four.
4. **The extension is embedded with esbuild `define`, not `import "revamp:extension/hydra"`.** A virtual module can't be resolved by Node when unit tests import the bundle sources. With `define`, the built bundle gets the real code and tests see a placeholder.
5. **Ported imports are remapped to local modules.** Everything except `react` comes from `app.ts`, rather than configuring an esbuild alias for every library name. The fork's function bodies are untouched.
   - `react` and `react/jsx-runtime` are redirected by a 2-entry esbuild plugin to the SDK shims.
   - The fork's own test runs against the port with only paths changed. Its last test is "use-similar-games stays redux-free", so its forbidden-import list now names the redux helpers instead of their old module paths.
6. **A failed helper doesn't undo the ones that applied.** If one registry patch fails, the others that applied still add their lines and the extension file still ships. Nothing calls them, so they are harmless. This is how M1's patch graph treats dependencies.

**Deliberately not in this plan:**
- Big Picture's "More like this" (Big Picture is a spec non-goal; the fork's change only touched the game page).
- Hydra versions other than 4.1.6 (forced 4.0.6 has no stock section, so the feature is skipped there; Task 6 checks that).
- Distribution, sources, check/update and the SEA (M4); the GUI (M5).
- Running the Revamped app automatically. The real-app check is the owner's (Task 6, step 4): Electron windows on the owner's desktop share Hydra's settings and single-instance lock.

**Model per task** (kickoff "Subagent model choice": cheapest adequate):
- Implementers `sonnet` / `medium`: the code is given and was validated.
- Task 4's reviewer is `opus` / `high`, because its registry lines run inside Hydra's startup.
- The final whole-branch review is `opus` / `high`. Escalate one tier on failure.

## Global Constraints

- **Node:** Node ≥ 26 at `~/.local/node-26` (v26.12.0). Every shell command assumes `export PATH="$HOME/.local/node-26/bin:$PATH"` first.
- **TypeScript runs natively:**
  - Erasable syntax only: no `enum`, `namespace`, constructor parameter properties or `import x = require()`.
  - Use `import type`, and include `.ts` in relative imports.
  - Node can't strip JSX, so `.tsx` files must never be imported by Node tests; only esbuild compiles them.
- **Dependencies:**
  - Runtime dependencies are unchanged (engine: `acorn`, `xz-decompress`). No native addons.
  - New root devDependencies, pinned exactly: `react` 18.3.1, `react-test-renderer` 18.3.1, `@types/react` 18.3.26. They are for tests and types only, and none is bundled into the extension.
- **The fork:**
  - Source of the port: `/home/borislav/github/hydra` at commit `3f098e9f` ("fix(similar-games): keep useSimilarGames redux-free and prefer cache over stale state").
  - Read it with `git -C /home/borislav/github/hydra show 3f098e9f:<path>`. Never modify that repository.
- **Hydra 4.1.6 facts** the patches rely on, verified in `out/renderer/assets/index-Cpo9haoY.js`:
  - the stock section is `function SimilarGames({ objectId, shop })`
  - the root render is the module's last statement
  - `index.html` loads one module script, `./assets/index-Cpo9haoY.js`, under a CSP of `default-src 'self' 'unsafe-inline' * …`
  - React is 18.3.1
- **Bundle:**
  - The manifest goes to version `"0.3.0"`. `minEngine` stays `"0.2.0"` and `ENGINE_VERSION` is unchanged: M3 needs no engine change.
  - The bundle is still one ESM file with no imports and no top-level `await`.
- **Tests:**
  - `node:test` + `node:assert/strict`.
  - Unit tests never touch the network, the real home dirs or port 3000; they use temp dirs and stubbed `window.electron`.
  - `npm test` and `npm run typecheck` (now two `tsc` runs) must stay clean after every task.
- **Port 3000** is a production server on this machine: never listen on or connect to it. Never read or modify `/opt/Hydra`.
- **Commits:** conventional (`feat:`, `fix:`, `test:`, `docs:`), ending with a blank line and a `Co-Authored-By: Claude …` trailer. The commit commands below show the planner's trailer; an implementer may name its own model instead (M2 did both).

## Review Focus

Inputs the spec implies but no feature test would naturally hit. Each line names the expected behavior and the task that pins it:

1. **The extension runs before Hydra exists.** Loading it with an empty registry must not throw: no registry read and no React call at load. Pinned in Task 3: the extension is imported with an empty registry and only installs `mount()` and its stylesheet.
2. **A registry entry missing at runtime**, because a future Hydra renamed or dropped something, must show Hydra's stock section and log why, never a broken game page. Pinned in Tasks 1 and 3: the error boundary falls back, including for the real built extension.
3. **A captured name that isn't a top-level binding of Hydra's module** must fail its registry patch at patch time. The inserted line would otherwise throw while Hydra loads and blank the whole UI. Pinned in Task 4.
4. **A Hydra whose stock section changed** must skip only "More like this" and leave the stock section untouched, with no mount line and no change to the other patches. Pinned in Task 4 (modified fixture) and Task 6 (real Hydra 4.0.6).
5. **Disabling "More like this"** must leave the renderer, `index.html` and the asar file list exactly as without M3. Pinned in Task 4.

## File Structure

```
package.json                      + react, react-test-renderer, @types/react (dev); typecheck runs two tsc projects
tsconfig.json                     excludes the TSX extension; includes bundles/*/scripts
packages/sdk/
  package.json                    exports "./shims/*"
  src/shims/registry.ts           revamp(), need(): the global registry, read at call time
  src/shims/react.ts              React API subset that calls the app's React
  src/shims/jsx-runtime.ts        jsx/jsxs/Fragment that call the app's JSX runtime
  src/shims/mount.ts              mount(id, Original) + lazily built error boundary
  test/shims.test.ts
packages/cli/src/format.ts        report header counts named patches only
bundles/official/
  package.json                    build: node scripts/build.ts
  scripts/extension.ts            buildExtension(entry): esbuild → one ESM string (react → shims, .css → <style>)
  scripts/build.ts                extensions, then dist/official.mjs with define __REVAMP_HYDRA_EXTENSION__
  src/index.ts                    manifest 0.3.0; + More like this ranking
  src/hydra/extension-loader.ts   internal "Hydra extension loader"
  src/hydra/registry.ts           root-render fingerprint, register(), 4 internal registry patches
  src/hydra/more-like-this.ts     "More like this ranking": the mount line
  src/hydra/extension/            the extension (own tsconfig: jsx, dom)
    index.tsx  app.ts  env.d.ts  tsconfig.json
    hooks/similar-games.ts  hooks/use-similar-games.ts  hooks/use-similar-game-views.ts   (fork, imports remapped)
    pages/game-details/similar-games/similar-games.tsx  similar-games.css                  (fork; CSS compiled once)
  test/similar-games.test.ts      the fork's tests, ported
  test/extension.test.ts          builds and renders the extension with React 18.3.1
  test/patches.test.ts            + loader, registry, mount, failure and disable tests
  test/fixtures/hydra-4.1.6/more-like-this-excerpt.js, index.html
test/integration/hydra.test.ts, hydra-mismatch.test.ts   extended for M3
CLAUDE.md                         extension architecture notes
```

---

### Task 1: SDK runtime shims: registry, React, JSX runtime, mount

**Model:** `sonnet` / `medium`

**Files:**
- Modify: `package.json`, `package-lock.json` (three exact-pinned devDependencies, via `npm install`)
- Modify: `packages/sdk/package.json` (export `./shims/*`)
- Create: `packages/sdk/src/shims/registry.ts`, `react.ts`, `jsx-runtime.ts`, `mount.ts`
- Test: `packages/sdk/test/shims.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (importable as `@revamp/sdk/shims/<name>`):
  - `interface RevampGlobal { registry: Record<string, unknown>; mounts: Record<string, unknown>; mount?(id, original): unknown }` and `revamp(): RevampGlobal`. The latter creates `globalThis.__revamp = { registry: {}, mounts: {} }` on first use.
  - `need<T>(name: string): T`: the registry entry, or throws `Revamp: "<name>" is missing from the app registry`.
  - From `react`: `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState`, `createElement`, each calling `need("React")` at call time.
  - From `jsx-runtime`: `jsx`, `jsxs` (call `need("jsxRuntime")` at call time) and `Fragment = Symbol.for("react.fragment")`.
  - `mount<P>(id: string, Original: ComponentType<P>): FunctionComponent<P>`:
    - Renders `revamp().mounts[id]` with `{ ...props, Original }` inside an error boundary that falls back to `Original` and logs `Revamp: "<id>" failed, so the stock UI is shown instead`.
    - Renders `Original` when nothing is registered.
    - The boundary class is created from the registered React on first render.

**Why "call time":** the extension's `<script>` runs before Hydra's module. At that moment there is no React in the registry, so nothing may read it until a component renders (spec §6: "reads globalThis.__revamp.registry lazily at call time").

- [ ] **Step 1: Add the test dependencies and write the failing test**

Run: `npm install -D --save-exact react@18.3.1 react-test-renderer@18.3.1 @types/react@18.3.26`

Create `packages/sdk/test/shims.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mount } from "../src/shims/mount.ts";
import { useState } from "../src/shims/react.ts";
import { need, revamp } from "../src/shims/registry.ts";

// React 18.3.1, the version Hydra 4.1.6 ships, standing in for the app's own React.
const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { act, create } = require("react-test-renderer") as {
  act(fn: () => void): void;
  create(element: unknown): { toJSON(): unknown };
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = (element: unknown) => {
  let renderer: { toJSON(): unknown } | undefined;
  act(() => {
    renderer = create(element);
  });
  return renderer!.toJSON();
};
const reset = () => {
  delete (globalThis as { __revamp?: unknown }).__revamp;
};

test("need() returns a registry entry and names a missing one", () => {
  reset();
  revamp().registry.answer = 42;
  assert.equal(need("answer"), 42);
  assert.throws(() => need("React"), /Revamp: "React" is missing from the app registry/);
});

test("the react shim calls the registered React, so hooks work inside the app's renderer", () => {
  reset();
  revamp().registry.React = React;
  function Counter() {
    const [count] = useState(7);
    return React.createElement("span", null, count);
  }
  assert.deepEqual(render(React.createElement(Counter)), { type: "span", props: {}, children: ["7"] });
});

test("mount() renders the original until an extension registers a replacement", () => {
  reset();
  revamp().registry.React = React;
  const Original = (props: { name: string }) => React.createElement("b", null, `stock ${props.name}`);
  const Mounted = mount("demo", Original);
  assert.deepEqual(render(React.createElement(Mounted, { name: "x" })), { type: "b", props: {}, children: ["stock x"] });
  revamp().mounts.demo = (props: { name: string; Original: unknown }) =>
    React.createElement("i", null, `revamped ${props.name}`, props.Original === Original ? " (has Original)" : "");
  assert.deepEqual(render(React.createElement(Mounted, { name: "x" })), {
    type: "i",
    props: {},
    children: ["revamped x", " (has Original)"],
  });
});

test("mount() falls back to the original when the replacement throws, and says why", (t) => {
  reset();
  revamp().registry.React = React;
  const errors = t.mock.method(console, "error", () => {});
  revamp().mounts.demo = () => {
    throw new Error("boom");
  };
  const Mounted = mount("demo", () => React.createElement("b", null, "stock"));
  assert.deepEqual(render(React.createElement(Mounted)), { type: "b", props: {}, children: ["stock"] });
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('Revamp: "demo" failed, so the stock UI is shown instead')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/sdk/test/shims.test.ts`
Expected: FAIL with `Cannot find module '…/packages/sdk/src/shims/mount.ts'`.

- [ ] **Step 3: Implement**

Create `packages/sdk/src/shims/registry.ts`:

```ts
// Runtime code compiled into extensions. The app's own objects reach an extension through
// globalThis.__revamp.registry (filled by registry patches) and are looked up when they are used, never at load,
// because the extension's <script> runs before the app's module.

export interface RevampGlobal {
  /** App internals by name, filled by the bundle's registry patches. */
  registry: Record<string, unknown>;
  /** Extension replacements for mounted components, by mount id. */
  mounts: Record<string, unknown>;
  /** Wraps an app component so an extension can replace it; installed by the extension. */
  mount?: (id: string, original: unknown) => unknown;
}

export const revamp = (): RevampGlobal => ((globalThis as { __revamp?: RevampGlobal }).__revamp ??= { registry: {}, mounts: {} });

/** An app internal from the registry; throws a named error when a registry patch didn't provide it. */
export function need<T = any>(name: string): T {
  const value = revamp().registry[name];
  if (value === undefined) throw new Error(`Revamp: "${name}" is missing from the app registry`);
  return value as T;
}
```

Create `packages/sdk/src/shims/react.ts`:

```ts
// esbuild maps an extension's `import … from "react"` here: every call goes to the app's own React,
// so hooks share the app's renderer. Add a name here when extension code imports a new one.
import type * as React from "react";
import { need } from "./registry.ts";

const react = () => need<typeof React>("React");

export const useCallback: typeof React.useCallback = (callback, deps) => react().useCallback(callback, deps);
export const useEffect: typeof React.useEffect = (effect, deps) => react().useEffect(effect, deps);
export const useMemo: typeof React.useMemo = (factory, deps) => react().useMemo(factory, deps);
export const useRef = ((initial?: unknown) => react().useRef(initial)) as typeof React.useRef;
export const useState = ((initial?: unknown) => react().useState(initial)) as typeof React.useState;
export const createElement = ((...args: Parameters<typeof React.createElement>) => react().createElement(...args)) as typeof React.createElement;
```

Create `packages/sdk/src/shims/jsx-runtime.ts`:

```ts
// esbuild maps an extension's automatic JSX runtime ("react/jsx-runtime") here.
import { need } from "./registry.ts";

interface JsxRuntime {
  jsx(type: unknown, props: unknown, key?: string): unknown;
  jsxs(type: unknown, props: unknown, key?: string): unknown;
}

const runtime = () => need<JsxRuntime>("jsxRuntime");

export const jsx = (type: unknown, props: unknown, key?: string) => runtime().jsx(type, props, key);
export const jsxs = (type: unknown, props: unknown, key?: string) => runtime().jsxs(type, props, key);
/** React has used this symbol for fragments since React 16, so it is safe to create before the app loads. */
export const Fragment = Symbol.for("react.fragment");
```

Create `packages/sdk/src/shims/mount.ts`:

```ts
import type * as React from "react";
import { need, revamp } from "./registry.ts";

interface BoundaryProps {
  id: string;
  fallback: () => React.ReactNode;
  children?: React.ReactNode;
}

let Boundary: React.ComponentType<BoundaryProps> | undefined;

/** An error boundary built from the app's React on first use, so that it exists before React is registered. */
function boundary(react: typeof React): React.ComponentType<BoundaryProps> {
  return (Boundary ??= class RevampBoundary extends react.Component<BoundaryProps, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error: unknown) {
      console.error(`Revamp: "${this.props.id}" failed, so the stock UI is shown instead`, error);
    }
    render() {
      return this.state.failed ? this.props.fallback() : this.props.children;
    }
  });
}

/**
 * Wraps an app component. When an extension registered `revamp().mounts[id]`, that component renders instead,
 * receiving the original props plus `Original`; if it throws while rendering, the original renders.
 */
export function mount<P extends object>(id: string, Original: React.ComponentType<P>): React.FunctionComponent<P> {
  return function RevampMount(props: P) {
    const react = need<typeof React>("React");
    const Replacement = revamp().mounts[id] as React.ComponentType<P & { Original: React.ComponentType<P> }> | undefined;
    if (!Replacement) return react.createElement(Original, props);
    return react.createElement(
      boundary(react),
      { id, fallback: () => react.createElement(Original, props) },
      react.createElement(Replacement, { ...props, Original }),
    );
  };
}
```

In `packages/sdk/package.json`, replace:

```json
  "exports": { ".": "./src/index.ts" }
```

with:

```json
  "exports": { ".": "./src/index.ts", "./shims/*": "./src/shims/*.ts" }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/sdk/test/shims.test.ts && npm test && npm run typecheck`
Expected: PASS. 4 shim tests with no other output; `npm test` reports 151 tests, 0 failures; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/sdk/package.json packages/sdk/src/shims packages/sdk/test/shims.test.ts
git commit -m "feat(sdk): runtime shims for extensions: registry, React, JSX runtime, mount

Extension code reaches the app's React and internals through
globalThis.__revamp.registry at call time, because the extension loads
before the app. mount() swaps an app component for an extension's and
falls back to the original when the replacement throws.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Port the fork's "More like this" into the Hydra extension

**Model:** `sonnet` / `medium`

**Files:**
- Create (copied from the fork at `3f098e9f`, then imports remapped):
  - `bundles/official/src/hydra/extension/hooks/similar-games.ts`, `use-similar-games.ts`, `use-similar-game-views.ts`
  - `bundles/official/src/hydra/extension/pages/game-details/similar-games/similar-games.tsx`
- Create: `bundles/official/src/hydra/extension/pages/game-details/similar-games/similar-games.css` (the fork's SCSS, compiled once)
- Create: `bundles/official/src/hydra/extension/app.ts`, `env.d.ts`, `index.tsx`, `tsconfig.json`
- Modify: `tsconfig.json` (exclude the extension), `package.json` (`typecheck` runs both projects)
- Test: `bundles/official/test/similar-games.test.ts` (the fork's test file, ported)

**Interfaces:**
- Consumes: `@revamp/sdk/shims/registry` (`need`, `revamp`), `@revamp/sdk/shims/jsx-runtime` (`jsx`) and `@revamp/sdk/shims/mount` (`mount`) from Task 1.
- Produces:
  - `src/hydra/extension/index.tsx`, the extension entry Task 3 builds. It sets `revamp().mount ??= mount` and `revamp().mounts["hydra.similarGames"] = ({ objectId, shop }) => <SimilarGames …/>`.
  - The registry names `app.ts` reads, which Task 4's patches must provide exactly:
    - `React`, `jsxRuntime`, `useNavigate`, `useTranslation`, `useEmblaCarousel`
    - `VerticalCoverCard`, `buildGameDetailsPath`, `ChevronLeftIcon`, `ChevronRightIcon`, `Skeleton`
    - `levelDBService`, `orderBy`, `logger`
    - `useLibrary`, `useAppDispatch`, `useAppSelector`
    - `setTags`, `getLocalizedSteamMetadata`

**Porting rule (spec §6):** the fork's code is copied verbatim; only import lines change. App internals and Hydra's bundled UI libraries now come from `app.ts`, and `react` stays as is: Task 3's esbuild plugin points it at the SDK shim. The SCSS was compiled once with the fork's own `sass` (`sass --no-source-map …/similar-games.scss`); its `@use "../../../scss/globals.scss"` only contributes the 8 px spacing unit. The extension's `tsconfig.json` enables JSX and DOM types for these files only. The root project excludes them, since Node tests never load `.tsx`.

- [ ] **Step 1: Write the failing test (the fork's own tests)**

Run:

```bash
git -C /home/borislav/github/hydra show 3f098e9f:src/renderer/src/hooks/similar-games.test.ts > bundles/official/test/similar-games.test.ts
```

In `bundles/official/test/similar-games.test.ts`, replace:

```ts
import assert from "node:assert/strict";
```

with:

```ts
// Ported from the fork's src/renderer/src/hooks/similar-games.test.ts (xb00tt/hydra 3f098e9f);
// only the import paths and the last test's file path and import names changed.
import assert from "node:assert/strict";
```

In `bundles/official/test/similar-games.test.ts`, replace:

```ts
} from "./similar-games.js";
```

with:

```ts
} from "../src/hydra/extension/hooks/similar-games.ts";
```

In `bundles/official/test/similar-games.test.ts`, replace:

```ts
      new URL("./use-similar-games.ts", import.meta.url),
```

with:

```ts
      new URL("../src/hydra/extension/hooks/use-similar-games.ts", import.meta.url),
```

In `bundles/official/test/similar-games.test.ts`, replace:

```ts
    for (const forbidden of [
      "./redux",
      "react-redux",
      "./use-library",
      "./use-catalogue",
      "@renderer/features",
    ]) {
```

with:

```ts
    for (const forbidden of ["useAppDispatch", "useAppSelector", "useLibrary", "getLocalizedSteamMetadata", "setTags"]) {
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test bundles/official/test/similar-games.test.ts`
Expected: FAIL with `Cannot find module '…/src/hydra/extension/hooks/similar-games.ts'`.

- [ ] **Step 3: Port the code**

Run:

```bash
X=bundles/official/src/hydra/extension
mkdir -p $X/hooks $X/pages/game-details/similar-games
for f in similar-games.ts use-similar-games.ts use-similar-game-views.ts; do
  git -C /home/borislav/github/hydra show 3f098e9f:src/renderer/src/hooks/$f > $X/hooks/$f
done
git -C /home/borislav/github/hydra show 3f098e9f:src/renderer/src/pages/game-details/similar-games/similar-games.tsx > $X/pages/game-details/similar-games/similar-games.tsx
```

In `bundles/official/src/hydra/extension/hooks/similar-games.ts`, replace:

```ts
import type { GameShop } from "@types";
```

with:

```ts
import type { GameShop } from "../app.ts";
```

In `bundles/official/src/hydra/extension/hooks/use-similar-games.ts`, replace:

```ts
import { useEffect, useRef, useState } from "react";
import { orderBy } from "lodash-es";

import { logger } from "@renderer/logger";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import {
```

with:

```ts
import { useEffect, useRef, useState } from "react";

import { levelDBService, logger, orderBy, type DownloadSource } from "../app.ts";
import {
```

In `bundles/official/src/hydra/extension/hooks/use-similar-games.ts`, replace:

```ts
} from "./similar-games";
```

with:

```ts
} from "./similar-games.ts";
```

In `bundles/official/src/hydra/extension/hooks/use-similar-game-views.ts`, replace:

```ts
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { logger } from "@renderer/logger";
import { setTags } from "@renderer/features";
import { useAppDispatch, useAppSelector } from "./redux";
import { useLibrary } from "./use-library";
import { getLocalizedSteamMetadata } from "./use-catalogue";
import { useSimilarGames } from "./use-similar-games";
import {
```

with:

```ts
import { useEffect, useMemo } from "react";

import {
  getLocalizedSteamMetadata,
  logger,
  setTags,
  useAppDispatch,
  useAppSelector,
  useLibrary,
  useTranslation,
} from "../app.ts";
import { useSimilarGames } from "./use-similar-games.ts";
import {
```

In `bundles/official/src/hydra/extension/hooks/use-similar-game-views.ts`, replace:

```ts
} from "./similar-games";
```

with:

```ts
} from "./similar-games.ts";
```

In `bundles/official/src/hydra/extension/pages/game-details/similar-games/similar-games.tsx`, replace:

```tsx
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";

import type { GameShop } from "@types";
import { VerticalCoverCard } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useSimilarGameViews } from "@renderer/hooks";
import { getSimilarGamesSectionState } from "@renderer/hooks/similar-games";

import "./similar-games.scss";
```

with:

```tsx
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  buildGameDetailsPath,
  ChevronLeftIcon,
  ChevronRightIcon,
  Skeleton,
  useEmblaCarousel,
  useNavigate,
  useTranslation,
  VerticalCoverCard,
  type GameShop,
} from "../../../app.ts";
import { getSimilarGamesSectionState } from "../../../hooks/similar-games.ts";
import { useSimilarGameViews } from "../../../hooks/use-similar-game-views.ts";

import "./similar-games.css";
```

Create `bundles/official/src/hydra/extension/pages/game-details/similar-games/similar-games.css`:

```css
/* Compiled once from the fork's src/renderer/src/pages/game-details/similar-games/similar-games.scss
   (xb00tt/hydra 3f098e9f) with `sass --no-source-map`. */
.similar-games {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  align-self: center;
  margin-inline: auto;
}
@media (min-width: 1280px) {
  .similar-games {
    width: 60%;
  }
}
@media (min-width: 1536px) {
  .similar-games {
    width: 50%;
  }
}
.similar-games__title {
  font-size: 20px;
  font-weight: 600;
}
.similar-games__carousel {
  position: relative;
  width: 100%;
}
.similar-games__viewport {
  position: relative;
  overflow: clip;
  overflow-clip-margin: 0px;
  border-radius: 6px;
  transition: overflow-clip-margin 0s linear 0.2s;
  transition-behavior: allow-discrete;
}
.similar-games__viewport:has(.similar-games__card:hover) {
  overflow-clip-margin: 14px;
  transition-delay: 0s;
}
.similar-games__container {
  display: flex;
  margin-inline: -8px;
}
.similar-games__slide {
  display: flex;
  flex: 0 0 33.3333333333%;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 3px 8px;
}
.similar-games__card:hover {
  transform: scale(1.05);
}
.similar-games__caption {
  display: -webkit-box;
  min-height: 2.4em;
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.2;
  color: #d0d1d7;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.similar-games__badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  color: #f0f1f7;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 4px;
}
.similar-games__skeleton {
  width: 100%;
  aspect-ratio: 2/3;
  border-radius: 4px;
}
.similar-games__empty {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 2/1;
  place-items: center;
  padding: 16px;
  color: #f0f1f7;
  text-align: center;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}
.similar-games__control {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  color: #f0f1f7;
  background-color: rgba(0, 0, 0, 0.4);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transform: translateY(-50%);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.similar-games__control:hover:not(:disabled) {
  background-color: rgba(0, 0, 0, 0.6);
}
.similar-games__control:active:not(:disabled) {
  transform: translateY(-50%) scale(0.95);
}
.similar-games__control:disabled {
  opacity: 0;
  pointer-events: none;
}
.similar-games__control--previous {
  left: 8px;
  opacity: 0;
  transform: translateY(-50%) translateX(-16px);
}
.similar-games__viewport:hover .similar-games__control--previous:not(:disabled) {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}
.similar-games__control--next {
  right: 8px;
  opacity: 0;
  transform: translateY(-50%) translateX(16px);
}
.similar-games__viewport:hover .similar-games__control--next:not(:disabled) {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}
```

Create `bundles/official/src/hydra/extension/app.ts`:

```ts
// Hydra internals the extension uses, read from the registry at call time (see @revamp/sdk/shims/registry).
// The registry patches in ../registry.ts fill these names; the ported fork code imports them from here
// instead of from @renderer/*, react-i18next, react-router-dom and the UI libraries Hydra bundles.
import type { ReactNode } from "react";
import { jsx } from "@revamp/sdk/shims/jsx-runtime";
import { need } from "@revamp/sdk/shims/registry";

// Types: the parts of Hydra's types the ported code relies on.
export type GameShop = "steam" | "launchbox" | "custom";
export interface DownloadSource {
  id: string;
  createdAt: string;
}
interface LibraryGame {
  shop: GameShop;
  objectId: string;
}
interface HydraState {
  catalogueSearch: { steamUserTags: Record<string, Record<string, number> | undefined> };
}
interface EmblaApi {
  canScrollPrev(): boolean;
  canScrollNext(): boolean;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  scrollTo(index: number, jump?: boolean): void;
  scrollPrev(): void;
  scrollNext(): void;
}
export interface VerticalCoverCardProps {
  gameTitle: string;
  coverImageUrls: Array<string | null>;
  className?: string;
  useClassicsLayout?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

// Hooks and functions: called through, so the app's own instance runs.
export const useTranslation = (ns?: string) =>
  need<(ns?: string) => { t: (key: string) => string; i18n: { language: string } }>("useTranslation")(ns);
export const useNavigate = () => need<() => (path: string) => void>("useNavigate")();
export const useEmblaCarousel = (options: Record<string, unknown>) =>
  need<(options: Record<string, unknown>) => [(node: HTMLElement | null) => void, EmblaApi | undefined]>("useEmblaCarousel")(options);
export const useLibrary = () => need<() => { library: LibraryGame[] }>("useLibrary")();
export const useAppDispatch = () => need<() => (action: unknown) => void>("useAppDispatch")();
export const useAppSelector = <T,>(selector: (state: HydraState) => T): T =>
  need<(selector: (state: HydraState) => T) => T>("useAppSelector")(selector);
export const setTags = (tags: unknown) => need<(tags: unknown) => unknown>("setTags")(tags);
export const getLocalizedSteamMetadata = <T,>(endpoint: string, locale: string) =>
  need<(endpoint: string, locale: string) => Promise<T>>("getLocalizedSteamMetadata")(endpoint, locale);
export const buildGameDetailsPath = (game: { shop: string; objectId: string; title: string }) =>
  need<(game: { shop: string; objectId: string; title: string }) => string>("buildGameDetailsPath")(game);
export const orderBy = <T,>(items: T[], key: string, order: "asc" | "desc") =>
  need<(items: T[], key: string, order: string) => T[]>("orderBy")(items, key, order);
export const logger = {
  error: (...args: unknown[]) => need<{ error(...args: unknown[]): void }>("logger").error(...args),
};
export const levelDBService = {
  values: (sublevel: string) => need<{ values(sublevel: string): Promise<unknown[]> }>("levelDBService").values(sublevel),
};

// Components: thin wrappers that render the app's own component.
const component =
  <P,>(name: string) =>
  (props: P) =>
    jsx(need(name), props) as ReactNode;
export const VerticalCoverCard = component<VerticalCoverCardProps>("VerticalCoverCard");
export const Skeleton = component<{ className?: string }>("Skeleton");
export const ChevronLeftIcon = component<{ size?: number }>("ChevronLeftIcon");
export const ChevronRightIcon = component<{ size?: number }>("ChevronRightIcon");
```

Create `bundles/official/src/hydra/extension/env.d.ts`:

```ts
// Globals the ported fork code uses in Hydra's renderer.
interface Window {
  electron: {
    hydraApi: {
      get<T>(path: string, options?: unknown): Promise<T>;
      post<T>(path: string, options?: unknown): Promise<T>;
    };
  };
}

/** Stylesheets are injected as a <style> element when the extension loads (see scripts/extension.ts). */
declare module "*.css";
```

Create `bundles/official/src/hydra/extension/index.tsx`:

```tsx
// The Hydra extension entry, loaded by a <script type="module"> placed before Hydra's own module script.
// It runs before Hydra exists, so it only installs mount() and registers replacements; nothing here may
// touch the registry until a mounted component renders.
import { mount } from "@revamp/sdk/shims/mount";
import { revamp } from "@revamp/sdk/shims/registry";
import type { GameShop } from "./app.ts";
import { SimilarGames } from "./pages/game-details/similar-games/similar-games.tsx";

const root = revamp();
root.mount ??= mount as (id: string, original: unknown) => unknown;
root.mounts["hydra.similarGames"] = ({ objectId, shop }: { objectId: string; shop: GameShop }) => (
  <SimilarGames objectId={objectId} shop={shop} />
);
```

Create `bundles/official/src/hydra/extension/tsconfig.json`:

```json
{
  "extends": "../../../../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["esnext", "dom"],
    "types": []
  },
  "include": ["./"],
  "exclude": []
}
```

In `tsconfig.json`, replace:

```json
  "include": ["packages/*/src", "packages/*/test", "bundles/*/src", "bundles/*/test", "test"]
}
```

with:

```json
  "include": ["packages/*/src", "packages/*/test", "bundles/*/src", "bundles/*/test", "test"],
  "exclude": ["bundles/official/src/hydra/extension"]
}
```

In `package.json`, replace:

```json
    "typecheck": "tsc -p .",
```

with:

```json
    "typecheck": "tsc -p . && tsc -p bundles/official/src/hydra/extension",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test bundles/official/test/similar-games.test.ts && npm test && npm run typecheck`
Expected: PASS. 37 ported tests; `npm test` reports 188 tests, 0 failures; both `tsc` runs print nothing.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json package.json bundles/official/src/hydra/extension bundles/official/test/similar-games.test.ts
git commit -m "feat(bundle): port the fork's More like this into a Hydra extension

The fork's ranking, caching and card code (xb00tt/hydra 3f098e9f) is
copied unchanged apart from its imports: Hydra's internals and bundled
UI libraries come from app.ts, which reads the registry at call time.
The fork's own tests run against the port.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Build the extension and prove it renders with Hydra's React

**Model:** `sonnet` / `medium`

**Files:**
- Create: `bundles/official/scripts/extension.ts`, `bundles/official/scripts/build.ts`
- Modify: `bundles/official/package.json` (`build`), `tsconfig.json` (include `bundles/*/scripts`)
- Test: `bundles/official/test/extension.test.ts`

**Interfaces:**
- Consumes: the extension entry `src/hydra/extension/index.tsx` (Task 2) and the SDK shims (Task 1).
- Produces:
  - `buildExtension(entry: string): Promise<string>`: one ES module (esbuild, `format: "esm"`, `platform: "browser"`, `target: "es2022"`, automatic JSX).
    - `react` and `react/jsx-runtime` resolve to `packages/sdk/src/shims/react.ts` and `jsx-runtime.ts`.
    - A `.css` import becomes code that appends a `<style>` to `document.head` when the module loads.
  - `npm run build -w @revamp/bundle-official` runs `scripts/build.ts`. It builds the Hydra extension first, then `dist/official.mjs` with `define: { __REVAMP_HYDRA_EXTENSION__: JSON.stringify(code) }`, and prints `dist/official.mjs written (Hydra extension: 22.0 kB)`. Task 4's loader reads that name.

**What the end-to-end test proves.** It loads the built extension the way Hydra will (an ES module with an empty registry), then fills the registry with real React 18.3.1 and stand-ins for Hydra's internals and renders through `mount()`. The stubbed API returns:
- six specific tags for game 100
- catalogue-search results per query size and sort order
- two `/similar` games

The ranked order must follow the fork's rules: hit count, then download sources, then first seen; owned games last. With one registry entry missing, the stock section must render and the reason must be logged. The test leaves stand-ins for `window` and `document` in place; it runs in its own process, like every `node --test` file.

- [ ] **Step 1: Write the failing test**

Create `bundles/official/test/extension.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildExtension } from "../scripts/extension.ts";

// The built Hydra extension, loaded the way Hydra loads it, rendered by React 18.3.1 (Hydra 4.1.6's version)
// through mount(), with stand-ins for the Hydra internals the registry patches provide.
const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { act, create } = require("react-test-renderer") as {
  act(fn: () => Promise<void> | void): Promise<void>;
  create(element: unknown): { root: { findAll(test: (node: { type: unknown; props: Record<string, any> }) => boolean): Array<{ props: Record<string, any> }> } };
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Revamp = { registry: Record<string, unknown>; mounts: Record<string, unknown>; mount(id: string, original: unknown): unknown };
const revamp = () => (globalThis as unknown as { __revamp: Revamp }).__revamp;

const styles: string[] = [];
(globalThis as { document?: unknown }).document = {
  createElement: () => ({ textContent: "" }),
  head: { append: (style: { textContent: string }) => styles.push(style.textContent) },
};

const entry = fileURLToPath(new URL("../src/hydra/extension/index.tsx", import.meta.url));
const file = join(mkdtempSync(join(tmpdir(), "revamp-ext-")), "revamp-hydra.js");
writeFileSync(file, await buildExtension(entry));
await import(pathToFileURL(file).href);

const game = (objectId: string) => ({ objectId, shop: "steam", title: `Game ${objectId}`, libraryImageUrl: `${objectId}.jpg`, downloadSources: [] });
// The current game (100) has six specific tags. Each catalogue search returns games for the tags it was given;
// /similar returns games without tags. Expected rank by hit count: A (3), B (2), C and D (1, C seen first), E (0).
const searches: Record<string, string[]> = { "6:popularity": ["A"], "5:popularity": ["B", "A"], "5:reviewScore": ["A", "C"], "4:popularity": ["B", "D"] };
(globalThis as { window?: unknown }).window = {
  electron: {
    hydraApi: {
      get: async (path: string) =>
        path === "/games/steam/100" ? { tags: [10, 11, 12, 13, 14, 15] } : path === "/catalogue/steam/100/similar" ? [game("E"), game("C")] : null,
      post: async (_path: string, { data }: { data: { tags: number[]; sortBy: string } }) => ({
        edges: (searches[`${data.tags.length}:${data.sortBy}`] ?? []).map(game),
      }),
    },
  },
};

const element = (type: string) => (props: Record<string, unknown>) => React.createElement(type, props, props.children as never);
function hydra(overrides: Record<string, unknown> = {}) {
  const state = { catalogueSearch: { steamUserTags: { en: { Roguelike: 10, Deckbuilder: 11, Strategy: 12 } } } };
  Object.assign(revamp().registry, {
    React,
    jsxRuntime: require("react/jsx-runtime"),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    useNavigate: () => () => {},
    useEmblaCarousel: () => [() => {}, undefined],
    VerticalCoverCard: element("card"),
    Skeleton: element("skeleton"),
    ChevronLeftIcon: element("left"),
    ChevronRightIcon: element("right"),
    buildGameDetailsPath: (g: { objectId: string }) => `/game/steam/${g.objectId}`,
    levelDBService: { values: async () => [{ id: "source-1", createdAt: "2026-01-01" }] },
    orderBy: (items: unknown[]) => items,
    logger: { error: () => {} },
    useLibrary: () => ({ library: [{ shop: "steam", objectId: "D" }] }),
    useAppDispatch: () => () => {},
    useAppSelector: (select: (s: typeof state) => unknown) => select(state),
    setTags: (tags: unknown) => ({ type: "setTags", payload: tags }),
    getLocalizedSteamMetadata: async () => ({}),
    ...overrides,
  });
}

async function renderSimilarGames() {
  const Stock = () => React.createElement("stock");
  const Mounted = revamp().mount("hydra.similarGames", Stock) as React.FunctionComponent<{ objectId: string; shop: string }>;
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(Mounted, { objectId: "100", shop: "steam" }));
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 10))); // let the searches settle
  return renderer!.root;
}

test("the extension installs mount() and its stylesheet when it loads, before Hydra exists", () => {
  assert.equal(typeof revamp().mount, "function");
  assert.equal(typeof revamp().mounts["hydra.similarGames"], "function");
  assert.ok(styles[0].includes(".similar-games__caption"));
});

test("More like this ranks by shared tags, captions the shared tags, and badges owned games last", async () => {
  hydra();
  const root = await renderSimilarGames();
  assert.equal(root.findAll((n) => n.type === "stock").length, 0);
  const cards = root.findAll((n) => n.type === "card");
  assert.deepEqual(cards.map((c) => c.props.gameTitle), ["Game A", "Game B", "Game C", "Game E", "Game D"]);
  const captions = root.findAll((n) => n.type === "p").map((p) => p.props.children);
  assert.deepEqual(captions, ["Roguelike · Deckbuilder", "Roguelike · Deckbuilder", "Roguelike · Deckbuilder", "", "Roguelike · Deckbuilder"]);
  const badges = root.findAll((n) => n.type === "span" && n.props.className === "similar-games__badge");
  assert.deepEqual(badges.map((b) => b.props.children), ["already_in_library"]);
});

test("a missing registry entry shows the stock section instead", async (t) => {
  hydra({ useEmblaCarousel: undefined });
  t.after(() => hydra());
  const errors = t.mock.method(console, "error", () => {});
  const root = await renderSimilarGames();
  assert.equal(root.findAll((n) => n.type === "stock").length, 1);
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('Revamp: "hydra.similarGames" failed')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test bundles/official/test/extension.test.ts`
Expected: FAIL with `Cannot find module '…/bundles/official/scripts/extension.ts'`.

- [ ] **Step 3: Implement**

Create `bundles/official/scripts/extension.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

const shim = (name: string) => fileURLToPath(new URL(`../../../packages/sdk/src/shims/${name}.ts`, import.meta.url));

/** The app's React: extension imports of react and its JSX runtime go to the registry shims. */
const revampExtension: Plugin = {
  name: "revamp-extension",
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: shim("react") }));
    b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: shim("jsx-runtime") }));
    // A stylesheet becomes a <style> element added when the extension loads, so it is one file.
    b.onLoad({ filter: /\.css$/ }, async (args) => ({
      loader: "js",
      contents:
        `const style = document.createElement("style");\n` +
        `style.textContent = ${JSON.stringify(await readFile(args.path, "utf8"))};\n` +
        `document.head.append(style);\n`,
    }));
  },
};

/** Compiles an extension entry (e.g. src/hydra/extension/index.tsx) to one ES module, returned as a string. */
export async function buildExtension(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: false,
    legalComments: "none",
    write: false,
    plugins: [revampExtension],
  });
  return result.outputFiles[0].text;
}
```

Create `bundles/official/scripts/build.ts`:

```ts
// npm run build -w @revamp/bundle-official: the extensions first, then the bundle with each one embedded as a string.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildExtension } from "./extension.ts";

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const hydraExtension = await buildExtension(here("src/hydra/extension/index.tsx"));
await build({
  entryPoints: [here("src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2024",
  outfile: here("dist/official.mjs"),
  define: { __REVAMP_HYDRA_EXTENSION__: JSON.stringify(hydraExtension) },
});
console.log(`dist/official.mjs written (Hydra extension: ${(hydraExtension.length / 1024).toFixed(1)} kB)`);
```

In `bundles/official/package.json`, replace:

```json
    "build": "esbuild src/index.ts --bundle --format=esm --platform=neutral --target=es2024 --outfile=dist/official.mjs"
```

with:

```json
    "build": "node scripts/build.ts"
```

In `tsconfig.json`, replace:

```json
  "include": ["packages/*/src", "packages/*/test", "bundles/*/src", "bundles/*/test", "test"],
```

with:

```json
  "include": ["packages/*/src", "packages/*/test", "bundles/*/src", "bundles/*/scripts", "bundles/*/test", "test"],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test bundles/official/test/extension.test.ts && npm test && npm run typecheck && npm run build -w @revamp/bundle-official`
Expected: PASS. 3 extension tests with no other output; `npm test` reports 191 tests, 0 failures; both `tsc` runs print nothing; the build prints `dist/official.mjs written (Hydra extension: 22.0 kB)`.

- [ ] **Step 5: Commit**

```bash
git add bundles/official/scripts bundles/official/package.json tsconfig.json bundles/official/test/extension.test.ts
git commit -m "feat(bundle): build extensions into the bundle; render the Hydra extension in tests

scripts/build.ts compiles each extension with esbuild (react to the SDK
shims, CSS to a <style>) and embeds it in dist/official.mjs. The test
loads the built extension with an empty registry and renders More like
this through mount() with React 18.3.1, Hydra's version.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Patches: extension loader, registry, and "More like this ranking"

**Model:** `sonnet` / `medium`; reviewer `opus` / `high` (the registry lines run during Hydra's startup)

**Files:**
- Create: `bundles/official/src/hydra/extension-loader.ts`, `registry.ts`, `more-like-this.ts`
- Modify: `bundles/official/src/index.ts` (register the patch, manifest `0.3.0`)
- Create: `bundles/official/test/fixtures/hydra-4.1.6/more-like-this-excerpt.js`, `bundles/official/test/fixtures/hydra-4.1.6/index.html`
- Test: `bundles/official/test/patches.test.ts`

**Interfaces:**
- Consumes:
  - `useBundledUi` (M1)
  - `Match.find`, `Capture.resolve`, `ctx.addFile`, `ctx.file` (M1/M2)
  - the registry names listed in Task 2
  - `__REVAMP_HYDRA_EXTENSION__`, defined by Task 3's build
- Produces:
  - `HYDRA_EXTENSION: string`: the built extension, or a placeholder comment in unit tests.
  - `EXTENSION_FILE = "out/renderer/assets/revamp-hydra.js"`.
  - Internal `hydraExtensionLoader` (`description: "Hydra extension loader"`, depends on `useBundledUi`). It adds `EXTENSION_FILE` and inserts `<script type="module" crossorigin src="./assets/revamp-hydra.js"></script>` on its own line, with the same indent, before the first `<script type="module"` in `out/renderer/index.html`.
  - Fingerprints `rootRender`, `similarGamesComponent`, `similarGamesSkeleton`, `similarGamesSources`, `similarGamesErrorLog`, `libraryHook`, `setTagsAction`, `steamFiltersRequest`.
  - Internal registry patches. Each adds one `Object.assign((globalThis.__revamp ??= { registry: {}, mounts: {} }).registry, { … });` line just before the root render:
    - `registerGamePage` ("registry: game page")
    - `registerGameData` ("registry: game data")
    - `registerLibrary` ("registry: library")
    - `registerSteamTags` ("registry: Steam tags")
  - Named `moreLikeThisRanking` ("More like this ranking", Hydra 4.1.6, on by default). It depends on `useBundledUi`, the loader and the four registry patches, and inserts `<Name> = globalThis.__revamp?.mount?.("hydra.similarGames", <Name>) ?? <Name>;` right after the stock `function SimilarGames`.

**Where each name comes from in Hydra 4.1.6** (all captured, then `resolve()`-checked as top-level bindings of the renderer):

| Registry name | Real 4.1.6 binding | Captured from |
|---|---|---|
| React, jsxRuntime | `reactExports$1`, `jsxRuntimeExports` | stock `SimilarGames`: its `useCallback` call and the card's `jsx` call |
| useNavigate, useTranslation | `useNavigate`, `useTranslation` | the first two lines of `SimilarGames` |
| useEmblaCarousel, VerticalCoverCard, buildGameDetailsPath | same names | `SimilarGames`: the carousel options, the card, `navigate(buildGameDetailsPath(game))` |
| ChevronLeftIcon, ChevronRightIcon | same names | `SimilarGames`: the previous/next buttons |
| Skeleton | `Skeleton$1` | the stock skeleton (`className: "similar-games__skeleton"`) |
| levelDBService, orderBy | `levelDBService`, `orderBy$1` | stock `useSimilarGames`: `values("downloadSources")`, `orderBy(…, "createdAt", "desc")` |
| logger | `logger` | stock `useSimilarGames`: `logger.error("Failed to fetch similar games", …)` |
| useLibrary, useAppDispatch, useAppSelector | `useLibrary$1`, `useAppDispatch$1`, `useAppSelector$1` | `useLibrary$1`'s body (`state.library.value`); the unsuffixed redux hooks are recharts' |
| setTags | `catalogueSearchSlice.actions.setTags` | `const { …, setTags, … } = catalogueSearchSlice.actions` |
| getLocalizedSteamMetadata | same name | the catalogue's `Promise.all([…("/catalogue/steam/tags"…), …("/catalogue/steam/genres"…)])`; Big Picture's direct `hydraApi.get` of the same paths is a decoy |

The test fixture `more-like-this-excerpt.js` holds real 4.1.6 code for the stock section, the stock hook, `useLibrary$1`, `buildGameDetailsPath`, `getLocalizedSteamMetadata` and the catalogue lookup. Library internals are cut down to their declarations, plus the Big Picture decoy and a trimmed root render. `index.html` is the real file.

- [ ] **Step 1: Write the fixtures and the failing tests**

Create `bundles/official/test/fixtures/hydra-4.1.6/more-like-this-excerpt.js`:

```js
// Excerpts from Hydra 4.1.6 out/renderer/assets/index-Cpo9haoY.js (MIT, github.com/hydralauncher/hydra), trimmed for
// Revamp's More like this tests: the stock section, the internals it is built from, the catalogue's tag lookup and the
// root render. Library code is cut down to its declaration; Big Picture's direct tag request is a decoy.
var jsxRuntimeExports = requireJsxRuntime();
var reactExports$1 = requireReact$1();
const React = /* @__PURE__ */ getDefaultExportFromCjs$1(reactExports$1);
function useNavigate() {
  let {
    isDataRoute
  } = reactExports$1.useContext(RouteContext);
  return isDataRoute ? useNavigateStable() : useNavigateUnstable();
}
const useTranslation = /* @__PURE__ */ __name(function(ns) {
  let props = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
  return useTranslationWithContext(ns, props);
}, "useTranslation");
function useEmblaCarousel(options = {}, plugins = []) {
  return [viewport, emblaApi];
}
function Skeleton$1({ count = 1, className: customClassName, ...props }) {
  return null;
}
var ChevronLeftIcon = /* @__PURE__ */ createIconComponent("ChevronLeftIcon", "octicon octicon-chevron-left", function() {
  return {};
});
var ChevronRightIcon = /* @__PURE__ */ createIconComponent("ChevronRightIcon", "octicon octicon-chevron-right", function() {
  return {};
});
const catalogueSearchSlice = createSlice({
  name: "catalogueSearch",
  initialState: initialState$h,
  reducers: {
    setTags: /* @__PURE__ */ __name((state, action) => {
      state.steamUserTags = action.payload;
    }, "setTags")
  }
});
const {
  setFilters,
  setTags,
  setGenres
} = catalogueSearchSlice.actions;
class LevelDBService {
  values(sublevelName) {
    return window.electron.leveldb.values(sublevelName);
  }
}
const levelDBService = new LevelDBService();
const logger = log$2.scope("renderer");
function orderBy$1(collection, iteratees, orders, guard) {
  return baseOrderBy(collection, iteratees, orders);
}
const useAppDispatch$1 = useDispatch;
const useAppSelector$1 = useSelector;
function useLibrary$1() {
  const dispatch = useAppDispatch$1();
  const library2 = useAppSelector$1((state) => state.library.value);
  const downloadLibrary = useAppSelector$1(
    (state) => state.library.downloadLibrary
  );
  const updateLibrary = reactExports$1.useCallback(async () => {
    return window.electron.getLibrary(true).then((updatedLibrary) => dispatch(setLibrary(updatedLibrary)));
  }, [dispatch]);
  return { library: library2, downloadLibrary, updateLibrary };
}
__name(useLibrary$1, "useLibrary$1");
function VerticalCoverCard({
  gameTitle,
  coverImageUrls,
  children,
  useClassicsLayout = false,
  showTitleTooltip = true,
  className,
  ...buttonProps
}) {
  return null;
}
const buildGameDetailsPath = /* @__PURE__ */ __name((game, params = {}) => {
  const searchParams = new URLSearchParams({ title: game.title, ...params });
  return `/game/${game.shop}/${game.objectId}?${searchParams.toString()}`;
}, "buildGameDetailsPath");
async function getLocalizedSteamMetadata(endpoint, locale2) {
  const language = locale2.split("-")[0] || "en";
  const requestLanguage = SUPPORTED_STEAM_METADATA_LANGUAGES.has(language) ? language : "en";
  const languages = requestLanguage === "en" ? ["en"] : ["en", requestLanguage];
  const entries = await Promise.all(
    languages.map(async (currentLanguage) => {
      const data = await window.electron.hydraApi.get(endpoint, {
        params: { language: currentLanguage },
        needsAuth: false
      });
      return [currentLanguage, data];
    })
  );
  const metadata = Object.fromEntries(entries);
  metadata[language] ??= metadata[requestLanguage];
  return metadata;
}
__name(getLocalizedSteamMetadata, "getLocalizedSteamMetadata");
function useCatalogue() {
  const dispatch = useAppDispatch$1();
  const { i18n } = useTranslation();
  const getSteamFilters = reactExports$1.useCallback(async () => {
    const [tags2, genres] = await Promise.all([
      getLocalizedSteamMetadata(
        "/catalogue/steam/tags",
        i18n.language
      ),
      getLocalizedSteamMetadata(
        "/catalogue/steam/genres",
        i18n.language
      )
    ]);
    dispatch(setTags(tags2));
    dispatch(setGenres(genres));
  }, [dispatch, i18n.language]);
  return { getSteamFilters };
}
const useSimilarGames = /* @__PURE__ */ __name((query) => {
  const [games, setGames] = reactExports$1.useState([]);
  const [isLoading, setIsLoading] = reactExports$1.useState(false);
  const [resultQueryKey, setResultQueryKey] = reactExports$1.useState("");
  const requestIdRef = reactExports$1.useRef(0);
  const { objectId, shop } = query;
  const queryKey = `${shop}:${objectId}`;
  const isEligible = Boolean(objectId) && (shop === "steam" || shop === "launchbox");
  reactExports$1.useEffect(() => {
    const requestId = ++requestIdRef.current;
    const stableQuery = { objectId, shop };
    setGames([]);
    setResultQueryKey(queryKey);
    if (!isEligible) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const get3 = /* @__PURE__ */ __name((path2, options) => globalThis.window.electron.hydraApi.get(path2, options), "get");
    const loadSimilarGames = /* @__PURE__ */ __name(async () => {
      const sources = await levelDBService.values(
        "downloadSources"
      );
      if (requestId !== requestIdRef.current) return;
      const downloadSourceIds = orderBy$1(sources, "createdAt", "desc").map(
        (source) => source.id
      );
      const results = await fetchSimilarGames(
        stableQuery,
        get3,
        downloadSourceIds
      );
      if (requestId === requestIdRef.current) setGames(results);
    }, "loadSimilarGames");
    void loadSimilarGames().catch((error2) => {
      if (requestId !== requestIdRef.current) return;
      logger.error("Failed to fetch similar games", error2);
      setGames([]);
    }).finally(() => {
      if (requestId === requestIdRef.current) setIsLoading(false);
    });
    return () => {
      requestIdRef.current += 1;
    };
  }, [isEligible, objectId, queryKey, shop]);
  const hasCurrentResults = resultQueryKey === queryKey;
  return {
    games: hasCurrentResults ? games : [],
    isLoading: isEligible && (!hasCurrentResults || isLoading),
    isEligible
  };
}, "useSimilarGames");
const GAMES_PER_PAGE = 3;
function SimilarGamesSlide({ children }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__slide", children });
}
__name(SimilarGamesSlide, "SimilarGamesSlide");
function SimilarGamesSkeleton$1() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__carousel", "aria-busy": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__viewport", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__container", children: Array.from({ length: GAMES_PER_PAGE }, (_2, index2) => /* @__PURE__ */ jsxRuntimeExports.jsx(SimilarGamesSlide, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Skeleton$1, { className: "similar-games__skeleton" }) }, `similar-game-skeleton-${index2}`)) }) }) });
}
__name(SimilarGamesSkeleton$1, "SimilarGamesSkeleton$1");
function SimilarGames({ objectId, shop }) {
  const navigate = useNavigate();
  const { t: t2 } = useTranslation("game_details");
  const { games, isLoading, isEligible } = useSimilarGames({ objectId, shop });
  const sectionState = getSimilarGamesSectionState(
    isEligible,
    isLoading,
    games.length
  );
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: GAMES_PER_PAGE,
    duration: 20
  });
  const [canScrollPrev, setCanScrollPrev] = reactExports$1.useState(false);
  const [canScrollNext, setCanScrollNext] = reactExports$1.useState(false);
  const syncControls = reactExports$1.useCallback(() => {
    setCanScrollPrev(emblaApi?.canScrollPrev() ?? false);
    setCanScrollNext(emblaApi?.canScrollNext() ?? false);
  }, [emblaApi]);
  reactExports$1.useEffect(() => {
    if (!emblaApi) return;
    syncControls();
    emblaApi.on("select", syncControls);
    emblaApi.on("reInit", syncControls);
    return () => {
      emblaApi.off("select", syncControls);
      emblaApi.off("reInit", syncControls);
    };
  }, [emblaApi, syncControls]);
  reactExports$1.useEffect(() => {
    emblaApi?.scrollTo(0, true);
  }, [emblaApi, objectId, shop]);
  if (sectionState === "hidden") return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "similar-games", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "similar-games__title", children: t2("similar_games") }),
    sectionState === "loading" ? /* @__PURE__ */ jsxRuntimeExports.jsx(SimilarGamesSkeleton$1, {}) : null,
    sectionState === "empty" ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__empty", role: "status", children: t2("no_similar_games") }) : null,
    sectionState === "ready" ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__carousel", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "similar-games__viewport", ref: emblaRef, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__container", children: games.map((similarGame) => /* @__PURE__ */ jsxRuntimeExports.jsx(
        SimilarGamesSlide,
        {
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            VerticalCoverCard,
            {
              className: "similar-games__card",
              gameTitle: similarGame.title,
              coverImageUrls: [
                similarGame.coverImageUrl,
                similarGame.libraryImageUrl,
                similarGame.iconUrl
              ],
              useClassicsLayout: similarGame.shop === "launchbox",
              showTitleTooltip: false,
              onClick: /* @__PURE__ */ __name(() => navigate(buildGameDetailsPath(similarGame)), "onClick")
            }
          )
        },
        `${similarGame.shop}:${similarGame.objectId}`
      )) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "similar-games__control similar-games__control--previous",
          "aria-label": t2("previous_media"),
          disabled: !canScrollPrev,
          onClick: /* @__PURE__ */ __name(() => emblaApi?.scrollPrev(), "onClick"),
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronLeftIcon, { size: 36 })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "similar-games__control similar-games__control--next",
          "aria-label": t2("next_media"),
          disabled: !canScrollNext,
          onClick: /* @__PURE__ */ __name(() => emblaApi?.scrollNext(), "onClick"),
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronRightIcon, { size: 36 })
        }
      )
    ] }) }) : null
  ] });
}
__name(SimilarGames, "SimilarGames");
async function loadBigPictureFilters() {
  return Promise.allSettled([
    globalThis.window.electron.hydraApi.get(
      "/catalogue/steam/genres",
      { params: { language: "en" }, needsAuth: false }
    ),
    globalThis.window.electron.hydraApi.get(
      "/catalogue/steam/tags",
      { params: { language: "en" }, needsAuth: false }
    )
  ]);
}
ReactDOM$1.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(React.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Provider_default, { store, children: /* @__PURE__ */ jsxRuntimeExports.jsx(App$1, {}) }) })
);
```

Create `bundles/official/test/fixtures/hydra-4.1.6/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hydra Launcher</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self' 'unsafe-inline' * data: local: blob:; media-src 'self' 'unsafe-inline' * data: local: blob:;"
    />
    <script type="module" crossorigin src="./assets/index-Cpo9haoY.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-DUs6fV-8.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
import * as bundle from "../src/index.ts";
```

with:

```ts
import { EXTENSION_FILE, HYDRA_EXTENSION } from "../src/hydra/extension-loader.ts";
import * as bundle from "../src/index.ts";
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
const LOCALES = "out/renderer/assets/locales-excerpt.js"; // in the real release this is part of RENDERER
```

with:

```ts
const LOCALES = "out/renderer/assets/locales-excerpt.js"; // in the real release this is part of RENDERER
const MORE_LIKE_THIS = "out/renderer/assets/more-like-this-excerpt.js"; // likewise
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
    [LOCALES]: fixture("locales-excerpt.js"),
```

with:

```ts
    [LOCALES]: fixture("locales-excerpt.js"),
    [MORE_LIKE_THIS]: fixture("more-like-this-excerpt.js"),
    "out/renderer/index.html": fixture("index.html"),
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
    ["Recently downloaded sort", "applied", false],
    ["(internal patch #4: Hydra locales)", "applied", true],
  ]);
```

with:

```ts
    ["Recently downloaded sort", "applied", false],
    ["More like this ranking", "applied", false],
    ["(internal patch #4: Hydra locales)", "applied", true],
    ["(internal patch #7: Hydra extension loader)", "applied", true],
    ["(internal patch #8: registry: game page)", "applied", true],
    ["(internal patch #9: registry: game data)", "applied", true],
    ["(internal patch #10: registry: library)", "applied", true],
    ["(internal patch #11: registry: Steam tags)", "applied", true],
  ]);
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
  assert.equal(status("Recently added sort").status, "skipped");
```

with:

```ts
  assert.equal(status("Recently added sort").status, "skipped");
  assert.equal(status("More like this ranking").status, "skipped");
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
      "Hydra 4.1.7 (untested): 3/5 patches apply (dry run, nothing installed)",
```

with:

```ts
      "Hydra 4.1.7 (untested): 4/6 patches apply (dry run, nothing installed)",
```

In `bundles/official/test/patches.test.ts`, replace:

```ts
      "  ✗ Recently downloaded sort",
      `      ${miss}`,
    ].join("\n"),
```

with:

```ts
      "  ✗ Recently downloaded sort",
      `      ${miss}`,
      "  ✓ More like this ranking",
    ].join("\n"),
```

Append to `bundles/official/test/patches.test.ts`:

```ts

const REGISTRY = (entries: string) => `Object.assign((globalThis.__revamp ??= { registry: {}, mounts: {} }).registry, { ${entries} });`;

test("the extension loader ships the extension and loads it before Hydra's own module script", () => {
  const out = job();
  assert.equal(out.outputs.get(EXTENSION_FILE)!.toString(), HYDRA_EXTENSION);
  const html = out.outputs.get("out/renderer/index.html")!.toString();
  assert.ok(
    html.includes(
      '    <script type="module" crossorigin src="./assets/revamp-hydra.js"></script>\n' +
        '    <script type="module" crossorigin src="./assets/index-Cpo9haoY.js"></script>',
    ),
  );
});

test("the registry patches name Hydra's internals just before the root render, and More like this mounts the stock section", () => {
  const code = job().outputs.get(MORE_LIKE_THIS)!.toString();
  const registry = [
    REGISTRY(
      "React: reactExports$1, jsxRuntime: jsxRuntimeExports, useNavigate: useNavigate, useTranslation: useTranslation, " +
        "useEmblaCarousel: useEmblaCarousel, VerticalCoverCard: VerticalCoverCard, buildGameDetailsPath: buildGameDetailsPath, " +
        "ChevronLeftIcon: ChevronLeftIcon, ChevronRightIcon: ChevronRightIcon, Skeleton: Skeleton$1",
    ),
    REGISTRY("levelDBService: levelDBService, orderBy: orderBy$1, logger: logger"),
    REGISTRY("useLibrary: useLibrary$1, useAppDispatch: useAppDispatch$1, useAppSelector: useAppSelector$1"),
    REGISTRY("setTags: catalogueSearchSlice.actions.setTags, getLocalizedSteamMetadata: getLocalizedSteamMetadata"),
  ];
  assert.ok(code.includes(`${registry.join("\n")}\nReactDOM$1.createRoot(document.getElementById("root"))`));
  assert.ok(
    code.includes(
      '}\nSimilarGames = globalThis.__revamp?.mount?.("hydra.similarGames", SimilarGames) ?? SimilarGames;\n__name(SimilarGames, "SimilarGames");',
    ),
  );
});

test("a changed stock section skips only More like this, so Hydra keeps its stock section", () => {
  const changed = fixture("more-like-this-excerpt.js").replace("similar-games__control--previous", "similar-games__control--back");
  const out = job(NONE, hydraFiles({ [MORE_LIKE_THIS]: changed }));
  const r = (name: string) => out.results.find((x) => x.name === name)!;
  assert.equal(r("(internal patch #8: registry: game page)").status, "failed");
  assert.match(r("(internal patch #8: registry: game page)").message!, /expected 1 match, found 0/);
  assert.equal(r("More like this ranking").status, "skipped");
  assert.equal(r("Recently added sort").status, "applied");
  assert.equal(out.outputs.get(MORE_LIKE_THIS)!.toString().includes("__revamp?.mount"), false);
});

test("with More like this disabled, the renderer, index.html and the extension file are untouched", () => {
  const out = job({ ...NONE, disable: ["More like this ranking"] });
  for (const file of [MORE_LIKE_THIS, "out/renderer/index.html", EXTENSION_FILE]) assert.equal(out.outputs.has(file), false, file);
});

test("a captured name that isn't declared at the top level fails its registry patch instead of breaking Hydra's startup", () => {
  // Registry lines run while Hydra's module loads: a name out of scope there would throw and blank the whole UI.
  const changed = fixture("more-like-this-excerpt.js").replace("const logger = log$2.scope(\"renderer\");\n", "");
  const out = job(NONE, hydraFiles({ [MORE_LIKE_THIS]: changed }));
  const data = out.results.find((x) => x.name === "(internal patch #9: registry: game data)")!;
  assert.equal(data.status, "failed");
  assert.match(data.message!, /resolve\(\): logger .* has no top-level declaration/);
  assert.equal(out.results.find((x) => x.name === "More like this ranking")!.status, "skipped");
  assert.equal(out.outputs.get(MORE_LIKE_THIS)!.toString().includes("logger: logger"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test bundles/official/test/patches.test.ts`
Expected: FAIL with `Cannot find module '…/src/hydra/extension-loader.ts'`.

- [ ] **Step 3: Implement**

Create `bundles/official/src/hydra/extension-loader.ts`:

```ts
import { definePatch } from "@revamp/sdk";
import { useBundledUi } from "./bundled-ui.ts";

// scripts/build.ts replaces this name with the compiled extension (src/hydra/extension). Unit tests import the
// source directly, where it is undefined and a placeholder stands in.
declare const __REVAMP_HYDRA_EXTENSION__: string | undefined;

export const HYDRA_EXTENSION =
  typeof __REVAMP_HYDRA_EXTENSION__ === "string" ? __REVAMP_HYDRA_EXTENSION__ : "/* Revamp Hydra extension (not built) */\n";
export const EXTENSION_FILE = "out/renderer/assets/revamp-hydra.js";
const SCRIPT = '<script type="module" crossorigin src="./assets/revamp-hydra.js"></script>';

/**
 * Internal "Hydra extension loader": ships the extension next to the renderer and loads it before Hydra's own
 * module script. Module scripts run in document order, so mount() exists before Hydra's code calls it.
 */
export const hydraExtensionLoader = definePatch({
  description: "Hydra extension loader",
  dependsOn: [useBundledUi], // Hydra loads the bundled index.html only with this patch
  execute(ctx) {
    ctx.addFile(EXTENSION_FILE, HYDRA_EXTENSION);
    const html = ctx.file("out/renderer/index.html");
    const appScript = html.text.indexOf('<script type="module"');
    if (appScript === -1) throw new Error("out/renderer/index.html has no module script to load the extension before");
    const indent = /[ \t]*$/.exec(html.text.slice(0, appScript))![0];
    html.setText(`${html.text.slice(0, appScript)}${SCRIPT}\n${indent}${html.text.slice(appScript)}`);
  },
});
```

Create `bundles/official/src/hydra/registry.ts`:

```ts
import { definePatch, fingerprint, type Capture, type PatchContext } from "@revamp/sdk";

/**
 * Hydra's root render call, the last statement of the renderer module. Registry entries are assigned just before
 * it: every top-level binding is initialized there, and nothing has rendered yet.
 */
export const rootRender = fingerprint({
  name: "renderer root render",
  strings: ['createRoot(document.getElementById("root"))'],
  pattern: '$DOM.createRoot(document.getElementById("root")).render($$$);',
});

/** A top-level name, or a property path on one (for names that are only destructured). */
type Entry = Capture | { of: Capture; path: string };

/** Adds app internals to globalThis.__revamp.registry. Each must start from a top-level binding of the same file. */
function register(ctx: PatchContext, entries: Record<string, Entry>) {
  const render = ctx.match(rootRender);
  const values: string[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    const binding = "of" in entry ? entry.of : entry;
    if (binding.file !== render.file) throw new Error(`registry entry ${name} is in ${binding.file}, not in ${render.file}`);
    binding.resolve(); // throws unless the name is declared at the top level, so it is in scope at the root render
    values.push(`${name}: ${"of" in entry ? `${entry.of}.${entry.path}` : entry}`);
  }
  render.insertBefore(`Object.assign((globalThis.__revamp ??= { registry: {}, mounts: {} }).registry, { ${values.join(", ")} });`);
}

/** Stock "More like this" on the game page: everything it renders with is captured from it. */
export const similarGamesComponent = fingerprint({
  name: "stock SimilarGames component",
  strings: ['"similar-games__card"', '"game_details"'],
  pattern: 'function $SIMILAR_GAMES({ objectId, shop }) { const $NAVIGATE = $USE_NAVIGATE(); const { t: $T } = $USE_TRANSLATION("game_details"); $$$ }',
});

export const similarGamesSkeleton = fingerprint({
  name: "stock SimilarGames skeleton",
  strings: ['"similar-games__skeleton"'],
  pattern: '$JSX.jsx($SKELETON, { className: "similar-games__skeleton" })',
});

/** Internal "registry: game page": React, the JSX runtime and the UI the stock section is built from. */
export const registerGamePage = definePatch({
  description: "registry: game page",
  execute(ctx) {
    const section = ctx.match(similarGamesComponent);
    const card = section.find('$JSX.jsx($CARD, { className: "similar-games__card" })');
    const control = (side: string) =>
      section.find(`({ className: "similar-games__control similar-games__control--${side}", children: $JSX.jsx($ICON, { size: 36 }) })`).$ICON;
    register(ctx, {
      React: section.find("$REACT.useCallback($$$)").$REACT,
      jsxRuntime: card.$JSX,
      useNavigate: section.$USE_NAVIGATE,
      useTranslation: section.$USE_TRANSLATION,
      useEmblaCarousel: section.find('$EMBLA({ align: "start" })').$EMBLA,
      VerticalCoverCard: card.$CARD,
      buildGameDetailsPath: section.find(`${section.$NAVIGATE}($PATH($GAME))`).$PATH,
      ChevronLeftIcon: control("previous"),
      ChevronRightIcon: control("next"),
      Skeleton: ctx.match(similarGamesSkeleton).$SKELETON,
    });
  },
});

/** The stock hook's download-source lookup and its error log. */
export const similarGamesSources = fingerprint({
  name: "stock similar games download sources",
  strings: ['"downloadSources"', '"createdAt"', '"Failed to fetch similar games"'],
  pattern: 'async () => { const $SOURCES = await $DB.values("downloadSources"); $$$; const $IDS = $ORDER_BY($SOURCES, "createdAt", "desc").map($$$); $$$ }',
});

export const similarGamesErrorLog = fingerprint({
  name: "stock similar games error log",
  strings: ['"Failed to fetch similar games"'],
  pattern: '$LOGGER.error("Failed to fetch similar games", $ERROR)',
});

/** Internal "registry: game data": LevelDB, lodash's orderBy and the renderer logger. */
export const registerGameData = definePatch({
  description: "registry: game data",
  execute(ctx) {
    const sources = ctx.match(similarGamesSources);
    register(ctx, { levelDBService: sources.$DB, orderBy: sources.$ORDER_BY, logger: ctx.match(similarGamesErrorLog).$LOGGER });
  },
});

/** Hydra's useLibrary(), which also names its redux hooks. */
export const libraryHook = fingerprint({
  name: "useLibrary hook",
  strings: ["state.library.downloadLibrary"],
  pattern: "function $USE_LIBRARY() { const $DISPATCH = $USE_APP_DISPATCH(); const $LIBRARY = $USE_APP_SELECTOR(($STATE) => $STATE.library.value); $$$ }",
});

/** Internal "registry: library": the library and Hydra's typed redux hooks. */
export const registerLibrary = definePatch({
  description: "registry: library",
  execute(ctx) {
    const hook = ctx.match(libraryHook);
    register(ctx, { useLibrary: hook.$USE_LIBRARY, useAppDispatch: hook.$USE_APP_DISPATCH, useAppSelector: hook.$USE_APP_SELECTOR });
  },
});

export const setTagsAction = fingerprint({
  name: "catalogue setTags action",
  strings: ["steamUserTags"],
  pattern: "const { setTags: $SET_TAGS } = $SLICE.actions",
});

/** The catalogue's tag and genre lookup (Big Picture fetches the same paths directly, in the other order). */
export const steamFiltersRequest = fingerprint({
  name: "Steam tags and genres request",
  strings: ['"/catalogue/steam/tags"', '"/catalogue/steam/genres"'],
  pattern: 'Promise.all([$GET_METADATA("/catalogue/steam/tags", $$$), $GET_METADATA("/catalogue/steam/genres", $$$)])',
});

/** Internal "registry: Steam tags": the catalogue's setTags action and its localized metadata loader. */
export const registerSteamTags = definePatch({
  description: "registry: Steam tags",
  execute(ctx) {
    register(ctx, {
      setTags: { of: ctx.match(setTagsAction).$SLICE, path: "actions.setTags" },
      getLocalizedSteamMetadata: ctx.match(steamFiltersRequest).$GET_METADATA,
    });
  },
});
```

Create `bundles/official/src/hydra/more-like-this.ts`:

```ts
import { definePatch } from "@revamp/sdk";
import { hydra } from "../apps.ts";
import { useBundledUi } from "./bundled-ui.ts";
import { hydraExtensionLoader } from "./extension-loader.ts";
import { registerGameData, registerGamePage, registerLibrary, registerSteamTags, similarGamesComponent } from "./registry.ts";

export const moreLikeThisRanking = definePatch({
  name: "More like this ranking",
  description:
    "Ranks 'More like this' on a game's page by shared Steam tags, shows the shared tags and an 'Already in library' badge, and remembers results for the session. Shows the stock section if it fails.",
  compatibleWith: [{ app: hydra, versions: ["4.1.6"] }],
  dependsOn: [useBundledUi, hydraExtensionLoader, registerGamePage, registerGameData, registerLibrary, registerSteamTags],
  execute(ctx) {
    // The binding is read when the game page renders, after the extension's mount() wrapped it.
    const section = ctx.match(similarGamesComponent);
    const name = `${section.$SIMILAR_GAMES}`;
    section.insertAfter(`${name} = globalThis.__revamp?.mount?.("hydra.similarGames", ${name}) ?? ${name};`);
  },
});
```

In `bundles/official/src/index.ts`, replace:

```ts
import { useBundledUi } from "./hydra/bundled-ui.ts";
```

with:

```ts
import { useBundledUi } from "./hydra/bundled-ui.ts";
import { moreLikeThisRanking } from "./hydra/more-like-this.ts";
```

In `bundles/official/src/index.ts`, replace:

```ts
  version: "0.2.0",
```

with:

```ts
  version: "0.3.0",
```

In `bundles/official/src/index.ts`, replace:

```ts
export const patches = [disableSelfUpdate, sideBySideIdentity, useBundledUi, recentlyAddedSort, recentlyDownloadedSort, hideDealsLink];
```

with:

```ts
export const patches = [
  disableSelfUpdate,
  sideBySideIdentity,
  useBundledUi,
  recentlyAddedSort,
  recentlyDownloadedSort,
  moreLikeThisRanking,
  hideDealsLink,
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test bundles/official/test/patches.test.ts && npm test && npm run typecheck && npm run build -w @revamp/bundle-official`
Expected: PASS. 22 Hydra bundle tests; `npm test` reports 196 tests, 0 failures; both `tsc` runs print nothing; the build prints `dist/official.mjs written (Hydra extension: 22.0 kB)`.

- [ ] **Step 5: Commit**

```bash
git add bundles/official/src/hydra/extension-loader.ts bundles/official/src/hydra/registry.ts bundles/official/src/hydra/more-like-this.ts bundles/official/src/index.ts bundles/official/test/patches.test.ts bundles/official/test/fixtures/hydra-4.1.6/more-like-this-excerpt.js bundles/official/test/fixtures/hydra-4.1.6/index.html
git commit -m "feat(bundle): More like this ranking: extension loader, registry and mount

The loader ships the Hydra extension and loads it before Hydra's module.
Four registry patches capture Hydra's internals from the stock code that
uses them, check each is a top-level binding, and register them just
before the root render. The named patch routes the stock section through
mount(), so a failing extension shows the stock section.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Count only named patches in the report header

**Model:** `sonnet` / `medium`

**Files:**
- Modify: `packages/cli/src/format.ts:6-8`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `PatchAppResult.results` (`internal`, `status`).
- Produces: `formatPatchResult`'s header `<App> <version>: <applied>/<n> patches apply` now counts only named patches that ran (not disabled or incompatible). Failed internal patches are still listed below it, unchanged.

**Why:** with M3's five helper patches, a Hydra without the stock section (the real 4.0.6) printed "3/10 patches apply". The four failed registry helpers were counted as patches the user had chosen, while the helpers that applied were not, so the number matched neither view. Spec §5.6 counts user-visible patches: it should read "3/6", with the helper failures still shown as the reason "More like this" was skipped.

- [ ] **Step 1: Write the failing test**

In `packages/cli/test/cli.test.ts`, replace:

```ts
  assert.match(formatPatchResult({ ...r, version: "4.1.7", untested: true }), /^Hydra 4\.1\.7 \(untested\): 1\/2 patches apply/);
```

with:

```ts
  assert.match(formatPatchResult({ ...r, version: "4.1.7", untested: true }), /^Hydra 4\.1\.7 \(untested\): 1\/2 patches apply/);
  const helperFailed = [...r.results, { name: "(internal patch #4: helper)", status: "failed" as const, required: false, internal: true, message: "m" }];
  assert.match(formatPatchResult({ ...r, results: helperFailed }), /^Hydra 4\.1\.6: 1\/2 patches apply[^]*\n  ✗ \(internal patch #4: helper\)\n      m\nNote: W$/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/cli/test/cli.test.ts`
Expected: FAIL. The header reads `Hydra 4.1.6: 1/3 patches apply`.

- [ ] **Step 3: Implement**

In `packages/cli/src/format.ts`, replace:

```ts
  const ran = shown.filter((x) => x.status !== "disabled" && x.status !== "incompatible");
```

with:

```ts
  // The count is of the patches users choose; a failed internal patch is listed, but as the reason others were skipped.
  const ran = shown.filter((x) => !x.internal && x.status !== "disabled" && x.status !== "incompatible");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test packages/cli/test/cli.test.ts && npm test && npm run typecheck`
Expected: PASS. 5 CLI tests; `npm test` reports 196 tests, 0 failures; both `tsc` runs print nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/format.ts packages/cli/test/cli.test.ts
git commit -m "fix(cli): count only named patches in the report header

Failed internal helper patches are still listed, as the reason a patch
was skipped, but no longer counted: forced Hydra 4.0.6 now reports 3/6
instead of 3/10.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Real-release checks, CLAUDE.md and the owner's acceptance

**Model:** `sonnet` / `medium` (the final whole-branch review afterwards is `opus` / `high`)

**Files:**
- Modify: `test/integration/hydra.test.ts`, `test/integration/hydra-mismatch.test.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above; `npm run test:integration` builds the bundle (now including the extension) and patches the cached real releases into temp homes.
- Produces:
  - **Hydra 4.1.6:** "More like this ranking" and the five helpers apply. The asar holds `revamp-hydra.js` with the `hydra.similarGames` mount, and `index.html` loads it first. The renderer gets exactly four registry lines right before the root render and one mount line.
  - **Hydra 4.0.6 forced:** "More like this ranking" is skipped, because 4.0.6 has no stock section, and the report reads `3/6 patches apply`.

- [ ] **Step 1: Extend the integration tests**

In `test/integration/hydra.test.ts`, replace:

```ts
        ["Recently downloaded sort", "applied"],
      ],
    );
    assert.deepEqual(r.results.filter((x) => x.internal).map((x) => [x.name, x.status]), [["(internal patch #4: Hydra locales)", "applied"]]);
```

with:

```ts
        ["Recently downloaded sort", "applied"],
        ["More like this ranking", "applied"],
      ],
    );
    assert.deepEqual(
      r.results.filter((x) => x.internal).map((x) => [x.name, x.status]),
      [
        ["(internal patch #4: Hydra locales)", "applied"],
        ["(internal patch #7: Hydra extension loader)", "applied"],
        ["(internal patch #8: registry: game page)", "applied"],
        ["(internal patch #9: registry: game data)", "applied"],
        ["(internal patch #10: registry: library)", "applied"],
        ["(internal patch #11: registry: Steam tags)", "applied"],
      ],
    );
```

In `test/integration/hydra.test.ts`, replace:

```ts
      assert.equal(patched[0].split(strings).length, 2, strings);
    }
```

with:

```ts
      assert.equal(patched[0].split(strings).length, 2, strings);
    }

    // More like this: the extension ships next to the renderer and loads first; the renderer registers its
    // internals once, just before the root render, and routes the stock section through mount().
    assert.ok(extractFile(asar, "out/renderer/assets/revamp-hydra.js").toString().includes('mounts["hydra.similarGames"]'));
    const html = extractFile(asar, "out/renderer/index.html").toString();
    assert.ok(html.indexOf("./assets/revamp-hydra.js") < html.indexOf('<script type="module" crossorigin src="./assets/index-'));
    assert.equal(patched[0].split("Object.assign((globalThis.__revamp ??= { registry: {}, mounts: {} }).registry, {").length, 5);
    assert.ok(/registry, \{ [^\n]* \}\);\nReactDOM\$1\.createRoot\(document\.getElementById\("root"\)\)/.test(patched[0]));
    assert.equal(patched[0].split('SimilarGames = globalThis.__revamp?.mount?.("hydra.similarGames", SimilarGames) ?? SimilarGames;').length, 2);
```

In `test/integration/hydra-mismatch.test.ts`, replace:

```ts
    assert.match(report, /^Hydra 4\.0\.6 \(untested\): 3\/5 patches apply \(dry run, nothing installed\)$/m);
```

with:

```ts
    assert.match(report, /^Hydra 4\.0\.6 \(untested\): 3\/6 patches apply \(dry run, nothing installed\)$/m);
```

In `test/integration/hydra-mismatch.test.ts`, replace:

```ts
      "Recently downloaded sort": "failed",
    });
```

with:

```ts
      "Recently downloaded sort": "failed",
      "More like this ranking": "skipped", // 4.0.6 has no stock "More like this" section to mount over
    });
```

- [ ] **Step 2: Run the integration tests**

Run: `npm run test:integration`
Expected: 3 tests pass with the cached releases in about a minute: Heroic about 12 s, Hydra 4.0.6 forced about 19 s (`Hydra 4.0.6 (untested): 3/6 patches apply`), Hydra 4.1.6 about 21 s.

- [ ] **Step 3: Document the extension architecture in CLAUDE.md**

In `CLAUDE.md`, replace:

```markdown
npm run build -w @revamp/bundle-official    # esbuild → bundles/official/dist/official.mjs
```

with:

```markdown
npm run build -w @revamp/bundle-official    # scripts/build.ts: the extensions, then bundles/official/dist/official.mjs
```

In `CLAUDE.md`, replace:

```markdown
**Bundle format.** One self-contained ESM file with no imports and no top-level `await`. The runner loads it with `require(esm)`, because `import()` from disk fails inside a Node SEA.
```

with:

```markdown
**Bundle format.** One self-contained ESM file with no imports and no top-level `await`. The runner loads it with `require(esm)`, because `import()` from disk fails inside a Node SEA.

**Extensions (spec §6, M3).** New UI ships as an extension: `bundles/official/src/hydra/extension/` (TSX, its own tsconfig; never imported by Node tests, which can't strip JSX).
- `scripts/build.ts` compiles it with esbuild into a string and embeds it in the bundle through `define` (`__REVAMP_HYDRA_EXTENSION__`). Unit tests import bundle sources directly and get a placeholder.
- The internal "Hydra extension loader" patch adds it as `out/renderer/assets/revamp-hydra.js`, loaded before Hydra's module script.
- Registry patches (`src/hydra/registry.ts`) capture Hydra internals from the stock code that uses them. Each name is `resolve()`-checked as top-level, and they are assigned to `globalThis.__revamp.registry` just before the root render call.
- Extension code reaches them only at call time through `@revamp/sdk/shims/*` and the extension's `app.ts`, because the extension loads before Hydra's module runs.
- A feature patch routes a stock component through `mount()`: the extension's replacement renders inside an error boundary that falls back to the stock component.
- `bundles/official/test/extension.test.ts` builds the extension and renders it with real React 18.3.1 (Hydra's version) through `react-test-renderer`.
```

- [ ] **Step 4: Manual acceptance (the owner; spec §13 M3)**

Quit Hydra, then run `npm run revamp -- patch hydra` and open Revamped Hydra from the menu. Then check:
1. **Ranking.** Open a Steam game's page, for example one you know well. "More like this" should show up to 12 games. Compare the order with the fork build for the same game.
2. **Captions and badge.** Cards show up to two shared tag names under them. Games you own say "Already in library" and come last.
3. **Session cache.** Go to another game and back: the section appears at once, with no loading skeleton.
4. **Language.** With Hydra set to Български, the captions use Bulgarian tag names wherever Steam provides them.
5. **Off switch.** Run `npm run revamp -- patch hydra --disable "More like this ranking"`. The stock section returns, exactly like stock Hydra. Run `npm run revamp -- patch hydra --enable "More like this ranking"` to turn it back on.

If a game page shows the stock section (no captions or badges) while the patch is on, the extension fell back on purpose. That is the safety net the unit tests check, and Hydra's console logs `Revamp: "hydra.similarGames" failed` with the reason. Report it so the missing piece can be found.

- [ ] **Step 5: Commit**

```bash
git add test/integration/hydra.test.ts test/integration/hydra-mismatch.test.ts CLAUDE.md
git commit -m "test: real Hydra checks for More like this; docs: extension architecture in CLAUDE.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
