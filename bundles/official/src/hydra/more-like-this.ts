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
