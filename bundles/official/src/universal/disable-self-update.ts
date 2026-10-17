import { definePatch, fingerprint } from "@revamp-app/sdk";

/** electron-updater's gate: when it returns false, checkForUpdates() resolves null and nothing is downloaded. */
export const updaterActive = fingerprint({
  name: "electron-updater isUpdaterActive",
  strings: ["isUpdaterActive()"],
  scope: "all",
  count: "many",
  pattern: "isUpdaterActive() { $$$BODY }",
});

export const disableSelfUpdate = definePatch({
  name: "Disable self-update",
  description:
    "Turns off the app's built-in updater (electron-updater), so it never installs releases over the stock app. Revamp handles updates instead.",
  execute(ctx) {
    for (const m of ctx.matchAll(updaterActive)) m.$BODY.replace("return false;");
  },
});
