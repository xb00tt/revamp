"use strict";
// Excerpt from electron-updater 6.6.2 out/AppUpdater.js (MIT), trimmed for Revamp's patch tests.
class AppUpdater {
    isUpdaterActive() {
        const isEnabled = this.app.isPackaged || this.forceDevUpdateConfig;
        if (!isEnabled) {
            this._logger.info("Skip checkForUpdates because application is not packed and dev update config is not forced");
            return false;
        }
        return true;
    }
    checkForUpdates() {
        if (!this.isUpdaterActive()) {
            return Promise.resolve(null);
        }
        return this.doCheckForUpdates();
    }
}
exports.AppUpdater = AppUpdater;
