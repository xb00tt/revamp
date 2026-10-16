import type { ComponentType } from "react";

import { registryEntries, useAppSelector, type GameShop } from "../../../app.ts";
import { patchedRows, shownRows } from "../../../rows.ts";
import { SimilarGames } from "./similar-games.tsx";

interface Props {
  objectId: string;
  shop: GameShop;
  Original: ComponentType<{ objectId: string; shop: GameShop }>;
}

// Replaces Hydra's "More like this" section: one SimilarGames row per patched source, minus those switched off
// in Settings. Without a feature patch's marker the stock section stays.
export function SimilarGamesRows({ objectId, shop, Original }: Readonly<Props>) {
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const rows = patchedRows(registryEntries());

  if (rows.length === 0) return <Original objectId={objectId} shop={shop} />;

  return (
    <>
      {shownRows(rows, preferences).map((source) => (
        <SimilarGames key={source} objectId={objectId} shop={shop} source={source} />
      ))}
    </>
  );
}
