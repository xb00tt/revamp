import { defineApp } from "@revamp-app/sdk";
import { disableSelfUpdate } from "./universal/disable-self-update.ts";
import { sideBySideIdentity } from "./universal/side-by-side-identity.ts";

export const hydra = defineApp({
  id: "hydra",
  name: "Hydra",
  release: { github: "hydralauncher/hydra", tag: "v{version}", asset: "hydralauncher_{version}_amd64.deb" },
  installDir: "opt/Hydra",
  executable: "hydralauncher",
  desktopFile: "usr/share/applications/hydralauncher.desktop",
  versions: {
    "4.1.6": { sha256: "fc075d4c9334fa7462cdfe4faef625f61e6933df48fa03e1939b635951147363" },
  },
  required: [disableSelfUpdate, sideBySideIdentity],
});

/** From the Heroic-2.22.3-linux-amd64.deb listing: no symlinks; icons from 16x16 to 1024x1024. */
export const heroic = defineApp({
  id: "heroic",
  name: "Heroic",
  release: { github: "Heroic-Games-Launcher/HeroicGamesLauncher", tag: "v{version}", asset: "Heroic-{version}-linux-amd64.deb" },
  installDir: "opt/Heroic",
  executable: "heroic",
  desktopFile: "usr/share/applications/heroic.desktop",
  versions: {
    "2.22.3": { sha256: "f89eed7e0eb900fbe3051edfedbe7532db14328241cbf8c1fb766462dfc0b849" },
  },
  required: [disableSelfUpdate, sideBySideIdentity],
});
