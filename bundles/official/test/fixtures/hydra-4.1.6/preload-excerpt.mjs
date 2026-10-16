// Excerpt from Hydra 4.1.6 out/preload/index.mjs (MIT, github.com/hydralauncher/hydra), trimmed for Revamp's patch tests.
import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electron", {
  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences) => ipcRenderer.invoke("updateUserPreferences", preferences),
  autoLaunch: (autoLaunchProps) => ipcRenderer.invoke("autoLaunch", autoLaunchProps)
});
