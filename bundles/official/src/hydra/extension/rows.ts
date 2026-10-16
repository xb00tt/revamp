import { SIMILAR_GAMES_SOURCES, type SimilarGamesSource } from "./hooks/similar-games.ts";

// Registry keys the Steam and Revamped feature patches set to true when they apply.
export const ROW_MARKERS = { steam: "similarGamesSteam", revamped: "similarGamesRevamped" } as const;

export const ROW_PREFERENCES = {
  steam: "showSimilarGamesSteam",
  revamped: "showSimilarGamesRevamped",
  original: "showSimilarGamesOriginal",
} as const;

// No marker means no feature patch applied: the stock section stays. Original rides along with any marker.
export function patchedRows(registry: Record<string, unknown>): SimilarGamesSource[] {
  const marked = (Object.keys(ROW_MARKERS) as Array<keyof typeof ROW_MARKERS>).filter((row) => registry[ROW_MARKERS[row]] === true);
  return marked.length === 0 ? [] : SIMILAR_GAMES_SOURCES.filter((row) => row === "original" || marked.includes(row as keyof typeof ROW_MARKERS));
}

// A missing preference means on; only an explicit false hides a row.
export const shownRows = (rows: SimilarGamesSource[], preferences: Record<string, unknown> | null | undefined) =>
  rows.filter((row) => preferences?.[ROW_PREFERENCES[row]] !== false);
