import { definePatch, fingerprint } from "@revamp/sdk";
import { hydra } from "../apps.ts";
import { useBundledUi } from "./bundled-ui.ts";

export const librarySortSwitch = fingerprint({
  name: "library sort switch",
  strings: ['"recently_played"', '"most_played"'],
  pattern: '[...$GAMES].sort(($A, $B) => { switch ($BY) { case "recently_played": { $$$ } } $$$ })',
});

export const octiconDownload = fingerprint({
  name: "octicon DownloadIcon",
  strings: ['"octicon octicon-download"'],
  pattern: 'var $ICON = $CREATE("DownloadIcon", "octicon octicon-download", $$$)',
});

export const sidebarSortEntry = fingerprint({
  name: "sidebar sort menu entry",
  strings: ['"recently_played"', '"sort_most_played"'],
  pattern: '({ value: "recently_played", label: $T("recently_played", { ns: "library" }), icon: $JSX.jsx($ICON, { size: 14 }) })',
});

export const sidebarSortSet = fingerprint({
  name: "sidebar allowed sorts",
  strings: ['"recently_played"', '"sidebar-sort-by"'],
  pattern: 'new Set([$$$, "recently_played", $$$])',
});

export const librarySortList = fingerprint({
  name: "library allowed sorts",
  strings: ['"recently_played"', '"library-sort-by"'],
  pattern: 'const $OPTS = [$$$, "recently_played", $$$]',
});

export const libraryFilterOption = fingerprint({
  name: "library sort menu entry",
  strings: ['"recently_played"', '"sort_title_asc"'],
  pattern: '({ value: "recently_played", label: $T("recently_played") })',
});

const LABEL = "Recently downloaded";

export const recentlyDownloadedSort = definePatch({
  name: "Recently downloaded sort",
  description: "Adds 'Recently downloaded' (newest download first) to the library and sidebar sort menus.",
  compatibleWith: [{ app: hydra, versions: ["4.1.6"] }],
  dependsOn: [useBundledUi], // edits the bundled renderer, which Hydra only loads with this patch
  execute(ctx) {
    const sort = ctx.match(librarySortSwitch);
    sort.find('case "recently_played": { $$$ }').insertAfter(
      `case "recently_downloaded": {\n` +
        `        const difference = (${sort.$B}.download?.timestamp ?? 0) - (${sort.$A}.download?.timestamp ?? 0);\n` +
        `        if (difference !== 0) return difference;\n` +
        `        break;\n` +
        `      }`,
    );

    const icon = ctx.match(octiconDownload);
    const entry = ctx.match(sidebarSortEntry);
    if (icon.file !== entry.file) throw new Error(`DownloadIcon (${icon.file}) and the sidebar sort menu (${entry.file}) are in different files`);
    entry.insertAfter(
      `{ value: "recently_downloaded", label: ${entry.$T}("sort_recently_downloaded", { ns: "library", defaultValue: "${LABEL}" }), icon: ${entry.$JSX}.jsx(${icon.$ICON}, { size: 14 }) }`,
    );

    ctx.match(sidebarSortSet).find('"recently_played"').insertAfter('"recently_downloaded"');
    ctx.match(librarySortList).find('"recently_played"').insertAfter('"recently_downloaded"');

    const option = ctx.match(libraryFilterOption);
    option.insertAfter(`{ value: "recently_downloaded", label: ${option.$T}("sort_recently_downloaded", { defaultValue: "${LABEL}" }) }`);
  },
});
