import type { Manifest } from "@revamp/sdk";
import { heroic, hydra } from "./apps.ts";
import { hideDealsLink } from "./heroic/hide-deals-link.ts";
import { useBundledUi } from "./hydra/bundled-ui.ts";
import { moreLikeThisRanking } from "./hydra/more-like-this.ts";
import { recentlyAddedSort } from "./hydra/recently-added-sort.ts";
import { recentlyDownloadedSort } from "./hydra/recently-downloaded-sort.ts";
import { disableSelfUpdate } from "./universal/disable-self-update.ts";
import { sideBySideIdentity } from "./universal/side-by-side-identity.ts";

export const manifest: Manifest = {
  name: "Revamp official",
  version: "0.3.0",
  minEngine: "0.2.0", // Hydra locales uses Match.resolve()
  author: "xb00tt",
  license: "GPL-3.0-only",
  source: "github:xb00tt/revamp",
};

export const apps = [hydra, heroic];
export const patches = [
  disableSelfUpdate,
  sideBySideIdentity,
  useBundledUi,
  recentlyAddedSort,
  recentlyDownloadedSort,
  moreLikeThisRanking,
  hideDealsLink,
];
