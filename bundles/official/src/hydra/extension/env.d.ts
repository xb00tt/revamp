// Globals the ported fork code uses in Hydra's renderer.
interface Window {
  electron: {
    hydraApi: {
      get<T>(path: string, options?: unknown): Promise<T>;
      post<T>(path: string, options?: unknown): Promise<T>;
    };
  };
}

/** Stylesheets are injected as a <style> element when the extension loads (see scripts/extension.ts). */
declare module "*.css";
