# "More like this" rows and new-patch confirmation: design

Date: 2026-10-16. Owner: xb00tt. Status: draft for the owner's review.

Amends the binding spec `2026-10-14-revamp-v1-design.md`: §6 (extension features), §7.3 (update), §8 (CLI flags), §9 (GUI) and §10 (bundle contents). The builder updates those sections to match this document.

## 1. Intent

In the Hydra fork (`/home/borislav/github/hydra`, branch `local/v4.1.6-recently-downloaded`), the owner split "More like this" on the game page into three rows: Steam, Revamped and Original. Each row has its own on/off checkbox in Settings. The owner tried it in a patched build and is happy with it. Revamp should offer the same thing as patches to the official Hydra release.

Two patches carry it, so a user can take one row, the other, or both:
- **"More like this (Steam)"**: Steam's own recommendations for the game.
- **"More like this (Revamped)"**: Revamp's tag matching. It replaces today's "More like this ranking" patch.

Hydra's own row stays as a third row, "More like this (Original)", whenever either patch is applied.

Because these two patches are new and on by default, the owner also wants Revamp to stop turning on new patches silently when it re-patches an existing install. It should list them and ask first, in the CLI and in the window. That part is general and applies to every future new patch.

## 2. Reference implementation

The fork is the behavior reference. Port it, don't redesign it (same rule as spec §6, "Porting rule").
- Revamp's current extension (`bundles/official/src/hydra/extension/`) is the fork as of commit `3f098e9f`.
- **`1078cac1`** "widen tag queries and fall back to Steam store tags": 3- and 2-tag queries, Steam store tags fetched in the main process, Roguelike/Roguelite dropped.
- **`561b4721`** "split into Steam, Revamped and Original rows": the three sources, the main-process Steam recommendations service (`src/main/services/steam-recommendations.ts` with its test), the preload entries, the three settings, translations, and the game-page and settings JSX.
- The fork's Big Picture change in `561b4721` is **not** ported (see §4).

## 3. Goals, non-goals, anti-goals

**Goals**
- Two user-facing patches with exactly these names: `More like this (Steam)` and `More like this (Revamped)`.
- Each row behaves exactly like the fork's same-named row.
- When at least one of them is applied, Settings → Content & gameplay → Content preferences shows one checkbox per row that exists.
- Re-patching an existing install asks before turning on new patches, in the CLI and in the window.
- The work ends with a published bundle release and the owner's CLI and window reinstalled.

**Non-goals**
- Big Picture mode. It stays vanilla: Hydra's own single similar-games section, untouched.
- Hydra versions other than 4.1.6, which is the only version the other Hydra patches support.
- Asking about patches on a first install.
- Changing the `revamp check` message or the daily notification.

**Anti-goals** (a failure even if it "works")
- With neither patch applied, anything differs from vanilla Hydra: the row title, Settings, saved preferences, or the main process.
- A new patch gets turned on without the user seeing it when they re-patch.
- Bundle text, or anything Steam returns, is executed or used to build a path or host.

## 4. What the user sees in Hydra

### 4.1 Game page

Rows appear in this order, below the description and above reviews, where the stock section is today:

| Row | Title (en) | Shown for | Source |
|---|---|---|---|
| Steam | More like this (Steam) | Steam games, when "More like this (Steam)" is applied and its checkbox is on | Steam's own "More like this" list for the game, in Steam's order, up to 12 |
| Revamped | More like this (Revamped) | Steam games, when "More like this (Revamped)" is applied and its checkbox is on | Hydra catalogue search on the game's **Steam store tags** (fetched from Steam, never Hydra's copy), fork ranking, no padding with `/similar`, up to 12 |
| Original | More like this (Original) | Steam and Launchbox games, when either patch is applied and its checkbox is on | Hydra's `/similar` endpoint, as stock |

All three rows, as in the fork:
- Use the fork's component: cover cards, carousel, skeleton and empty state.
- Show the "Already in library" badge and put owned games last.
- Cache results per game and per row for the session.
- A game may appear in more than one row; each row stands alone.

Captions with shared tags appear on the Steam and Revamped rows, not on Original. Launchbox games get only the Original row.

**Revamped row** = fork `561b4721` `fetchRevamped`:
- Tags come from Steam's store data for the game (`getSteamTags`), with Roguelike/Roguelite removed and ordered specific-first.
- Queries are the fork's ladder (`SIMILAR_GAMES_TAG_QUERIES`, including the 3- and 2-tag queries). Ranking is by hit count.

**Steam row** = fork `fetchSteam`:
- Steam's list and the game's own tags are fetched in parallel. The current game is removed from the list.
- Shared tags are the game's tags, ordered specific-first, that the recommendation also has.

**With neither patch applied,** the stock "More like this" section is untouched.

**Big Picture** shares the renderer file with the desktop UI and uses the stock `useSimilarGames` hook. The patches must not edit that hook or anything else Big Picture uses, so it stays vanilla.

### 4.2 Settings

Under Settings → Content & gameplay → Content preferences, after the last stock checkbox ("Keep sorting and filters after restarting Hydra"), add one checkbox per row that exists:
- "Show “More like this (Steam)” on game pages", only if the Steam patch is applied
- "Show “More like this (Revamped)” on game pages", only if the Revamped patch is applied
- "Show “More like this (Original)” on game pages", if either is applied

All start on: a missing preference means on. Unticking hides that row at once.

The preferences are stored in Hydra's user preferences under the fork's keys: `showSimilarGamesSteam`, `showSimilarGamesRevamped` and `showSimilarGamesOriginal`. Hydra's main process merges arbitrary keys into the stored preferences and broadcasts the update to its windows, so no main-process change is needed for this.

The Big Picture settings page is not changed.

### 4.3 Text

Strings are the fork's, in English, Bulgarian and Brazilian Portuguese. Other languages show English:

| Key | en | bg | pt-BR |
|---|---|---|---|
| row titles, checkbox labels | see fork `src/locales/en/translation.json` | fork `bg` | fork `pt-BR` |

The fork's keys are `game_details.similar_games_{steam,revamped,original}` and `settings.show_similar_games_{steam,revamped,original}`.

## 5. How it is built in Revamp

### 5.1 Patch structure

- **`More like this (Steam)`** and **`More like this (Revamped)`** are user-facing patches. Each is `compatibleWith` Hydra 4.1.6 and on by default. Each `dependsOn` the internal patches below and on the existing ones it needs: Use the bundled UI, the extension loader and the registry patches.
- **`More like this ranking` is removed.** Its code (`more-like-this.ts`, the extension hooks and component) evolves in place into the new patches; it isn't kept beside them. The Revamped patch's description says it replaces the old patch. A saved choice naming the old patch is dropped with the existing "this bundle no longer has that patch" warning. There is no migration: Revamped is simply a new patch, so an existing install is asked about it (§6). The owner is the only existing user.
- **Shared internal patches.** These are reached only through `dependsOn`, so they apply once when either feature patch is selected:
  - **Steam bridge** (main process + preload): see §5.2.
  - **Similar games rows** (game page): routes the stock `SimilarGames` through `mount()`, as today, and the extension's replacement renders the rows. The error boundary falls back to the stock section.
  - **Similar games settings** (settings page): a mount point after the last checkbox of the desktop Content preferences group, which renders the extension's checkboxes. Its fallback renders nothing. Anchor on the desktop `CheckboxField` / `handleChange` form, not on the Big Picture `items` array, which uses the same i18n keys (see §9).
  - Registry entries for anything new the extension needs (for example `CheckboxField`), each with its own internal registry patch, as in `registry.ts`.
- **Which rows exist.** The extension must learn which feature patches were applied from the patches themselves: each feature patch writes a marker the extension reads at render time. The extension must never infer this at runtime from what it finds in Hydra. The settings checkboxes follow the same markers.
  - Setting the markers alongside the registry assignment, just before the root render, is fine, because both mounts read them only at render time.

### 5.2 Steam bridge (main process)

Steam's store refuses requests from inside the page (CORS), so both Steam fetches run in Hydra's main process. They are exposed to the renderer through the preload, as in the fork.
- **Main** (`out/main/`): two IPC handlers, ported from the fork's `getSteamAppTags` and `getSteamRecommendations` (`src/main/services/steam.ts` and `steam-recommendations.ts`, with `parseMoreLikeAppIds` and `toSteamRecommendations`).
  - Recommendations come from `https://store.steampowered.com/recommended/morelike/app/<id>/`, parsed with plain string splits and `/data-ds-appid="(\d+)"/`.
  - Names, tag IDs and artwork come from `IStoreBrowseService/GetItems/v1`, with the store context fixed to English/US.
  - Asset URLs use the fixed `https://shared.steamstatic.com/store_item_assets/` prefix.
  - Both handlers return `[]` and log the message on any failure.
- **Preload** (`out/preload/index.mjs`): two new entries on the `window.electron` object passed to `contextBridge.exposeInMainWorld("electron", …)`.
- **Safety:** both handlers reject any game ID that isn't all digits before it reaches a URL. The fork only does this for recommendations; do it for both. Nothing Steam returns is executed.

Facts from the real 4.1.6 build (2026-10-16):
- Main handlers are registered through `registerEvent(name, listener)` → `ipcMain.handle` (`out/main/index.js`).
- `axios` is imported from `node_modules`, not bundled.
- Electron is 41.10.3, so global `fetch` and `electron.net.fetch` are available in main.
- The renderer CSP is `default-src 'self' 'unsafe-inline' * …`, so Steam image hosts load.

### 5.3 Extension

- **Port.** Bring the extension's hooks and component up to fork `561b4721`: sources, `isSimilarGamesQueryEligible`, per-source cache key, `fetchSteam`, `fetchRevamped` and `fetchOriginal`, and `title` from `similar_games_<source>`.
  - The extension's API object gains `getSteamTags` and `getSteamRecommendations`, which call the preload entries.
  - Keep the code close to the fork's. Only imports are remapped (spec §6).
- **Row container.** One mounted component renders the rows that exist and are switched on, in the fixed order, for the current game.
- **Original row.** The extension fetches `/catalogue/<shop>/<id>/similar` itself through `window.electron.hydraApi`, as the current port already does (`fetchOriginal` in the fork). It never calls or edits Hydra's own `useSimilarGames`, which Big Picture uses.
- **Settings component.**
  - It reads the preferences from Hydra's redux `userPreferences` state and saves only its own keys through `window.electron.updateUserPreferences`.
  - Hydra's main process merges keys, and Hydra's own `handleChange` sends only the keys it changed, so neither side overwrites the other.
  - Hydra's form state not knowing our keys is fine, since our component never reads Hydra's form.
- **Strings.** The extension carries its own en/bg/pt-BR table for the row titles and checkbox labels, chosen by `i18n.language` (from the `useTranslation` registry entry) and falling back to en. The "Hydra locales" patch isn't touched.
  - Reason: most 4.1.6 locale namespaces are `JSON.parse('…')` strings, not object literals, so that patch can't extend `game_details` or `settings` as it stands.

## 6. New-patch confirmation (engine, CLI, window)

### 6.1 Definition

When re-patching an app that has a current install, a patch is a **new patch to ask about** when all of these hold:
- the bundle offers it for the version being patched;
- it is on by default;
- it is not required;
- the current install's receipt doesn't list it;
- it is in neither list of the app's saved selection (`enable`, `disable`).

It is defined once in the engine and used by the CLI, `serve` and the window.

- **The version being patched** may differ from the installed one, for example an update to a newer release or a forced version in the window's picker. The rule is the same: the patches the bundle offers for that version, checked by name against the current install's receipt.
- **Required** new patches are never asked about. They are applied, and the report lists them as usual.
- **Explicit flags count as an answer:** a patch named in this run's `--enable` or `--disable` isn't asked about.
- **First install** (no current install): nothing is asked.

### 6.2 CLI

`revamp patch <app>` and `revamp update [app]`, when the app is installed and there are new patches to ask about, print:

```
Revamp official 0.4.0 adds 2 new patches for Hydra 4.1.6:
  More like this (Steam)     <description>
  More like this (Revamped)  <description>
Turn them on? [y/N]
```

- **y** turns them on and **N** (also Enter) keeps them off. One answer covers the listed patches.
- The answer becomes `--enable` / `--disable` for this run, so it is saved with the selection after a successful install, like any flag. If the job fails, it is asked again next time.
- `--yes` answers yes without asking. `patch` and `update` gain the flag; it already exists for `sources add` and `uninstall`.
- **Without a terminal to ask in** (stdin isn't a TTY) and without `--yes`, the new patches stay off for this run and nothing is saved. Revamp prints the list and how to turn them on: `--enable "<name>"` or `--yes`.
- `revamp update` with no app named asks per app, in turn. `update` gains only `--yes`, which applies to every app; it keeps taking no `--enable` / `--disable`.
- `--dry-run` never asks. It treats unanswered new patches as off, unless `--enable` names them, and prints a note listing them.
- All bundle text (names, descriptions, bundle name) goes through `printable()`.

### 6.3 Window

On the app's screen, which shows the patches for the version in the picker:
- New patches to ask about carry the existing "new" tag and start **unticked**.
- A banner asks: "<bundle name> <version> adds N new patches for your <app> <version>. Turn them on?", with **Turn on** (ticks them) and **Keep off** (leaves them unticked).
- The primary button (Re-patch / Update to …) is disabled until the banner is answered. **Dry run** stays enabled and previews with the boxes as currently ticked.
- The answer is saved with the next successful patch: the window already sends a full enable/disable list with every job (M5 plan decision 4: no `selection.set`). If the user leaves without patching, the banner comes back.
- **The "Update all" button is removed** from the sidebar, along with code that only it used (`pendingUpdates` if nothing else uses it). The per-app badges stay.
- `patches.list` (or a sibling method) returns the new patches to ask about for the requested version, so the window doesn't recompute the rule.

The approved mockup is option A in this session's brainstorm: the banner on the app screen and the disabled button.

### 6.4 Unchanged

`revamp check`, its `newPatches` list (which keeps its current meaning), the daily notification and the "New patches" badge.

## 7. Release

- Bundle version **0.4.0**, with a `## 0.4.0` section in `bundles/official/CHANGELOG.md` covering the two patches, the removal of "More like this ranking", and the Original row.
- `minEngine` moves only if the bundle uses an SDK feature that 0.2.0 lacks.
- The engine/CLI/GUI changes ship with the repo. They don't need a bundle release, but the owner's machine needs the new CLI and window.
- **Order at the end:**
  1. Merge the branch into `main`.
  2. Push.
  3. `npm run release -w @revamp/bundle-official`. It needs a clean, pushed tree; it creates GitHub release `bundle-v0.4.0` and commits the root `bundle.json`.
  4. Push that commit.
  5. `npm run gui:install`, which installs the CLI too.
  6. Quit Hydra (Revamped) and run `npm run revamp -- update hydra` (or the window) on the real home, so the owner sees the new question.

Each outward step (push, GitHub release) is confirmed with the owner when it comes up.

## 8. Constraints

All of CLAUDE.md applies. In particular:
- Erasable TypeScript only.
- No new runtime dependencies.
- Bundle names are untrusted on the parent side.
- Never eval app code.
- Port 3000 and `/opt/Hydra` are off limits.
- Work happens in the worktree `.worktrees/more-like-this-rows`, branch `more-like-this-rows`.
- Node tests may import plain `.ts` extension files, never `.tsx`.

## 9. Verification

- **Unit tests:**
  - Port the fork's `similar-games.test.ts` cases for the three sources and its `steam-recommendations.test.ts` (parser, mapping). Add the digits-only check for both handlers.
  - Extend `bundles/official/test/patches.test.ts` and its fixtures for the two patches, the internal patches, and "neither applied leaves the files unchanged".
  - The fixtures need trimmed excerpts of the 4.1.6 main `registerEvent` site, the preload `exposeInMainWorld`, and the desktop Content preferences group, plus the Big Picture `ContentSettingsSection` as a decoy.
- **Extension render tests** (`extension.test.ts`, real React 18.3.1):
  - rows present and absent by marker and preference;
  - Launchbox shows only Original;
  - the settings checkboxes by marker;
  - the fallback to the stock section.
- **Engine/CLI/GUI tests:**
  - the new-patch rule (each condition in §6.1);
  - CLI prompt answers, `--yes`, no-TTY, `--dry-run`, and `update` over several apps;
  - `model.ts` tests for the unticked start and the disabled button;
  - removal of "Update all".
- **Integration:** `npm run test:integration` with the real 4.1.6 release: both patches apply, each alone and together. Big Picture shares the renderer file, so "unchanged" is checked by text rather than by file: the stock `useSimilarGames` function and the Big Picture `ContentSettingsSection` are byte-identical before and after patching.
- **In the real app,** on the owner's machine after release, open:
  - Inspector Waffles: the Steam row should start near The Roottrees are Dead, Phoenix Wright and L.A. Noire.
  - The Season of the Warlock.
  - Space Evolver: Revamped should show TheoTown, Starmancer and Station Manager; Steam should show Combolands and Balatro.

  Also toggle each checkbox, and check that a Launchbox game shows only Original.
- **Window:** check the banner and disabled button in the browser pane through `npm run dev -w @revamp/gui` on a throwaway home.

## 10. Who decided what

**The owner decided:**
- Two patches, named exactly as above. Revamped replaces "More like this ranking".
- Rows behave exactly like the fork's. Original is the fork's version, with the badge and caching.
- Neither applied means pure vanilla: no settings, no "(Original)".
- With one applied, the checkboxes are that row's plus Original.
- Fork decisions carried over: order Steam, Revamped, Original; all on by default; Launchbox shows only Original; owned games last; duplicates allowed; en/bg/pt-BR with English fallback.
- Big Picture stays vanilla.
- Both patches are on by default, and re-patching asks before turning on new patches: general, in the CLI and the window, never on first install.
- Window option A (banner, unticked, disabled button); "Update all" removed; `[y/N]` with Enter = No; `--yes`; Dry run never waits.
- Finish with a published bundle release and reinstall.

**Planner's calls** (the owner reviewed them in chat):
- The bridge in main + preload.
- Without a TTY: new patches stay off for the run and are unsaved.
- Required new patches aren't asked about.
- The Revamped description names the patch it replaces.
- Check messages unchanged.

**Calls made while writing this document:**
- A digits-only ID check on both handlers.
- Answers saved with the next successful job, not immediately (consistent with M5 decision 4). In the window, leaving without patching asks again.
- Explicit `--enable`/`--disable` count as answers.
- CLI `--dry-run` treats unanswered new patches as off.
- Bundle version 0.4.0.
- The extension carries its own strings.
- No migration from "More like this ranking" (owner: they're the only user, "dont bother").
- The extension fetches the Original row itself.
- Markers are set next to the registry assignment.
- Only `--yes` is added to `update`.
- Big Picture is checked by text.

**Left to the builder:**
- The exact fingerprints and anchors.
- The marker mechanism.
- How the settings component stays in sync with Hydra's form.
- The IPC channel and preload names. Prefer `revamp`-prefixed names so a future Hydra can't collide.
- `fetch` vs Hydra's `axios` in main.
- The `serve` method shape for new patches.
