import { defineApp } from "@revamp/sdk";
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
