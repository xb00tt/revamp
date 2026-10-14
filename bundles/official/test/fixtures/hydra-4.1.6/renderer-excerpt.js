// Excerpts from Hydra 4.1.6 out/renderer/assets/index-Cpo9haoY.js (MIT, github.com/hydralauncher/hydra),
// trimmed for Revamp's patch tests. The last two blocks are decoys the patches must not touch.
const sortLibraryGames$1 = /* @__PURE__ */ __name((games, sortBy2) => {
  return [...games].sort((a2, b2) => {
    switch (sortBy2) {
      case "recently_played": {
        const difference = getPlayTimeDifference(a2, b2);
        if (difference !== 0) return difference;
        break;
      }
      case "most_played": {
        const difference = getMostPlayedDifference(a2, b2);
        if (difference !== 0) return difference;
        break;
      }
      case "title_desc": {
        return compareLibraryGamesByTitle(a2, b2, false);
      }
    }
    return compareLibraryGamesByTitle(a2, b2);
  });
}, "sortLibraryGames$1");
var ClockIcon = /* @__PURE__ */ createIconComponent("ClockIcon", "octicon octicon-clock", function() {
  return {};
});
var DownloadIcon = /* @__PURE__ */ createIconComponent("DownloadIcon", "octicon octicon-download", function() {
  return {};
});
function SidebarFilterMenu({ sortBy: sortBy2 }) {
  const { t: t2 } = useTranslation(["sidebar", "library"]);
  const sortOptions = [
    {
      value: "title_asc",
      label: t2("sort_title", { ns: "library" }),
      icon: /* @__PURE__ */ jsxRuntimeExports.jsx(SortDescIcon, { size: 14 })
    },
    {
      value: "recently_played",
      label: t2("recently_played", { ns: "library" }),
      icon: /* @__PURE__ */ jsxRuntimeExports.jsx(ClockIcon, { size: 14 })
    },
    {
      value: "most_played",
      label: t2("sort_most_played", { ns: "library" }),
      icon: /* @__PURE__ */ jsxRuntimeExports.jsx(HourglassIcon, { size: 14 })
    }
  ];
  return sortOptions;
}
const SIDEBAR_SORT_OPTIONS = /* @__PURE__ */ new Set([
  "title_asc",
  "recently_played",
  "most_played",
  "achievements"
]);
function readSidebarSortBy() {
  const saved = localStorage.getItem("sidebar-sort-by");
  return SIDEBAR_SORT_OPTIONS.has(saved) ? saved : "title_asc";
}
function FilterOptions({
  sortBy: sortBy2,
  onSortChange
}) {
  const { t: t2 } = useTranslation("library");
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    LibrarySelect,
    {
      value: sortBy2,
      ariaLabel: t2("sort_by"),
      options: [
        { value: "title_asc", label: t2("sort_title_asc") },
        { value: "recently_played", label: t2("recently_played") },
        { value: "most_played", label: t2("sort_most_played") },
        { value: "title_desc", label: t2("sort_title_desc") }
      ]
    }
  );
}
const SORT_OPTIONS$1 = [
  "title_asc",
  "recently_played",
  "most_played",
  "achievements",
  "installed_first",
  "title_desc"
];
function readLibrarySortBy() {
  const savedSortBy = localStorage.getItem("library-sort-by");
  return savedSortBy && SORT_OPTIONS$1.includes(savedSortBy) ? savedSortBy : "title_asc";
}
function sortLibraryGames(library2, sortBy2) {
  return [...library2].sort((a2, b2) => {
    if (sortBy2 === "last_played") {
      return sortByLastPlayed(a2, b2);
    }
    return compareTitles(a2, b2);
  });
}
const BIG_PICTURE_FILTERS = [
  { value: "recently_played", label: "Recent", focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_RECENTLY_PLAYED_ID },
  { value: "favorites", label: "Favorites", focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_FAVORITES_ID }
];
