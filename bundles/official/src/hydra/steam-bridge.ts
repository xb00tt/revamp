import { definePatch, fingerprint } from "@revamp-app/sdk";

// scripts/build.ts replaces this name with the compiled bridge (src/hydra/steam-bridge/main.ts). Unit tests import
// the source directly, where it is undefined and a placeholder stands in.
declare const __REVAMP_HYDRA_STEAM_BRIDGE__: string | undefined;

export const STEAM_BRIDGE =
  typeof __REVAMP_HYDRA_STEAM_BRIDGE__ === "string"
    ? __REVAMP_HYDRA_STEAM_BRIDGE__
    : "var __revampSteamBridge = { registerSteamBridge() {} }; // Revamp Steam bridge (not built)\n";

export const ipcRegistration = fingerprint({
  name: "IPC handler registration",
  strings: ["ipcMain.handle(", "JSON.parse(JSON.stringify("],
  pattern: "const $REGISTER = ($NAME, $LISTENER) => { $IPC.handle($NAME, $$$); }",
});

export const mainLogger = fingerprint({
  name: "main logger",
  strings: ['.scope("main")'],
  pattern: 'const $LOGGER = $LOG.scope("main")',
  where: { "in the main process": (m) => m.file.startsWith("out/main/") },
});

export const preloadApi = fingerprint({
  name: "preload electron API",
  strings: ['exposeInMainWorld("electron"', '"getUserPreferences"'],
  pattern: '$BRIDGE.exposeInMainWorld("electron", { getUserPreferences: () => $IPC.invoke("getUserPreferences") })',
});

/**
 * Internal "Steam bridge": Steam data for the More like this patches, fetched in Hydra's main process (the renderer
 * can't reach Steam) and exposed to the renderer through two preload functions.
 */
export const steamBridge = definePatch({
  description: "Steam bridge",
  execute(ctx) {
    const reg = ctx.match(ipcRegistration);
    const logger = ctx.match(mainLogger);
    if (reg.file !== logger.file || logger.start >= reg.start) {
      throw new Error(
        `the main logger (${logger.file}:${logger.line}) must be declared before registerEvent (${reg.file}:${reg.line})`,
      );
    }
    reg.insertAfter(`${STEAM_BRIDGE}\n__revampSteamBridge.registerSteamBridge(${reg.$REGISTER}, ${logger.$LOGGER});`);

    const api = ctx.match(preloadApi);
    api.find(`getUserPreferences: () => ${api.$IPC}.invoke("getUserPreferences")`).insertAfter(
      [
        `revampGetSteamAppTags: (objectId) => ${api.$IPC}.invoke("revamp:getSteamAppTags", objectId)`,
        `revampGetSteamRecommendations: (objectId) => ${api.$IPC}.invoke("revamp:getSteamRecommendations", objectId)`,
      ].join(", "),
    );
  },
});
