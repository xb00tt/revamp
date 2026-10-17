import { definePatch } from "@revamp-app/sdk";
import { hydra } from "../apps.ts";
import { useBundledUi } from "./bundled-ui.ts";
import { hydraExtensionLoader } from "./extension-loader.ts";
import {
  registerGameData,
  registerGamePage,
  registerLibrary,
  registerSettings,
  registerSteamTags,
  rootRender,
  settingsLastCheckbox,
  similarGamesComponent,
} from "./registry.ts";
import { steamBridge } from "./steam-bridge.ts";

/** Internal "Similar games rows": mounts the extension's rows over the stock section. */
export const similarGamesRows = definePatch({
  description: "Similar games rows",
  dependsOn: [useBundledUi, hydraExtensionLoader, registerGamePage, registerGameData, registerLibrary, registerSteamTags],
  execute(ctx) {
    // The binding is read when the game page renders, after the extension's mount() wrapped it.
    const section = ctx.match(similarGamesComponent);
    const name = `${section.$SIMILAR_GAMES}`;
    section.insertAfter(`${name} = globalThis.__revamp?.mount?.("hydra.similarGames", ${name}) ?? ${name};`);
  },
});

/** Internal "Similar games settings": the checkboxes slot after the last Content preferences checkbox. */
export const similarGamesSettings = definePatch({
  description: "Similar games settings",
  dependsOn: [useBundledUi, hydraExtensionLoader, registerGamePage, registerSettings, registerLibrary],
  execute(ctx) {
    const box = ctx.match(settingsLastCheckbox);
    const render = ctx.match(rootRender);
    if (box.file !== render.file) throw new Error(`the settings checkboxes (${box.file}) are not in the renderer module (${render.file})`);
    render.insertBefore(
      'const __revampSimilarGamesSettings = globalThis.__revamp?.mount?.("hydra.similarGamesSettings", () => null) ?? (() => null);',
    );
    box.insertAfter(`${box.$JSX}.jsx(__revampSimilarGamesSettings, {})`);
  },
});

const dependsOn = [useBundledUi, hydraExtensionLoader, steamBridge, similarGamesRows, similarGamesSettings];
const compatibleWith = [{ app: hydra, versions: ["4.1.6"] }];

export const moreLikeThisSteam = definePatch({
  name: "More like this (Steam)",
  description:
    "Adds a 'More like this (Steam)' row to a game's page with Steam's own recommendations, the tags each shares with the game and an 'Already in library' badge, and a Settings checkbox per row. Hydra's own row stays as 'More like this (Original)'.",
  compatibleWith,
  dependsOn,
  execute(ctx) {
    ctx.match(rootRender).insertBefore("(globalThis.__revamp ??= { registry: {}, mounts: {} }).registry.similarGamesSteam = true;");
  },
});

export const moreLikeThisRevamped = definePatch({
  name: "More like this (Revamped)",
  description:
    "Adds a 'More like this (Revamped)' row to a game's page: Hydra's catalogue matched on the game's Steam tags, with the shared tags and an 'Already in library' badge, and a Settings checkbox per row. Replaces 'More like this ranking'; Hydra's own row stays as 'More like this (Original)'.",
  compatibleWith,
  dependsOn,
  execute(ctx) {
    ctx.match(rootRender).insertBefore("(globalThis.__revamp ??= { registry: {}, mounts: {} }).registry.similarGamesRevamped = true;");
  },
});
