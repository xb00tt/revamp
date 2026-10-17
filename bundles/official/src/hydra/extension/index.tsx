// The Hydra extension entry, loaded by a <script type="module"> placed before Hydra's own module script.
// It runs before Hydra exists, so it only installs mount() and registers replacements; nothing here may
// touch the registry until a mounted component renders.
import { mount } from "@revamp-app/sdk/shims/mount";
import { revamp } from "@revamp-app/sdk/shims/registry";
import { SimilarGamesRows } from "./pages/game-details/similar-games/similar-games-rows.tsx";
import { SimilarGamesSettings } from "./pages/settings/similar-games-settings.tsx";

const root = revamp();
root.mount ??= mount as (id: string, original: unknown) => unknown;
root.mounts["hydra.similarGames"] = SimilarGamesRows;
root.mounts["hydra.similarGamesSettings"] = SimilarGamesSettings;
