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
  buildSimilarGameViews,
  similarGameKey,
  type SimilarGamesQuery,
} from "./similar-games.ts";

const useSteamTagNames = (enabled: boolean) => {
  const dispatch = useAppDispatch();
  const { i18n } = useTranslation();
  const language = i18n.language.split("-")[0] || "en";
  const tagNames = useAppSelector(
    (state) => state.catalogueSearch.steamUserTags[language]
  );

  useEffect(() => {
    if (!enabled || tagNames) return;

    let cancelled = false;
    getLocalizedSteamMetadata<Record<string, number>>(
      "/catalogue/steam/tags",
      i18n.language
    )
      .then((tags) => {
        if (!cancelled) dispatch(setTags(tags));
      })
      .catch((error) => logger.error("Failed to fetch steam tags", error));

    return () => {
      cancelled = true;
    };
  }, [dispatch, enabled, i18n.language, tagNames]);

  return useMemo(
    () =>
      new Map(
        Object.entries(tagNames ?? {}).map(([name, id]) => [id, name] as const)
      ),
    [tagNames]
  );
};

// Renderer-only: needs the redux Provider for the library and tag names.
export const useSimilarGameViews = (query: SimilarGamesQuery) => {
  const { games, isLoading, isEligible } = useSimilarGames(query);
  const tagNameById = useSteamTagNames(
    isEligible && query.source !== "original"
  );
  const { library } = useLibrary();
  const ownedKeys = useMemo(
    () => new Set(library.map((game) => similarGameKey(game))),
    [library]
  );
  const views = useMemo(
    () => buildSimilarGameViews(games, ownedKeys, tagNameById),
    [games, ownedKeys, tagNameById]
  );

  return { games: views, isLoading, isEligible };
};
