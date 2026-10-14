// Excerpt from Hydra 4.1.6 out/main/index.js (MIT, github.com/hydralauncher/hydra), trimmed for Revamp's patch tests.
const PROTOCOL = "hydralauncher";
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app$z.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
            path.resolve(process.argv[1])
        ]);
    }
} else {
    app$z.setAsDefaultProtocolClient(PROTOCOL);
}
class WindowManager {
  static async loadWindowURL(window, hash = "") {
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#/${hash}`);
    } else {
      try {
        await window.loadURL(`https://release-v${this.formatVersionNumber(app$z.getVersion())}.${"hydra-eqi.pages.dev"}#/${hash}`);
      } catch (error) {
        logger.error("Failed to load from MAIN_VITE_LAUNCHER_SUBDOMAIN, falling back to local file:", error);
        window.loadFile(path.join(__dirname, "../renderer/index.html"), {
          hash
        });
      }
    }
  }
}
