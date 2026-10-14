// Excerpts from Hydra 4.1.6 out/renderer/assets/index-Cpo9haoY.js (MIT, github.com/hydralauncher/hydra), trimmed for
// Revamp's More like this tests: the stock section, the internals it is built from, the catalogue's tag lookup and the
// root render. Library code is cut down to its declaration; Big Picture's direct tag request is a decoy.
var jsxRuntimeExports = requireJsxRuntime();
var reactExports$1 = requireReact$1();
const React = /* @__PURE__ */ getDefaultExportFromCjs$1(reactExports$1);
function useNavigate() {
  let {
    isDataRoute
  } = reactExports$1.useContext(RouteContext);
  return isDataRoute ? useNavigateStable() : useNavigateUnstable();
}
const useTranslation = /* @__PURE__ */ __name(function(ns) {
  let props = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
  return useTranslationWithContext(ns, props);
}, "useTranslation");
function useEmblaCarousel(options = {}, plugins = []) {
  return [viewport, emblaApi];
}
function Skeleton$1({ count = 1, className: customClassName, ...props }) {
  return null;
}
var ChevronLeftIcon = /* @__PURE__ */ createIconComponent("ChevronLeftIcon", "octicon octicon-chevron-left", function() {
  return {};
});
var ChevronRightIcon = /* @__PURE__ */ createIconComponent("ChevronRightIcon", "octicon octicon-chevron-right", function() {
  return {};
});
const catalogueSearchSlice = createSlice({
  name: "catalogueSearch",
  initialState: initialState$h,
  reducers: {
    setTags: /* @__PURE__ */ __name((state, action) => {
      state.steamUserTags = action.payload;
    }, "setTags")
  }
});
const {
  setFilters,
  setTags,
  setGenres
} = catalogueSearchSlice.actions;
class LevelDBService {
  values(sublevelName) {
    return window.electron.leveldb.values(sublevelName);
  }
}
const levelDBService = new LevelDBService();
const logger = log$2.scope("renderer");
function orderBy$1(collection, iteratees, orders, guard) {
  return baseOrderBy(collection, iteratees, orders);
}
const useAppDispatch$1 = useDispatch;
const useAppSelector$1 = useSelector;
function useLibrary$1() {
  const dispatch = useAppDispatch$1();
  const library2 = useAppSelector$1((state) => state.library.value);
  const downloadLibrary = useAppSelector$1(
    (state) => state.library.downloadLibrary
  );
  const updateLibrary = reactExports$1.useCallback(async () => {
    return window.electron.getLibrary(true).then((updatedLibrary) => dispatch(setLibrary(updatedLibrary)));
  }, [dispatch]);
  return { library: library2, downloadLibrary, updateLibrary };
}
__name(useLibrary$1, "useLibrary$1");
function VerticalCoverCard({
  gameTitle,
  coverImageUrls,
  children,
  useClassicsLayout = false,
  showTitleTooltip = true,
  className,
  ...buttonProps
}) {
  return null;
}
const buildGameDetailsPath = /* @__PURE__ */ __name((game, params = {}) => {
  const searchParams = new URLSearchParams({ title: game.title, ...params });
  return `/game/${game.shop}/${game.objectId}?${searchParams.toString()}`;
}, "buildGameDetailsPath");
async function getLocalizedSteamMetadata(endpoint, locale2) {
  const language = locale2.split("-")[0] || "en";
  const requestLanguage = SUPPORTED_STEAM_METADATA_LANGUAGES.has(language) ? language : "en";
  const languages = requestLanguage === "en" ? ["en"] : ["en", requestLanguage];
  const entries = await Promise.all(
    languages.map(async (currentLanguage) => {
      const data = await window.electron.hydraApi.get(endpoint, {
        params: { language: currentLanguage },
        needsAuth: false
      });
      return [currentLanguage, data];
    })
  );
  const metadata = Object.fromEntries(entries);
  metadata[language] ??= metadata[requestLanguage];
  return metadata;
}
__name(getLocalizedSteamMetadata, "getLocalizedSteamMetadata");
function useCatalogue() {
  const dispatch = useAppDispatch$1();
  const { i18n } = useTranslation();
  const getSteamFilters = reactExports$1.useCallback(async () => {
    const [tags2, genres] = await Promise.all([
      getLocalizedSteamMetadata(
        "/catalogue/steam/tags",
        i18n.language
      ),
      getLocalizedSteamMetadata(
        "/catalogue/steam/genres",
        i18n.language
      )
    ]);
    dispatch(setTags(tags2));
    dispatch(setGenres(genres));
  }, [dispatch, i18n.language]);
  return { getSteamFilters };
}
const useSimilarGames = /* @__PURE__ */ __name((query) => {
  const [games, setGames] = reactExports$1.useState([]);
  const [isLoading, setIsLoading] = reactExports$1.useState(false);
  const [resultQueryKey, setResultQueryKey] = reactExports$1.useState("");
  const requestIdRef = reactExports$1.useRef(0);
  const { objectId, shop } = query;
  const queryKey = `${shop}:${objectId}`;
  const isEligible = Boolean(objectId) && (shop === "steam" || shop === "launchbox");
  reactExports$1.useEffect(() => {
    const requestId = ++requestIdRef.current;
    const stableQuery = { objectId, shop };
    setGames([]);
    setResultQueryKey(queryKey);
    if (!isEligible) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const get3 = /* @__PURE__ */ __name((path2, options) => globalThis.window.electron.hydraApi.get(path2, options), "get");
    const loadSimilarGames = /* @__PURE__ */ __name(async () => {
      const sources = await levelDBService.values(
        "downloadSources"
      );
      if (requestId !== requestIdRef.current) return;
      const downloadSourceIds = orderBy$1(sources, "createdAt", "desc").map(
        (source) => source.id
      );
      const results = await fetchSimilarGames(
        stableQuery,
        get3,
        downloadSourceIds
      );
      if (requestId === requestIdRef.current) setGames(results);
    }, "loadSimilarGames");
    void loadSimilarGames().catch((error2) => {
      if (requestId !== requestIdRef.current) return;
      logger.error("Failed to fetch similar games", error2);
      setGames([]);
    }).finally(() => {
      if (requestId === requestIdRef.current) setIsLoading(false);
    });
    return () => {
      requestIdRef.current += 1;
    };
  }, [isEligible, objectId, queryKey, shop]);
  const hasCurrentResults = resultQueryKey === queryKey;
  return {
    games: hasCurrentResults ? games : [],
    isLoading: isEligible && (!hasCurrentResults || isLoading),
    isEligible
  };
}, "useSimilarGames");
const GAMES_PER_PAGE = 3;
function SimilarGamesSlide({ children }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__slide", children });
}
__name(SimilarGamesSlide, "SimilarGamesSlide");
function SimilarGamesSkeleton$1() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__carousel", "aria-busy": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__viewport", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__container", children: Array.from({ length: GAMES_PER_PAGE }, (_2, index2) => /* @__PURE__ */ jsxRuntimeExports.jsx(SimilarGamesSlide, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Skeleton$1, { className: "similar-games__skeleton" }) }, `similar-game-skeleton-${index2}`)) }) }) });
}
__name(SimilarGamesSkeleton$1, "SimilarGamesSkeleton$1");
function SimilarGames({ objectId, shop }) {
  const navigate = useNavigate();
  const { t: t2 } = useTranslation("game_details");
  const { games, isLoading, isEligible } = useSimilarGames({ objectId, shop });
  const sectionState = getSimilarGamesSectionState(
    isEligible,
    isLoading,
    games.length
  );
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: GAMES_PER_PAGE,
    duration: 20
  });
  const [canScrollPrev, setCanScrollPrev] = reactExports$1.useState(false);
  const [canScrollNext, setCanScrollNext] = reactExports$1.useState(false);
  const syncControls = reactExports$1.useCallback(() => {
    setCanScrollPrev(emblaApi?.canScrollPrev() ?? false);
    setCanScrollNext(emblaApi?.canScrollNext() ?? false);
  }, [emblaApi]);
  reactExports$1.useEffect(() => {
    if (!emblaApi) return;
    syncControls();
    emblaApi.on("select", syncControls);
    emblaApi.on("reInit", syncControls);
    return () => {
      emblaApi.off("select", syncControls);
      emblaApi.off("reInit", syncControls);
    };
  }, [emblaApi, syncControls]);
  reactExports$1.useEffect(() => {
    emblaApi?.scrollTo(0, true);
  }, [emblaApi, objectId, shop]);
  if (sectionState === "hidden") return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "similar-games", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "similar-games__title", children: t2("similar_games") }),
    sectionState === "loading" ? /* @__PURE__ */ jsxRuntimeExports.jsx(SimilarGamesSkeleton$1, {}) : null,
    sectionState === "empty" ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__empty", role: "status", children: t2("no_similar_games") }) : null,
    sectionState === "ready" ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__carousel", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "similar-games__viewport", ref: emblaRef, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "similar-games__container", children: games.map((similarGame) => /* @__PURE__ */ jsxRuntimeExports.jsx(
        SimilarGamesSlide,
        {
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            VerticalCoverCard,
            {
              className: "similar-games__card",
              gameTitle: similarGame.title,
              coverImageUrls: [
                similarGame.coverImageUrl,
                similarGame.libraryImageUrl,
                similarGame.iconUrl
              ],
              useClassicsLayout: similarGame.shop === "launchbox",
              showTitleTooltip: false,
              onClick: /* @__PURE__ */ __name(() => navigate(buildGameDetailsPath(similarGame)), "onClick")
            }
          )
        },
        `${similarGame.shop}:${similarGame.objectId}`
      )) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "similar-games__control similar-games__control--previous",
          "aria-label": t2("previous_media"),
          disabled: !canScrollPrev,
          onClick: /* @__PURE__ */ __name(() => emblaApi?.scrollPrev(), "onClick"),
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronLeftIcon, { size: 36 })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "similar-games__control similar-games__control--next",
          "aria-label": t2("next_media"),
          disabled: !canScrollNext,
          onClick: /* @__PURE__ */ __name(() => emblaApi?.scrollNext(), "onClick"),
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronRightIcon, { size: 36 })
        }
      )
    ] }) }) : null
  ] });
}
__name(SimilarGames, "SimilarGames");
async function loadBigPictureFilters() {
  return Promise.allSettled([
    globalThis.window.electron.hydraApi.get(
      "/catalogue/steam/genres",
      { params: { language: "en" }, needsAuth: false }
    ),
    globalThis.window.electron.hydraApi.get(
      "/catalogue/steam/tags",
      { params: { language: "en" }, needsAuth: false }
    )
  ]);
}
ReactDOM$1.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(React.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Provider_default, { store, children: /* @__PURE__ */ jsxRuntimeExports.jsx(App$1, {}) }) })
);
