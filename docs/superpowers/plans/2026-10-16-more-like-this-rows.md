# "More like this" Rows and New-Patch Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two Hydra patches, "More like this (Steam)" and "More like this (Revamped)", that turn the game page's "More like this" into the fork's three rows with Settings checkboxes. Also make Revamp ask before a re-patch turns on new patches, in the CLI and the window. Finish with bundle release 0.4.0.

**In plain words:**
- **Hydra side.** A small piece of code inside Hydra's background process fetches Steam's own "More like this" list and a game's Steam tags, which the page itself isn't allowed to fetch. The extension shows up to three rows, Steam, Revamped and Original, each with its own checkbox under Settings → Content & gameplay. With neither patch chosen, Hydra stays exactly stock.
- **Revamp side.** When you re-patch an installed app and the bundle has new patches that are on by default, Revamp lists them and asks first:
  - in the terminal, "Turn them on? [y/N]";
  - in the window, a banner, with the Re-patch button waiting for the answer.
- The "Update all" button goes away.

**Architecture:**
- **Bundle (`bundles/official`):**
  - **Steam bridge.** A new main-process module, `src/hydra/steam-bridge/main.ts`, compiled by esbuild into one script string, like the extension. It is inserted after Hydra's `registerEvent` declaration and exposed through the preload.
  - **Feature patches.** Each of the two feature patches writes a marker into `globalThis.__revamp.registry`. Three internal patches do the shared work:
    - "Similar games rows": mounts the stock section;
    - "Similar games settings": a settings slot;
    - "registry: settings": registers `CheckboxField`.
  - **Extension.** It catches up with fork commit `561b4721` and adds the rows container and settings component.
- **Engine:** `newPatchesToAsk` (the rule) and a `confirmNewPatches` callback on `patchApp` / `updateApp`.
- **CLI:** the callback's terminal policy and `--yes`.
- **`serve`:** `patches.list` returns `ask`, and `job.update` goes.
- **Window:** a banner on the app screen; "Update all" removed.

**Tech Stack:** Node 26.12 (type stripping), TypeScript 7, esbuild (already a dev dependency), React 18.3.1 + `react-test-renderer` (extension tests), Vite/React window, node:test.

**Spec:** `docs/superpowers/specs/2026-10-16-more-like-this-rows-design.md` (this feature, approved 2026-10-16), which amends `docs/superpowers/specs/2026-10-14-revamp-v1-design.md` §6, §7.3, §8, §9 and §10. Read both.

**Reference implementation:** the Hydra fork, `/home/borislav/github/hydra`, read-only.
- Revamp's extension today equals the fork at `3f098e9f`.
- Port the fork's changes from `3f098e9f` to `561b4721`: `git -C /home/borislav/github/hydra diff 3f098e9f 561b4721 -- <path>` shows each one.
- `git -C /home/borislav/github/hydra show 561b4721:<path>` shows a whole file.

**Checked before hand-off (2026-10-16), against the real Hydra 4.1.6 files** (extracted from `~/.cache/revamp/releases/hydra/4.1.6/hydralauncher_4.1.6_amd64.deb`):
- **Anchors.** The fingerprints in Tasks 1 and 4 (`ipcRegistration`, `mainLogger`, `preloadApi`, `settingsLastCheckbox`) each match once. The edits written below re-parse.
- **Captured names:**
  - `registerEvent`, `logger` (declared before it, same file `out/main/index.js`)
  - `ipcRenderer` (`out/preload/index.mjs`)
  - `CheckboxField` (top level, before the root render, in the renderer file)
- **Steam fetches.** Plain Node `fetch` reads Steam's morelike page (18 ids for Balatro) and `IStoreBrowseService/GetItems/v1` (names, `tagids`, `asset_url_format`).
- **Not run end to end.** The code below hasn't been run as a whole, so expect normal TDD iteration.

## Global Constraints

- **Run everything from the worktree** `/home/borislav/github/revamp/.worktrees/more-like-this-rows` (branch `more-like-this-rows`; `node_modules` is already copied in). Every command needs `export PATH="$HOME/.cargo/bin:$HOME/.local/node-26/bin:$PATH"` first.
- **TypeScript:** erasable syntax only (no `enum`, `namespace`, parameter properties). Use `import type`, and put `.ts` on relative imports.
- **Dependencies:** no new runtime dependencies. Engine runtime deps stay `acorn` and `xz-decompress`.
- **Unit tests:** never touch the network or the real home. Use stub `fetch`, temp dirs, and local servers on port 0.
- **Node tests and the extension:** Node tests may import the extension's plain `.ts` files, never a `.tsx` file or anything that imports one.
- **App code:** never eval it. Port 3000, `/opt/Hydra` and `/opt/Heroic` are off limits.
- **Patch names (exact):** `More like this (Steam)`, `More like this (Revamped)`. "More like this ranking" is removed, with no migration.
- **Preference keys (exact):** `showSimilarGamesSteam`, `showSimilarGamesRevamped`, `showSimilarGamesOriginal`. A missing key means on.
- **Row order:** Steam, Revamped, Original. Launchbox games get only Original. Big Picture is untouched.
- **IPC channels:** `revamp:getSteamAppTags`, `revamp:getSteamRecommendations`. **Preload names:** `revampGetSteamAppTags`, `revampGetSteamRecommendations`.
- **Bundle version** `0.4.0`. `minEngine` stays `0.2.0`.
- **Commits:** conventional (`feat:`, `fix:`, `test:`, `docs:`), each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Bundle text on screen:** CLI output goes through `printable()`, and window text through `plain()`.

## Review Focus

1. **A Steam game whose Steam page lists no recommendations, or that Steam doesn't know.** The Steam row shows the stock "No similar games found" empty state, never an error or a blank gap. Pinned in Task 1 (empty grid → `[]`) and Task 3 (empty Steam result → the empty-state text).
2. **A preference saved as `false` by hand, or a key missing after Hydra upgrades its stored preferences.** Only an explicit `false` hides a row; `undefined`, `null` and non-booleans show it. Pinned in Task 3 (`shownRows`).
3. **`revamp update` run by a script or a timer-like context with no terminal.** It must never hang or turn patches on. The new patches stay off and nothing is saved. Pinned in Task 6 (`interactive: false`).
4. **The user ticks a new patch by hand in the window instead of answering the banner.** The answer is still required before Re-patch: the banner stays until Turn on or Keep off, and the manual tick is kept by Keep off. Pinned in Task 7 (`answerNewPatches`).
5. **A forced or newer version in the window's picker, with new patches only for that version.** The banner lists only the patches the picked version offers. Pinned in Task 5: the "doesn't fit `version`" case of `newPatchesToAsk`. `patches.list` passes the listing's version straight to it.

---

## File map

**Bundle (`bundles/official/`)**

| File | Change | Responsibility |
|---|---|---|
| `src/hydra/steam-bridge/main.ts` | create | Code that runs in Hydra's main process: Steam fetches, parser, `registerSteamBridge` |
| `src/hydra/steam-bridge.ts` | create | Internal patch "Steam bridge", its three fingerprints, the `STEAM_BRIDGE` string |
| `scripts/extension.ts` | modify | `buildSteamBridge(entry)` beside `buildExtension` |
| `scripts/build.ts` | modify | defines `__REVAMP_HYDRA_STEAM_BRIDGE__` |
| `src/hydra/extension/hooks/{similar-games,use-similar-games,use-similar-game-views}.ts` | modify | Fork `561b4721` three sources |
| `src/hydra/extension/strings.ts` | create | Row titles and checkbox labels, en/bg/pt-BR |
| `src/hydra/extension/rows.ts` | create | Markers, preference keys, `patchedRows`, `shownRows` |
| `src/hydra/extension/pages/game-details/similar-games/similar-games.tsx` | modify | `source` prop, title from `strings.ts` |
| `src/hydra/extension/pages/game-details/similar-games/similar-games-rows.tsx` | create | Mounted at `hydra.similarGames`: the rows |
| `src/hydra/extension/pages/settings/similar-games-settings.tsx` | create | Mounted at `hydra.similarGamesSettings`: the checkboxes |
| `src/hydra/extension/{app.ts,env.d.ts,index.tsx}` | modify | `CheckboxField`, `userPreferences` state, window types, the two mounts |
| `src/hydra/registry.ts` | modify | `settingsLastCheckbox` fingerprint, internal "registry: settings" |
| `src/hydra/more-like-this.ts` | rewrite | The two feature patches + internal "Similar games rows" and "Similar games settings" |
| `src/index.ts`, `CHANGELOG.md` | modify | Patch list, version 0.4.0, changelog |
| `test/steam-bridge.test.ts`, `test/similar-games-rows.test.ts` | create | Bridge and rows unit tests |
| `test/{similar-games,extension,patches}.test.ts` | modify | Port and new cases |
| `test/fixtures/hydra-4.1.6/{main-excerpt.js,more-like-this-excerpt.js}`, `preload-excerpt.mjs` | modify / create | Excerpts of the real files |

**Engine, CLI, window**

| File | Change | Responsibility |
|---|---|---|
| `packages/engine/src/api.ts` | modify | `newPatchesToAsk`, `installedPatchNames`, `confirmNewPatches` in `patchApp` |
| `packages/engine/src/updates.ts`, `src/index.ts` | modify | Pass the callback through `updateApp`; exports |
| `packages/engine/test/new-patches.test.ts` | create | Rule and `patchApp` behavior |
| `packages/cli/src/new-patches.ts` | create | `newPatchesPrompt`: the terminal policy |
| `packages/cli/src/main.ts`, `src/serve.ts` | modify | `--yes`, wiring, `patches.list` `ask`, no `job.update` |
| `packages/cli/test/new-patches.test.ts`, `test/serve.test.ts` | create / modify | |
| `packages/gui/src/{model.ts,AppDetail.tsx,App.tsx,JobView.tsx}` | modify | Banner, unticked start, disabled button, no "Update all" |
| `packages/gui/test/model.test.ts` | modify | |
| `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`, `test/integration/hydra.test.ts` | modify | Spec amendments; real-release checks |

---

### Task 1: Steam bridge (Hydra main process + preload)

**Files:**
- Create: `bundles/official/src/hydra/steam-bridge/main.ts`, `bundles/official/src/hydra/steam-bridge.ts`, `bundles/official/test/steam-bridge.test.ts`, `bundles/official/test/fixtures/hydra-4.1.6/preload-excerpt.mjs`
- Modify: `bundles/official/scripts/extension.ts`, `bundles/official/scripts/build.ts`, `bundles/official/test/fixtures/hydra-4.1.6/main-excerpt.js`, `bundles/official/test/patches.test.ts`

**Interfaces:**
- Produces, `steam-bridge/main.ts`:
  ```ts
  export interface SteamRecommendation { objectId: string; title: string; tagIds: number[]; coverImageUrl: string | null; libraryImageUrl: string | null }
  export interface SteamStoreItem { /* fork's, verbatim */ }
  export interface BridgeLogger { error(message: string, details: { message?: string }): void }
  export const CHANNELS = { tags: "revamp:getSteamAppTags", recommendations: "revamp:getSteamRecommendations" } as const;
  export function parseMoreLikeAppIds(html: string, objectId: string): string[];             // fork, verbatim
  export function toSteamRecommendations(appIds: string[], items: SteamStoreItem[]): SteamRecommendation[]; // fork, verbatim
  export function getSteamAppTags(objectId: string, fetchImpl: typeof fetch, logger: BridgeLogger): Promise<number[]>;
  export function getSteamRecommendations(objectId: string, fetchImpl: typeof fetch, logger: BridgeLogger): Promise<SteamRecommendation[]>;
  export function registerSteamBridge(registerEvent: (name: string, listener: (event: unknown, objectId: unknown) => unknown) => void, logger: BridgeLogger, fetchImpl?: typeof fetch): void;
  ```
- Produces, `steam-bridge.ts`: `export const STEAM_BRIDGE: string`, `export const steamBridge` (internal patch, description `"Steam bridge"`), fingerprints `ipcRegistration`, `mainLogger`, `preloadApi`.
- Produces, `scripts/extension.ts`: `export async function buildSteamBridge(entry: string): Promise<string>`.

- [ ] **Step 1: Fixtures**

Append to `main-excerpt.js`, after the existing text. These are verbatim excerpts of the real file, trimmed: the logger is line 140 and `registerEvent` is lines 4107–4114.
```js
const logger = log.scope("main");
const registerEvent = (name, listener)=>{
    ipcMain.handle(name, async (event, ...args)=>{
        return Promise.resolve(listener(event, ...args)).then((result)=>{
            if (!result) return result;
            return JSON.parse(JSON.stringify(result));
        });
    });
};
registerEvent("getGameStats", getGameStats);
```
Create `preload-excerpt.mjs` with a one-line header comment like the other fixtures, then:
```js
import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electron", {
  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences) => ipcRenderer.invoke("updateUserPreferences", preferences),
  autoLaunch: (autoLaunchProps) => ipcRenderer.invoke("autoLaunch", autoLaunchProps)
});
```
In `patches.test.ts` `hydraFiles()`, add `"out/preload/index.mjs": fixture("preload-excerpt.mjs")`.

- [ ] **Step 2: Write the failing tests** in `test/steam-bridge.test.ts`

1. **Port the fork's tests.** Port `git -C /home/borislav/github/hydra show 561b4721:src/main/services/steam-recommendations.test.ts` verbatim, except that its imports come from `../src/hydra/steam-bridge/main.ts`.
2. **Then add these** (use a stub `fetch` that records URLs and answers by URL; the logger records calls):
   - **"getSteamRecommendations reads Steam's grid, then names and art, in Steam's order".**
     - Stub morelike HTML: `'<div id="recommendation_area_ctn"><a data-ds-appid="3"></a><a data-ds-appid="100"></a><a data-ds-appid="2"></a></div><div class="morelike_section_divider"></div><a data-ds-appid="9"></a>'`.
     - Stub GetItems: items for 2 and 3, each `{ appid, success: 1, type: 0, name, tagids: [1, 2], assets: { asset_url_format: "steam/apps/<id>/${FILENAME}", library_capsule_2x: "c2x.jpg", header: "h.jpg" } }`.
     - Assert the result is `[{ objectId: "3", title: "Three", tagIds: [1, 2], coverImageUrl: "https://shared.steamstatic.com/store_item_assets/steam/apps/3/c2x.jpg", libraryImageUrl: "https://shared.steamstatic.com/store_item_assets/steam/apps/3/h.jpg" }, { objectId: "2", … }]`.
     - The first URL is exactly `https://store.steampowered.com/recommended/morelike/app/100/`.
     - The second starts with `https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=`, and its decoded `input_json` deep-equals `{ ids: [{ appid: 3 }, { appid: 2 }], context: { language: "english", country_code: "US" }, data_request: { include_tag_count: 20, include_assets: true } }`.
   - **"an empty Steam grid is an empty list and asks Steam nothing more".** HTML without `data-ds-appid` gives `[]`, and only 1 fetch happens.
   - **"getSteamAppTags returns the game's tag IDs in vote order".** `data_request` deep-equals `{ include_tag_count: 20 }`, and `tagids: [5, "x", 7]` gives `[5, 7]`.
   - **"a game ID that isn't all digits never reaches a request".** For `["", "abc", "1/../2", "12 3", "７"]`, both functions resolve `[]`, with 0 fetches.
   - **"failures return [] and log the message".**
     - A rejected fetch gives `[]`, and the logger got `("Error on getSteamRecommendations", { message })`.
     - An HTTP 500 response gives `[]`, and the logger was called.
     - Likewise for `getSteamAppTags` with `"Error on getSteamAppTags"`.
   - **"registerSteamBridge registers the two channels and ignores non-string IDs".** The fake `registerEvent` records names: `["revamp:getSteamAppTags", "revamp:getSteamRecommendations"]`. Calling each listener with `(event, 123)` resolves `[]` with 0 fetches.
   - **"the built bridge is one plain script that defines __revampSteamBridge".**
     - `await buildSteamBridge(<entry>)` starts with `var __revampSteamBridge = `.
     - It doesn't match `/^\s*(import|export)\s/m`.
     - It contains `revamp:getSteamRecommendations`.

In `patches.test.ts`, add **"the Steam bridge registers its handlers after registerEvent and exposes them in the preload"**:
- Run `runJob({ ...bundle, patches: [...bundle.patches, probe] }, …)`, where `probe = definePatch({ name: "Probe", compatibleWith: [{ app: hydra, versions: ["4.1.6"] }], dependsOn: [steamBridge], execute() {} })`.
- Main output includes `"return JSON.parse(JSON.stringify(result));\n        });\n    });\n};\n" + STEAM_BRIDGE + "\n__revampSteamBridge.registerSteamBridge(registerEvent, logger);"`.
- Preload output includes `'getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"), revampGetSteamAppTags: (objectId) => ipcRenderer.invoke("revamp:getSteamAppTags", objectId), revampGetSteamRecommendations: (objectId) => ipcRenderer.invoke("revamp:getSteamRecommendations", objectId),'`.

- [ ] **Step 3: Run, expect failure**

Run: `node --test bundles/official/test/steam-bridge.test.ts bundles/official/test/patches.test.ts`
Expected: FAIL. `steam-bridge/main.ts` and `steam-bridge.ts` don't exist.

- [ ] **Step 4: Implement `steam-bridge/main.ts`**

- **Fetches.** Port the fork's `getSteamAppTags`, `getSteamRecommendations` and `getSteamStoreItems` (fork `src/main/services/steam.ts`), with three changes:
  - `fetchImpl` replaces axios. GetItems is a GET with `?input_json=${encodeURIComponent(JSON.stringify(...))}`.
  - A response that isn't `ok` throws `new Error(\`HTTP ${status}\`)` inside the `try`.
  - Both functions return `[]` before any request unless `/^\d+$/.test(objectId)`.
- **Logging.** Errors log `logger.error("Error on <function name>", { message })` and resolve `[]`.
- **Registration.** `registerSteamBridge` calls `registerEvent(CHANNELS.tags, (_e, id) => getSteamAppTags(typeof id === "string" ? id : "", fetchImpl, logger))`, and the same for recommendations. `fetchImpl` defaults to the global `fetch`. The file must not import anything at runtime: it is compiled into Hydra's main process.

- [ ] **Step 5: Implement the build and the patch**

- **`buildSteamBridge(entry)`** in `scripts/extension.ts`: esbuild `{ entryPoints: [entry], bundle: true, format: "iife", globalName: "__revampSteamBridge", platform: "node", target: "es2022", minify: false, legalComments: "none", write: false }`, returning `outputFiles[0].text`.
- **`scripts/build.ts`:** `const steamBridge = await buildSteamBridge(here("src/hydra/steam-bridge/main.ts"))`, and add `__REVAMP_HYDRA_STEAM_BRIDGE__: JSON.stringify(steamBridge)` to `define`.
- **`steam-bridge.ts`:**
  - **`STEAM_BRIDGE`** follows `extension-loader.ts`'s pattern (`declare const __REVAMP_HYDRA_STEAM_BRIDGE__: string | undefined`). Its placeholder is `"var __revampSteamBridge = { registerSteamBridge() {} }; // Revamp Steam bridge (not built)\n"`.
  - **Fingerprints** (all checked on the real file):
    ```ts
    export const ipcRegistration = fingerprint({
      name: "IPC handler registration",
      strings: ["ipcMain.handle(", "JSON.parse(JSON.stringify("],
      pattern: "const $REGISTER = ($NAME, $LISTENER) => { $IPC.handle($NAME, $$$); }",
    });
    export const mainLogger = fingerprint({
      name: "main logger",
      strings: ['.scope("main")'],
      pattern: 'const $LOGGER = $LOG.scope("main")',
      where: { "in the main process": (m) => m.file.startsWith("out/main/") },
    });
    export const preloadApi = fingerprint({
      name: "preload electron API",
      strings: ['exposeInMainWorld("electron"', '"getUserPreferences"'],
      pattern: '$BRIDGE.exposeInMainWorld("electron", { getUserPreferences: () => $IPC.invoke("getUserPreferences") })',
    });
    ```
  - **`steamBridge = definePatch({ description: "Steam bridge", execute(ctx) {…} })`:**
    - Match `reg` and `logger`. Throw unless they are in the same file and `logger.start < reg.start`, naming both locations.
    - `reg.insertAfter(\`${STEAM_BRIDGE}\n__revampSteamBridge.registerSteamBridge(${reg.$REGISTER}, ${logger.$LOGGER});\`)`. Give it no leading newline: a top-level statement is a "lines" list, so `insertAfter` adds the `\n` itself, and the test's string expects exactly one.
    - Match `api = ctx.match(preloadApi)`, then `api.find(\`getUserPreferences: () => ${api.$IPC}.invoke("getUserPreferences")\`).insertAfter(...)` with the two entries in the test's exact text, joined by `", "`.

- [ ] **Step 6: Run, expect pass**

Run: `node --test bundles/official/test/steam-bridge.test.ts bundles/official/test/patches.test.ts && npm run typecheck`
Expected: PASS. The existing patches tests still pass.

- [ ] **Step 7: Commit**

```bash
git add bundles/official
git commit -m "feat(bundle): Steam bridge in Hydra's main process and preload"
```

---

### Task 2: Extension catches up with fork `561b4721` (three sources)

**Files:**
- Modify: `bundles/official/src/hydra/extension/hooks/similar-games.ts`, `hooks/use-similar-games.ts`, `hooks/use-similar-game-views.ts`, `pages/game-details/similar-games/similar-games.tsx`, `env.d.ts`, `index.tsx`
- Test: `bundles/official/test/similar-games.test.ts`, `bundles/official/test/extension.test.ts`

**Interfaces:**
- Consumes: `SteamRecommendation` (Task 1), via `import type` from `../../steam-bridge/main.ts`.
- Produces, `hooks/similar-games.ts` (the fork's names):
  - `type SimilarGamesSource = "steam" | "revamped" | "original"`
  - `SIMILAR_GAMES_SOURCES`
  - `SimilarGamesQuery { objectId; shop; source }`
  - `isSimilarGamesQueryEligible`
  - `SimilarGamesApi` with `getSteamTags(objectId): Promise<number[]>` and `getSteamRecommendations(objectId): Promise<SteamRecommendation[]>`
- Produces, the component: `SimilarGames({ objectId, shop, source })`.

- [ ] **Step 1: Port the fork's test changes**

Apply `git -C /home/borislav/github/hydra diff 3f098e9f 561b4721 -- src/renderer/src/hooks/similar-games.test.ts` to `bundles/official/test/similar-games.test.ts`, keeping Revamp's import paths. Change the header comment's commit to `561b4721`.

In `extension.test.ts`, the Revamped row no longer asks Hydra for the game's tags, and no longer pads with `/similar`:
- In the stub, remove the `/games/steam/100` and `/similar` answers.
- Add `window.electron.revampGetSteamAppTags = async () => [10, 11, 12, 13, 14, 15]`.
- Set the library to `[{ shop: "steam", objectId: "C" }]`.
- Rename the test to "Revamped ranks by shared Steam tags, captions them, and badges owned games last".
- Assert cards `["Game A", "Game B", "Game D", "Game F", "Game C"]`, captions `Array(5).fill("Roguelike · Deckbuilder")`, and one badge.

- [ ] **Step 2: Run, expect failure**

Run: `node --test bundles/official/test/similar-games.test.ts bundles/official/test/extension.test.ts`
Expected: FAIL. `isSimilarGamesQueryEligible` / `source` are missing, and the cards still include `/similar` results.

- [ ] **Step 3: Port the code**

1. **The fork's diff.** Apply `git -C /home/borislav/github/hydra diff 3f098e9f 561b4721 -- src/renderer/src/hooks/similar-games.ts src/renderer/src/hooks/use-similar-games.ts src/renderer/src/hooks/use-similar-game-views.ts src/renderer/src/pages/game-details/similar-games/similar-games.tsx` to the matching extension files, keeping Revamp's imports from `../app.ts`.
2. **The API calls.** In `use-similar-games.ts`, the API gets:
   - `getSteamTags: (id) => globalThis.window.electron.revampGetSteamAppTags(id)`
   - `getSteamRecommendations: (id) => globalThis.window.electron.revampGetSteamRecommendations(id)`
3. **`env.d.ts`.** `Window.electron` gains:
   - `revampGetSteamAppTags(objectId: string): Promise<number[]>`
   - `revampGetSteamRecommendations(objectId: string): Promise<import("../steam-bridge/main.ts").SteamRecommendation[]>`
   - `updateUserPreferences(values: Record<string, unknown>): Promise<unknown>`, for Task 3
4. **The title.** Keep the component's title as `t(\`similar_games_${source}\`)` for now; Task 3 replaces it.
5. **`index.tsx`, for now.** It renders `<SimilarGames objectId={objectId} shop={shop} source="revamped" />`.

- [ ] **Step 4: Run, expect pass**

Run: `node --test bundles/official/test/similar-games.test.ts bundles/official/test/extension.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bundles/official
git commit -m "feat(bundle): port the fork's Steam, Revamped and Original sources into the Hydra extension"
```

---

### Task 3: Extension rows, settings and strings

**Files:**
- Create: `bundles/official/src/hydra/extension/strings.ts`, `rows.ts`, `pages/game-details/similar-games/similar-games-rows.tsx`, `pages/settings/similar-games-settings.tsx`, `bundles/official/test/similar-games-rows.test.ts`
- Modify: `bundles/official/src/hydra/extension/app.ts`, `index.tsx`, `pages/game-details/similar-games/similar-games.tsx`, `bundles/official/test/extension.test.ts`

**Interfaces:**
- Consumes: `SimilarGamesSource`, `SIMILAR_GAMES_SOURCES` (Task 2).
- Produces, `strings.ts`: `export function similarGamesText(language: string): { title: Record<SimilarGamesSource, string>; show: Record<SimilarGamesSource, string> }`.
- Produces, `rows.ts`:
  ```ts
  export const ROW_MARKERS = { steam: "similarGamesSteam", revamped: "similarGamesRevamped" } as const; // registry keys set by Task 4's feature patches
  export const ROW_PREFERENCES = { steam: "showSimilarGamesSteam", revamped: "showSimilarGamesRevamped", original: "showSimilarGamesOriginal" } as const;
  export function patchedRows(registry: Record<string, unknown>): SimilarGamesSource[]; // [] when no marker is exactly true; else the marked rows + "original", in SIMILAR_GAMES_SOURCES order
  export function shownRows(rows: SimilarGamesSource[], preferences: Record<string, unknown> | null | undefined): SimilarGamesSource[]; // drops a row only when its preference === false
  ```
- Produces, mounts: `mounts["hydra.similarGames"] = SimilarGamesRows` (props `{ objectId, shop, Original }`) and `mounts["hydra.similarGamesSettings"] = SimilarGamesSettings`.

- [ ] **Step 1: Write the failing unit tests** in `test/similar-games-rows.test.ts` (it imports only `strings.ts` and `rows.ts`)

- **"patchedRows reads only the feature patches' markers":**
  - `{}` gives `[]`
  - `{ similarGamesSteam: true }` gives `["steam", "original"]`
  - `{ similarGamesRevamped: true }` gives `["revamped", "original"]`
  - both give `["steam", "revamped", "original"]`
  - `{ similarGamesSteam: "yes" }` gives `[]`
- **"shownRows hides a row only for an explicit false":**
  - `(all, null)` gives all
  - `(all, { showSimilarGamesRevamped: false })` gives `["steam", "original"]`
  - `(all, { showSimilarGamesSteam: 0, showSimilarGamesOriginal: null })` gives all
- **"the strings are the fork's, with English for other languages":**
  - `similarGamesText("en").title` deep-equals `{ steam: "More like this (Steam)", revamped: "More like this (Revamped)", original: "More like this (Original)" }`
  - `similarGamesText("en").show.original === "Show “More like this (Original)” on game pages"`
  - `similarGamesText("bg").title.revamped === "Подобни игри (Обновени)"`
  - `similarGamesText("bg").show.steam === "Показвай „Подобни игри (Steam)“ на страниците на игрите"`
  - `similarGamesText("pt-BR").title.revamped === "Ver similares (Renovado)"`
  - `similarGamesText("pt-BR").show.original === "Mostrar “Ver similares (Original)” nas páginas dos jogos"`
  - `similarGamesText("de")` and `similarGamesText("pt-PT")` deep-equal `similarGamesText("en")`

The full table is the fork's: `git -C /home/borislav/github/hydra show 561b4721 -- src/locales/{en,bg,pt-BR}/translation.json`. Use the keys `similar_games_<source>` for `title` and `show_similar_games_<source>` for `show`.

- [ ] **Step 2: Write the failing render tests** in `extension.test.ts`

Use the existing `hydra()` / `renderSimilarGames()` helpers. Add to the stubs:
- `useAppSelector` reads `state.userPreferences.value`;
- `CheckboxField: element("checkbox")`;
- `window.electron.revampGetSteamRecommendations` returns `[{ objectId: "S1", title: "Steam One", tagIds: [11], coverImageUrl: "s1.jpg", libraryImageUrl: null }]`;
- `hydraApi.get("/catalogue/steam/100/similar")` returns `[game("E")]`;
- `window.electron.updateUserPreferences` records its argument.

The tests:
- **"the extension installs mount() and its stylesheet when it loads, before Hydra exists".** Also assert that `mounts["hydra.similarGamesSettings"]` is a function.
- **"with both markers the rows are Steam, Revamped, Original, titled from the extension's strings".**
  - The `h2` children are `["More like this (Steam)", "More like this (Revamped)", "More like this (Original)"]`.
  - The first row's cards are `["Steam One"]`.
- **"a row switched off in Settings is hidden".** With preferences `{ showSimilarGamesRevamped: false }`, the titles are Steam and Original.
- **"only the Revamped marker: no Steam row".** The titles are Revamped and Original.
- **"without a marker the stock section renders".** One `stock` node, no `h2`.
- **"Launchbox games get only the Original row".** `shop: "launchbox"` gives titles `["More like this (Original)"]`.
- **"Steam knowing no similar games shows the empty state".** Recommendations `[]` give the Steam row's `role="status"` text `no_similar_games`.
- **"the settings list one checkbox per patched row and save only their own key".**
  - Render `revamp().mount("hydra.similarGamesSettings", () => null)` with only `similarGamesSteam: true`.
  - The checkbox labels are `["Show “More like this (Steam)” on game pages", "Show “More like this (Original)” on game pages"]`, both checked.
  - Calling the first one's `onChange()` inside `act` records `{ showSimilarGamesSteam: false }` and re-renders it unchecked.
- **"without a marker the settings render nothing".** No checkbox nodes.
- **"a missing registry entry shows the stock section instead".** This one stays.

- [ ] **Step 3: Run, expect failure**

Run: `node --test bundles/official/test/similar-games-rows.test.ts bundles/official/test/extension.test.ts`
Expected: FAIL (modules and mounts missing).

- [ ] **Step 4: Implement**

- **`strings.ts`:** the table. Look the language up exactly, else use `en`.
- **`rows.ts`:** as in the Interfaces block.
- **`app.ts`:**
  - `HydraState` gains `userPreferences: { value: Record<string, unknown> | null }`.
  - Add `export const CheckboxField = component<{ label: ReactNode; checked: boolean; onChange: () => void }>("CheckboxField")`.
  - Add `export const registryEntries = () => revamp().registry`, using `revamp` from `@revamp/sdk/shims/registry`.
- **`SimilarGamesRows({ objectId, shop, Original })`:**
  - Read the preferences first with `useAppSelector((s) => s.userPreferences.value)`. Hooks come before any early return.
  - `rows = patchedRows(registryEntries())`. If it is empty, render `<Original objectId={objectId} shop={shop} />`.
  - Otherwise render `shownRows(rows, prefs).map((source) => <SimilarGames key={source} … source={source} />)` in a fragment.
- **`SimilarGames` title:** `similarGamesText(i18n.language).title[source]`, with `i18n` from `useTranslation`.
- **`SimilarGamesSettings()`:**
  - `rows = patchedRows(registryEntries())`. Call every hook (selector, state, effect) before returning `null` when it is empty.
  - Local state `checked` starts as `Object.fromEntries(rows.map((r) => [r, prefs?.[ROW_PREFERENCES[r]] !== false]))`, re-synced when `prefs` changes, as Hydra's own form does.
  - Render one `CheckboxField` per row with `label={text.show[row]}`.
  - `onChange` flips the local value and calls `window.electron.updateUserPreferences({ [ROW_PREFERENCES[row]]: next })`. Hydra's main process merges and broadcasts it back into redux.
- **`index.tsx`:** register both mounts.

- [ ] **Step 5: Run, expect pass**

Run: `node --test bundles/official/test/similar-games-rows.test.ts bundles/official/test/extension.test.ts bundles/official/test/similar-games.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bundles/official
git commit -m "feat(bundle): extension rows and Settings checkboxes for More like this"
```

---

### Task 4: The two patches replace "More like this ranking"; bundle 0.4.0

**Files:**
- Rewrite: `bundles/official/src/hydra/more-like-this.ts`
- Modify: `bundles/official/src/hydra/registry.ts`, `bundles/official/src/index.ts`, `bundles/official/CHANGELOG.md`, `bundles/official/test/fixtures/hydra-4.1.6/more-like-this-excerpt.js`, `bundles/official/test/patches.test.ts`

**Interfaces:**
- Consumes:
  - `steamBridge` (Task 1)
  - `rootRender`, `similarGamesComponent`, `registerGamePage`, `registerGameData`, `registerLibrary`, `registerSteamTags` (existing)
  - `useBundledUi`, `hydraExtensionLoader` (existing)
- Produces, `more-like-this.ts`: `moreLikeThisSteam`, `moreLikeThisRevamped` (user-facing), `similarGamesRows`, `similarGamesSettings` (internal).
- Produces, `registry.ts`: `settingsLastCheckbox`, `registerSettings` (internal, description `"registry: settings"`).

- [ ] **Step 1: Fixture**

In `more-like-this-excerpt.js`, add two excerpts **before** the `ReactDOM$1.createRoot(...)` line. Copy them from the real file and trim them; they are listed here so the shape is fixed:
- `function CheckboxField({ label, ...props }) { … }`, cut to its declaration, like the other library code.
- `SettingsContextContentGameplay`, cut down: the `useTranslation("settings")` line, then a `return jsxRuntimeExports.jsxs("div", { className: "settings-context-panel", children: [ jsxRuntimeExports.jsxs("div", { className: "settings-context-panel__group", children: [ jsx("h3", { children: t2("content_preferences") }), <the autoplay CheckboxField>, <the CheckboxField element whose label is t2("persist_filters_and_sorting"), verbatim; its label line is 170334 of the real file> ] }) ] })`.
- The Big Picture decoy, `function ContentSettingsSection({ className }) { const { t: t2 } = useTranslation("settings"); const items = [ <the { id: "persist-filters-and-sorting", … } item, verbatim; its label line is 257193> ]; return items; }`.

Update the header comment to mention the settings section and the Big Picture decoy.

- [ ] **Step 2: Write the failing tests** in `patches.test.ts`

- **"every Hydra patch applies to the Hydra 4.1.6 excerpts".**
  - The named results follow the bundle's `patches` order: `Disable self-update`, `Side-by-side identity`, `Use the bundled UI`, `Recently added sort`, `Recently downloaded sort`, `More like this (Revamped)`, `More like this (Steam)`, all `applied`.
  - Then the internal ones, all `applied`: `Hydra locales`, `Hydra extension loader`, `Steam bridge`, `Similar games rows`, `Similar games settings`, `registry: game page`, `registry: game data`, `registry: library`, `registry: Steam tags`, `registry: settings`.
  - Write the exact `(internal patch #N: …)` labels from the first run's output; they follow the engine's discovery order.
- **"both rows: markers and the settings slot before the root render, the stock section mounted once, the checkbox slot after the last Content preferences checkbox".** On the `MORE_LIKE_THIS` output:
  - It includes `(globalThis.__revamp ??= { registry: {}, mounts: {} }).registry.similarGamesSteam = true;` and the same for `similarGamesRevamped`.
  - It includes `const __revampSimilarGamesSettings = globalThis.__revamp?.mount?.("hydra.similarGamesSettings", () => null) ?? (() => null);`.
  - Each of those three comes before `ReactDOM$1.createRoot(`.
  - It includes `SimilarGames = globalThis.__revamp?.mount?.("hydra.similarGames", SimilarGames) ?? SimilarGames;` exactly once, and `), jsxRuntimeExports.jsx(__revampSimilarGamesSettings, {})` exactly once.
  - The registry lines include `CheckboxField: CheckboxField`.
  - The `ContentSettingsSection` text is unchanged from the fixture.
- **"only Steam: one marker, the same shared patches".** With `disable: ["More like this (Revamped)"]`:
  - The output has the Steam marker and not the Revamped one.
  - The settings slot and the main bridge line are present.
- **"neither: nothing outside the other patches changes".** With `disable: ["More like this (Steam)", "More like this (Revamped)"]`:
  - The outputs lack `MORE_LIKE_THIS`, `"out/preload/index.mjs"`, `"out/renderer/index.html"` and `EXTENSION_FILE`.
  - The main output doesn't include `__revampSteamBridge`.
- **"a changed settings section skips both rows".** Replace `t2("content_preferences")` in the fixture with `t2("content_preferences_v2")`; only the desktop section has it.
  - `(…: registry: settings)` is `failed`, with a message matching `/fingerprint "settings Content preferences last checkbox" failed/`.
  - Both feature patches are `skipped`.
  - `Recently added sort` is `applied`.
- **Rename for the new names.** The existing tests that name "More like this ranking" use `More like this (Revamped)`:
  - the bundled-UI skip test;
  - the changed-stock-section test, which now expects `registry: game page` failed and both features skipped;
  - the two registry-resolve tests;
  - the dry-run report test, which now expects `"Hydra 4.1.7 (untested): 5/7 patches apply (dry run, nothing installed)"`, ending with `✓ More like this (Revamped)` and `✓ More like this (Steam)`;
  - "with More like this disabled", which becomes the "neither" test above.
- **Remove** the probe test from Task 1. The real patches now cover the bridge, so assert its two inserted strings in "both rows" instead.

- [ ] **Step 3: Run, expect failure**

Run: `node --test bundles/official/test/patches.test.ts`
Expected: FAIL (the patches don't exist yet).

- [ ] **Step 4: Implement**

- **`registry.ts`.** Add the following (checked on the real file):
  ```ts
  export const settingsLastCheckbox = fingerprint({
    name: "settings Content preferences last checkbox",
    strings: ['"persist_filters_and_sorting"', '"content_preferences"'],
    pattern: '$JSX.jsx($CHECKBOX, { label: $T("persist_filters_and_sorting"), checked: $FORM.persistFiltersAndSorting })',
  });
  ```
  Add `registerSettings = definePatch({ description: "registry: settings", execute(ctx) { register(ctx, { CheckboxField: ctx.match(settingsLastCheckbox).$CHECKBOX }); } })`.
- **`more-like-this.ts`:**
  - **`similarGamesRows`** (internal, description `"Similar games rows"`). `dependsOn: [useBundledUi, hydraExtensionLoader, registerGamePage, registerGameData, registerLibrary, registerSteamTags]`. Its execute is today's `moreLikeThisRanking.execute`.
  - **`similarGamesSettings`** (internal, description `"Similar games settings"`). `dependsOn: [useBundledUi, hydraExtensionLoader, registerSettings, registerLibrary]`. It:
    - matches `settingsLastCheckbox` and `rootRender`, and throws unless they are in the same file;
    - `render.insertBefore(<the const line from the test>)`;
    - `box.insertAfter(\`${box.$JSX}.jsx(__revampSimilarGamesSettings, {})\`)`.
  - **Feature patches.** Both are `compatibleWith: [{ app: hydra, versions: ["4.1.6"] }]`, with `dependsOn: [useBundledUi, hydraExtensionLoader, steamBridge, similarGamesRows, similarGamesSettings]`. Each one's `execute` is `ctx.match(rootRender).insertBefore(<its marker line from the test>)`.
  - **Descriptions (exact):**
    - Steam: `"Adds a 'More like this (Steam)' row to a game's page with Steam's own recommendations, the tags each shares with the game and an 'Already in library' badge, and a Settings checkbox per row. Hydra's own row stays as 'More like this (Original)'."`
    - Revamped: `"Adds a 'More like this (Revamped)' row to a game's page: Hydra's catalogue matched on the game's Steam tags, with the shared tags and an 'Already in library' badge, and a Settings checkbox per row. Replaces 'More like this ranking'; Hydra's own row stays as 'More like this (Original)'."`
- **`src/index.ts`.** In `patches`, `moreLikeThisRevamped, moreLikeThisSteam` take the place of `moreLikeThisRanking`. Set `version: "0.4.0"`.
- **`CHANGELOG.md`.** Add, above `## 0.3.0`:
  ```markdown
  ## 0.4.0

  - Hydra 4.1.6: **More like this (Steam)**. A row with Steam's own recommendations for the game, the tags each shares with it and an "Already in library" badge.
  - Hydra 4.1.6: **More like this (Revamped)** replaces **More like this ranking**. It matches Hydra's catalogue on the game's Steam tags only (no longer padded with Hydra's own list), tries looser 3- and 2-tag searches for niche games, and skips Roguelike and Roguelite, which Hydra's search never matches.
  - With either one, Hydra's own row stays as "More like this (Original)", and Settings → Content & gameplay gets a checkbox for each row.
  ```

- [ ] **Step 5: Run, expect pass**

Run: `npm test && npm run typecheck && npm run build -w @revamp/bundle-official`
Expected:
- all tests pass, including `metadata.test.ts`'s changelog check;
- the build prints `bundle 0.4.0`;
- `dist/patches.json` lists both new names and not "More like this ranking".

- [ ] **Step 6: Commit**

```bash
git add bundles/official
git commit -m "feat(bundle): More like this (Steam) and (Revamped) replace the ranking patch; bundle 0.4.0"
```

---

### Task 5: Engine, the new-patches rule and the confirmation callback

**Files:**
- Modify: `packages/engine/src/api.ts`, `packages/engine/src/updates.ts`, `packages/engine/src/index.ts`
- Create: `packages/engine/test/new-patches.test.ts`

**Interfaces:**
- Produces, in `api.ts`:
  ```ts
  export interface NewPatchesQuestion { bundle: { name: string; version: string }; appName: string; version: string; patches: Array<{ name: string; description: string }> }
  export type NewPatchesAnswer = "on" | "off" | "off-this-run";
  // PatchAppOptions gains:
  confirmNewPatches?: (question: NewPatchesQuestion) => Promise<NewPatchesAnswer>;
  /** Patch names in the current install's receipt; undefined when the app has no current install. */
  export function installedPatchNames(paths: Paths, appId: string): string[] | undefined;
  /** Default-on, non-required patches the bundle offers for `version` that the install never had and nobody answered. */
  export function newPatchesToAsk(app: AppInfo, patches: PatchInfo[], version: string, installed: string[] | undefined, saved: Selection, flags: { enable?: string[]; disable?: string[] }): PatchInfo[];
  ```
- `UpdateOptions` gains `confirmNewPatches?: PatchAppOptions["confirmNewPatches"]`. `updateApp` already spreads `o` into `patchApp`.
- `index.ts` exports `newPatchesToAsk`, `installedPatchNames` and the two types.

- [ ] **Step 1: Write the failing tests** in `new-patches.test.ts`

Use the `setup()` pattern from `api.test.ts`; copy the helper, which uses `demoDeb` / `writeDemoBundle`. Use a local `WAVE` extra:
```js
patches.push({ kind: "patch", name: "Wave", description: "Waves.", compatibleWith: [{ app }], execute(ctx) { ctx.log("waving"); } });
```

Tests on `newPatchesToAsk`, as pure unit tests with `PatchInfo` literals like `selection.test.ts`:
- **"asks about default-on patches the install never had and nobody answered".** Each condition alone excludes a patch:
  - not in `installed`
  - `default: false`
  - required
  - in `saved.enable`
  - in `saved.disable`
  - in `flags.enable`
  - in `flags.disable`
  - doesn't fit `version`
- **"a first install asks nothing".** `installed === undefined` gives `[]`.

Tests through `patchApp`:
- **"a re-patch asks once, and 'on' turns the patch on and saves it".**
  1. Install with the base bundle.
  2. Rewrite the bundle with `WAVE`.
  3. `patchApp({ ...opts, confirmNewPatches })`. The stub records the question and answers `"on"`.
  4. The question deep-equals `{ bundle: { name: "Demo bundle", version: "1.0.0" }, appName: "Demo", version: "1.0.0", patches: [{ name: "Wave", description: "Waves." }] }`.
  5. The results include `["Wave", "applied"]`.
  6. The saved selection's `enable` includes `"Wave"`.
  7. A second `patchApp` with a stub that throws if called succeeds.
- **"'off' keeps it off and saves that".** Wave is `disabled`, and the saved `disable` includes `"Wave"`.
- **"'off-this-run' keeps it off without saving".**
  - Wave is `disabled`.
  - The saved selection doesn't mention `"Wave"`.
  - A second run calls the stub again.
- **"no callback keeps today's behavior".** Wave is applied.
- **"a first install never calls the callback".**
- **"flags answer for themselves".** With `enable: ["Wave"]`, the callback isn't called.

- [ ] **Step 2: Run, expect failure**

Run: `node --test packages/engine/test/new-patches.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement**

- **`installedPatchNames`:**
  - Find the app in `listInstalls(paths)`.
  - Return `undefined` without a `current`.
  - Otherwise return the names in `receipt.patches` of the current version, or `[]` if it has no receipt.
- **`newPatchesToAsk`:**
  - Return `[]` when `installed` is `undefined`.
  - Otherwise filter `patches` on `fitsVersion(p, app.id, version) && p.default && !app.required.includes(p.name) && !installed.includes(p.name) && ![...saved.enable, ...saved.disable, ...(flags.enable ?? []), ...(flags.disable ?? [])].includes(p.name)`.
- **In `patchApp`,** right after `resolveSelection` and before `lockApp`:
  - When `o.confirmNewPatches` is set, compute `ask` from `patchesForApp(desc.patches, app.id)`, with `version`, `installedPatchNames(paths, app.id)`, `loadSelection(paths, app.id)` and the flags.
  - If `ask` isn't empty, await the answer.
  - `"on"` pushes the names to `selection.enable`, and `"off"` to `selection.disable`.
  - `"off-this-run"` builds `runSelection = { ...selection, disable: [...selection.disable, ...names] }` and leaves `selection` unchanged.
- **Downstream.** Pass `runSelection ?? selection` to the sandbox job and into `receipt.selection`. Keep `saveSelection(paths, app.id, selection)`.

- [ ] **Step 4: Run, expect pass**

Run: `node --test packages/engine/test/*.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): ask before a re-patch turns on new patches"
```

---

### Task 6: CLI prompt, `--yes`, and `serve`

**Files:**
- Create: `packages/cli/src/new-patches.ts`, `packages/cli/test/new-patches.test.ts`
- Modify: `packages/cli/src/main.ts`, `packages/cli/src/serve.ts`, `packages/cli/test/serve.test.ts`

**Interfaces:**
- Consumes: `NewPatchesQuestion`, `NewPatchesAnswer`, `newPatchesToAsk`, `installedPatchNames` (Task 5).
- Produces:
  ```ts
  export function newPatchesPrompt(o: { yes: boolean; dryRun: boolean; interactive: boolean; confirm: (question: string) => Promise<boolean>; print: (line: string) => void }): (q: NewPatchesQuestion) => Promise<NewPatchesAnswer>;
  ```
- `patches.list` replies gain `ask: string[]`. `job.update` is removed.

- [ ] **Step 1: Write the failing tests**

`new-patches.test.ts` uses `q = { bundle: { name: "Revamp official", version: "0.4.0" }, appName: "Hydra", version: "4.1.6", patches: [{ name: "More like this (Steam)", description: "Steam row." }, { name: "More like this (Revamped)", description: "Tag row." }] }`:
- **"lists the patches, then asks".** With `interactive: true` and `confirm` resolving `true`, the answer is `"on"`, and the printed lines are:
  ```
  Revamp official 0.4.0 adds 2 new patches for Hydra 4.1.6:
    More like this (Steam)     Steam row.
    More like this (Revamped)  Tag row.
  ```
  Names are padded to the longest name plus two spaces, and `confirm` got `"Turn them on?"`.
- **"No keeps them off".** `confirm` resolving `false` gives `"off"`.
- **"--yes answers yes without asking".** `confirm` isn't called, and the answer is `"on"`.
- **"without a terminal they stay off for this run, unsaved".** With `interactive: false`, the answer is `"off-this-run"`. The last printed line is exactly `They stay off for this run. To turn them on, run it again with --yes or --enable "<patch>".` `confirm` isn't called.
- **"a dry run never asks".** With `dryRun: true`, the answer is `"off-this-run"`, the same last line is printed, and `confirm` isn't called. With `dryRun: true, yes: true`, the answer is `"on"`.
- **"one patch reads 'adds 1 new patch'".**
- **"bundle text is printable".** A description containing `\u001b[2J` is printed without the ESC, because the lines go through `printable()`.

In `serve.test.ts`:
- **`patches.list`.** For the demo app before any install, `ask` deep-equals `[]`. After installing, then rewriting the bundle with a default-on extra patch, `ask` deep-equals `["<that name>"]`.
- **`job.update`.** Replace the `job.update` assertion with `(await s.call("job.update", { appId: "demo" })).error.code === -32601`, method not found.

- [ ] **Step 2: Run, expect failure**

Run: `node --test packages/cli/test/new-patches.test.ts packages/cli/test/serve.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`new-patches.ts`:**
  - The policy runs in this order: print the list (always, so `--yes` shows what it turned on); then `yes` returns `"on"`; then `dryRun || !interactive` prints the note and returns `"off-this-run"`; otherwise `(await confirm("Turn them on?")) ? "on" : "off"`.
  - Each printed line goes through `printable()` from `format.ts`.
- **`main.ts`:**
  - `patch` and `update` pass `confirmNewPatches: newPatchesPrompt({ yes: values.yes ?? false, dryRun: values["dry-run"] ?? false, interactive: process.stdin.isTTY === true, confirm, print })`.
  - USAGE: `revamp patch … [--dry-run] [--yes]`, and `revamp update [<app>] [--force] [--yes]`.
- **`serve.ts`:**
  - `patches.list` adds `ask: newPatchesToAsk(listing.app, listing.patches, listing.version, installedPatchNames(o.paths, appId), loadSelection(o.paths, appId), {}).map((p) => p.name)`.
  - Delete the `job.update` method and its now-unused imports.

- [ ] **Step 4: Run, expect pass**

Run: `node --test packages/cli/test/*.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): Turn them on? [y/N] before a re-patch adds new patches; --yes; serve lists them"
```

---

### Task 7: Window, the banner and no "Update all"

**Files:**
- Modify: `packages/gui/src/model.ts`, `packages/gui/src/AppDetail.tsx`, `packages/gui/src/App.tsx`, `packages/gui/src/JobView.tsx` (comment only), `packages/gui/test/model.test.ts`

**Interfaces:**
- Consumes: `patches.list` `ask: string[]` (Task 6).
- Produces, `model.ts`:
  ```ts
  // Listing gains: ask: string[]
  export function initialToggles(patches: PatchRow[], saved: Selection, ask?: string[]): Record<string, boolean>; // names in ask start false
  export function newPatchesNote(l: Listing, appName: string): string;
  export function answerNewPatches(toggles: Record<string, boolean>, ask: string[], turnOn: boolean): Record<string, boolean>;
  ```
- `pendingUpdates` is removed.

- [ ] **Step 1: Write the failing tests** in `model.test.ts`

- **"new patches to ask about start unticked; Turn on ticks only them, Keep off keeps every choice".**
  - With `patches = [patch("Old"), patch("New A"), patch("New B")]`, `initialToggles(patches, EMPTY, ["New A", "New B"])` deep-equals `{ Old: true, "New A": false, "New B": false }`.
  - `answerNewPatches({ Old: false, "New A": false, "New B": true }, ["New A", "New B"], true)` deep-equals `{ Old: false, "New A": true, "New B": true }`.
  - `answerNewPatches(t, ask, false)` returns `t` unchanged, keeping the manual tick on New B.
- **"the banner names the bundle, the count, the app and the version".**
  - `newPatchesNote({ ...listing, bundle: { name: "Revamp official", version: "0.4.0" }, version: "4.1.6", ask: ["A", "B"] }, "Hydra")` gives `"Revamp official 0.4.0 adds 2 new patches for your Hydra 4.1.6. Turn them on?"`.
  - With one name, it reads `adds 1 new patch`.
  - Bundle text goes through `plain()`.
- **Remove `pendingUpdates`.** Remove it from the import and drop its five assertions. The tests' other assertions stay.

- [ ] **Step 2: Run, expect failure**

Run: `node --test packages/gui/test/model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`model.ts`:** the three functions; delete `pendingUpdates`.
- **`AppDetail.tsx`:**
  - Keep `answered` state, reset to `false` whenever a new listing loads.
  - Toggles start from `initialToggles(l.patches, l.selection, l.ask)`.
  - When `listing.ask.length > 0 && !answered`, render `<div className="banner accent">{newPatchesNote(listing, name)} <div className="row-actions"><button className="primary">Turn on</button><button>Keep off</button></div></div>` above the patch list. Each button calls `setToggles(answerNewPatches(toggles, listing.ask, <true|false>))` and `setAnswered(true)`.
  - The primary Patch/Re-patch/Update button gets `disabled={listing.ask.length > 0 && !answered}`, alongside whatever disables it today. Dry run is unchanged.
- **`App.tsx`:**
  - Delete `updateAll`, `pending`, the "Update all" button, and the `pendingUpdates` / `AppUpdate` imports.
  - Keep the `side-head` layout.
- **`JobView.tsx`:** fix the comment that mentions "Update all".

- [ ] **Step 4: Run, expect pass**

Run: `node --test packages/gui/test/*.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Check the screen in the browser pane**

1. Build the bundle (`npm run build -w @revamp/bundle-official`).
2. Make a throwaway home: `export T=$(mktemp -d)`.
3. Install the **0.3.0** bundle there, so the install lacks the new patches: `git show main:bundles/official/src/index.ts` is 0.3.0, so build it from `main` in a scratch clone, or use the cached `~/.cache/revamp/bundles/<sha>.mjs` that `~/.config/revamp/sources.json` pins. Then run `XDG_CACHE_HOME="$HOME/.cache" HOME=$T npm run revamp -- patch hydra --bundle <0.3.0 bundle>`.
4. Start the dev window with a source pointing at the new build: `XDG_CACHE_HOME="$HOME/.cache" HOME=$T npm run dev -w @revamp/gui`, after `XDG_CACHE_HOME="$HOME/.cache" HOME=$T npm run revamp -- sources add bundles/official/dist/official.mjs --yes`.
5. Open Hydra, and expect:
   - the banner "Revamp official 0.4.0 adds 2 new patches for your Hydra 4.1.6. Turn them on?";
   - both new patches unticked, with the "new" tag;
   - Re-patch disabled until Turn on or Keep off;
   - no "Update all" in the sidebar.

Take one screenshot for the review.

- [ ] **Step 6: Commit**

```bash
git add packages/gui
git commit -m "feat(gui): ask about new patches on the app screen; remove Update all"
```

---

### Task 8: Spec amendments, integration test, full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-revamp-v1-design.md`, `test/integration/hydra.test.ts`, `CLAUDE.md` (two lines)

- [ ] **Step 1: Integration test**

In `test/integration/hydra.test.ts`:
- **The result lists:**
  - the named ones become: `Disable self-update`, `Side-by-side identity`, `Use the bundled UI`, `Recently added sort`, `Recently downloaded sort`, `More like this (Revamped)`, `More like this (Steam)`;
  - the internal list becomes the Task 4 set, with labels as the run prints them.
- **Add these assertions on the installed asar:**
  - `out/main/index.js` includes `__revampSteamBridge.registerSteamBridge(registerEvent, logger);` once.
  - `out/preload/index.mjs` includes `revampGetSteamRecommendations: (objectId) => ipcRenderer.invoke("revamp:getSteamRecommendations", objectId)`.
  - The patched renderer includes both markers and `jsxRuntimeExports.jsx(__revampSimilarGamesSettings, {})` once.
  - The registry `Object.assign(` count goes from 5 to 6, for the new `registry: settings`.
- **Big Picture is byte-identical.** Slice the patched renderer from each start string to its end string, and assert the SHA-256 of each slice:
  - `const useSimilarGames = /* @__PURE__ */ __name((query) => {` … `}, "useSimilarGames");` gives `d086a5148f741eef8a3bde65ec1521bcd632206267dc5e4b00200d32510b7e09`;
  - `function ContentSettingsSection(` … the first `"\n}\n"` gives `102baec72c8ac3e56136f52aa74d6470d909ce0f1a2530f6172f9a2b1e042c07`.

  Both hashes were measured on the stock 4.1.6 file.
- **Each patch alone.** Add two dry runs, `patchApp({ …, dryRun: true, disable: ["More like this (Steam)"] })` and the same for Revamped. Each has `exitCode === 0`, and the other feature patch is `applied`.

- [ ] **Step 2: Spec amendments** (one short edit each)

- **§6, "Mounting UI".** A second mount, `hydra.similarGamesSettings`, as a top-level `const` before the root render, with the slot after the last Content preferences checkbox. Feature patches write registry markers.
- **§7.3.** After "The user confirms": re-patching an installed app asks before turning on new patches (rule in the 2026-10-16 design §6.1). `update` gains `--yes`.
- **§8.** In the command table, add `[--yes]` to `patch` and `update`.
- **§9.**
  - The protocol method list loses `job.update`, and `patches.list` returns `ask`.
  - The app-detail line adds "the new-patches banner".
  - Note that there is no "Update all".
- **§10.** Replace the "More like this ranking" row with three rows:
  - "Steam bridge (internal)";
  - "More like this (Steam)";
  - "More like this (Revamped)".

  Give each its mechanism in one line, as the other rows do.

In `CLAUDE.md`:
- The `serve` bullet: "`patches.list` also returns `ask`, the new patches the window must ask about".
- The Extensions bullet: "a second esbuild output, the Steam bridge (`__REVAMP_HYDRA_STEAM_BRIDGE__`), runs in Hydra's main process".

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run test:integration`
Expected: all unit tests pass; the 3 typecheck projects are clean; the integration run passes 4/4. If the forced 4.0.6 test gets HTTP 403 from api.github.com, wait and rerun it.

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md test
git commit -m "docs: spec and CLAUDE.md for the More like this rows and new-patch confirmation; integration checks"
```

---

### Task 9: Ship (owner-confirmed steps)

These are outward or change the owner's machine. Ask the owner before each step marked **(ask)**.

- [ ] **Step 1: Final review.** Run a whole-branch review (`superpowers:requesting-code-review`) and fix what it confirms.
- [ ] **Step 2: Merge (ask).**
  1. In the main checkout, confirm it is on `main` and clean apart from the untracked `AGENTS.md`.
  2. Run `git merge --ff-only more-like-this-rows`.
  3. If `main` moved meanwhile, rebase the branch first and rerun Task 8 step 3.
- [ ] **Step 3: Push (ask).** `git push`.
- [ ] **Step 4: Release (ask).** `npm run release -w @revamp/bundle-official`.
  - Expected: GitHub release `bundle-v0.4.0` with `official.mjs` and `patches.json`, plus a local commit "release: bundle 0.4.0" of the root `bundle.json`.
  - Then push it (ask).
- [ ] **Step 5: Install on the owner's machine (ask).** Run `npm run gui:install`, which also installs the CLI.
- [ ] **Step 6: Owner's check.**
  1. The owner quits Hydra (Revamped).
  2. Run `revamp update hydra`. Expect the source to refresh to 0.4.0, and the prompt listing both patches with "Turn them on? [y/N]". The owner answers.
  3. Open Hydra (Revamped):
     - **Inspector Waffles:** the Steam row starts near The Roottrees are Dead, Phoenix Wright and L.A. Noire.
     - **Space Evolver:** Revamped shows TheoTown, Starmancer and Station Manager; Steam shows Combolands and Balatro.
     - **The Season of the Warlock:** check it too.
     - **A Launchbox game:** only Original.
     - **The checkboxes:** each one hides its row.
  4. Remove the worktree after the owner is happy: `git worktree remove .worktrees/more-like-this-rows`, then `git branch -d more-like-this-rows`.
