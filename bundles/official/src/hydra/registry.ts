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
    // Declared at the top level (resolve() throws otherwise) and before the root render, so it exists when this runs.
    if (binding.resolve().start > render.start) throw new Error(`registry entry ${name} (${binding}) is declared after the root render`);
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

/** The last checkbox of Settings > Content & gameplay > Content preferences (Big Picture's list uses a different shape). */
export const settingsLastCheckbox = fingerprint({
  name: "settings Content preferences last checkbox",
  strings: ['"persist_filters_and_sorting"', '"content_preferences"'],
  pattern: '$JSX.jsx($CHECKBOX, { label: $T("persist_filters_and_sorting"), checked: $FORM.persistFiltersAndSorting })',
});

/** Internal "registry: settings": Hydra's checkbox, so the Settings checkboxes look like its own. */
export const registerSettings = definePatch({
  description: "registry: settings",
  execute(ctx) {
    register(ctx, { CheckboxField: ctx.match(settingsLastCheckbox).$CHECKBOX });
  },
});
