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
  <SimilarGames objectId={objectId} shop={shop} source="revamped" />
);
