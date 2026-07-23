const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("missionDashboardDesktop", {
  getGmatConfig: () => ipcRenderer.invoke("gmat:get-config"),
  selectGmatInstallation: () => ipcRenderer.invoke("gmat:select-installation"),
  saveGmatConfig: (config) => ipcRenderer.invoke("gmat:save-config", config),
  validateWithLocalGmat: (request) => ipcRenderer.invoke("gmat:validate-submission", request),
  generateGmatScript: (request) => ipcRenderer.invoke("gmat:generate-script", request),
  localAdminRequest: (path, options) => ipcRenderer.invoke("local:admin-request", path, options),
  getStartupSyncStatus: () => ipcRenderer.invoke("sync:get-startup-status"),
  onStartupSyncStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("sync:startup-status", listener);
    return () => ipcRenderer.removeListener("sync:startup-status", listener);
  },
  getAdminPasswordStatus: () => ipcRenderer.invoke("admin:password-status"),
  setAdminPassword: (request) => ipcRenderer.invoke("admin:set-password", request),
  getUpdateStatus: () => ipcRenderer.invoke("app:update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("app:update:check"),
  openUpdateReleases: () => ipcRenderer.invoke("app:update:open-releases"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },
});
