import { definePatch } from "@revamp/sdk";
import { hydra } from "../apps.ts";
import { useBundledUi } from "./bundled-ui.ts";
import { hydraLocales } from "./locales.ts";
import {
  libraryFilterOption,
  librarySortList,
  librarySortSwitch,
  octiconDownload,
  sidebarSortEntry,
  sidebarSortSet,
} from "./recently-downloaded-sort.ts";

/** Octicons 19 `calendar` at 16 px (MIT), the icon the fork uses. Stock Hydra doesn't ship it. */
const CALENDAR_16 =
  "M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Zm10.75-4H2.75a.25.25 0 0 0-.25.25V6h11V3.75a.25.25 0 0 0-.25-.25Z";
const CALENDAR_ICON = "CalendarIcon$revamp";

export const recentlyAddedSort = definePatch({
  name: "Recently added sort",
  description: "Adds 'Recently added' (newest first; games without an added date last) to the library and sidebar sort menus.",
  compatibleWith: [{ app: hydra, versions: ["4.1.6"] }],
  dependsOn: [useBundledUi, hydraLocales],
  execute(ctx) {
    // Same five places as Recently downloaded sort. Inserts at the same spot keep patch order, and patches run in
    // name order, so the menus read: Recently played, Recently added, Recently downloaded.
    const sort = ctx.match(librarySortSwitch);
    // A missing or unreadable date counts as 0 (1970), so those games sort last, then by title like every sort.
    const added = (game: string) => `(new Date(${game}.addedToLibraryAt ?? 0).getTime() || 0)`;
    sort.find('case "recently_played": { $$$ }').insertAfter(
      `case "recently_added": {\n` +
        `        const difference = ${added(`${sort.$B}`)} - ${added(`${sort.$A}`)};\n` +
        `        if (difference !== 0) return difference;\n` +
        `        break;\n` +
        `      }`,
    );

    const icon = ctx.match(octiconDownload);
    const entry = ctx.match(sidebarSortEntry);
    if (icon.file !== entry.file) throw new Error(`DownloadIcon (${icon.file}) and the sidebar sort menu (${entry.file}) are in different files`);
    icon.insertAfter(
      `var ${CALENDAR_ICON} = ${icon.$CREATE}("CalendarIcon", "octicon octicon-calendar", function() {\n` +
        `  return { "16": { "width": 16, "path": ${entry.$JSX}.jsx("path", { d: "${CALENDAR_16}" }) } };\n` +
        `});`,
    );
    entry.insertAfter(
      `{ value: "recently_added", label: ${entry.$T}("sort_recently_added", { ns: "library" }), icon: ${entry.$JSX}.jsx(${CALENDAR_ICON}, { size: 14 }) }`,
    );

    ctx.match(sidebarSortSet).find('"recently_played"').insertAfter('"recently_added"');
    ctx.match(librarySortList).find('"recently_played"').insertAfter('"recently_added"');

    const option = ctx.match(libraryFilterOption);
    option.insertAfter(`{ value: "recently_added", label: ${option.$T}("sort_recently_added") }`);
  },
});
