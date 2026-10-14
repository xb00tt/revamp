"use strict";
// Excerpt from electron-updater 6.6.2 out/AppImageUpdater.js (MIT), trimmed for Revamp's patch tests.
class AppImageUpdater extends BaseUpdater_1.BaseUpdater {
    isUpdaterActive() {
        if (process.env["APPIMAGE"] == null) {
            this._logger.warn("APPIMAGE env is not defined, current application is not an AppImage");
            return false;
        }
        return super.isUpdaterActive();
    }
}
exports.AppImageUpdater = AppImageUpdater;
