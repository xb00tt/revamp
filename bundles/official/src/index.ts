import type { Manifest } from "@revamp/sdk";
import { hydra } from "./apps.ts";
import { recentlyDownloadedSort } from "./hydra/recently-downloaded-sort.ts";
import { disableSelfUpdate } from "./universal/disable-self-update.ts";
import { sideBySideIdentity } from "./universal/side-by-side-identity.ts";

export const manifest: Manifest = {
  name: "Revamp official",
  version: "0.1.0",
  minEngine: "0.1.0",
  author: "xb00tt",
  license: "GPL-3.0-only",
  source: "github:xb00tt/revamp",
};

export const apps = [hydra];
export const patches = [disableSelfUpdate, sideBySideIdentity, recentlyDownloadedSort];
