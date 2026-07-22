const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("missionDashboardDesktop", {
  getRuntimeConfig: () => ipcRenderer.invoke("runtime:get-config"),
  getGmatConfig: () => ipcRenderer.invoke("gmat:get-config"),
  selectGmatInstallation: () => ipcRenderer.invoke("gmat:select-installation"),
  saveGmatConfig: (config) => ipcRenderer.invoke("gmat:save-config", config),
  validateWithLocalGmat: (request) => ipcRenderer.invoke("gmat:validate-submission", request),
  adminCloudRequest: (path, options) => ipcRenderer.invoke("cloud:admin-request", path, options),
  getUpdateStatus: () => ipcRenderer.invoke("app:update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("app:update:check"),
  openUpdateReleases: () => ipcRenderer.invoke("app:update:open-releases"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },
});
