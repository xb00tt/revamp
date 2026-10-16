// Globals the ported fork code uses in Hydra's renderer.
interface Window {
  electron: {
    hydraApi: {
      get<T>(path: string, options?: unknown): Promise<T>;
      post<T>(path: string, options?: unknown): Promise<T>;
    };
    revampGetSteamAppTags(objectId: string): Promise<number[]>;
    revampGetSteamRecommendations(
      objectId: string
    ): Promise<import("../steam-bridge/main.ts").SteamRecommendation[]>;
    updateUserPreferences(values: Record<string, unknown>): Promise<unknown>;
  };
}

/** Stylesheets are injected as a <style> element when the extension loads (see scripts/extension.ts). */
declare module "*.css";
