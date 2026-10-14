// Excerpts from Heroic 2.22.3 build/main/main.js (GPL-3.0-only, github.com/Heroic-Games-Launcher/HeroicGamesLauncher),
// trimmed for Revamp's patch tests: the bundled electron-updater and the protocol registration.
"use strict";
const require$$1$5 = require("electron");
class AppUpdater {
  checkForUpdates() {
    if (!this.isUpdaterActive()) {
      return Promise.resolve(null);
    }
    return this.doCheckForUpdates();
  }
  isUpdaterActive() {
    const isEnabled2 = this.app.isPackaged || this.forceDevUpdateConfig;
    if (!isEnabled2) {
      this._logger.info("Skip checkForUpdates because application is not packed and dev update config is not forced");
      return false;
    }
    return true;
  }
}
class AppImageUpdater extends AppUpdater {
  isUpdaterActive() {
    if (process.env["APPIMAGE"] == null && !this.forceDevUpdateConfig) {
      if (process.env["SNAP"] == null) {
        this._logger.warn("APPIMAGE env is not defined, current application is not an AppImage");
      } else {
        this._logger.info("SNAP env is defined, updater is disabled");
      }
      return false;
    }
    return super.isUpdaterActive();
  }
}
function registerProtocol() {
  if (process.env.CI !== "e2e" && !require$$1$5.app.isDefaultProtocolClient("heroic")) {
    if (require$$1$5.app.setAsDefaultProtocolClient("heroic")) {
      logInfo("Registered protocol with OS.", LogPrefix.Backend);
    } else {
      logWarning("Failed to register protocol with OS.", LogPrefix.Backend);
    }
  } else {
    logWarning("Protocol already registered.", LogPrefix.Backend);
  }
}
