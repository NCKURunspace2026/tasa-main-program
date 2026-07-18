const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("missionDashboardDesktop", {
  getRuntimeConfig: () => ipcRenderer.invoke("runtime:get-config"),
  getGmatConfig: () => ipcRenderer.invoke("gmat:get-config"),
  selectGmatInstallation: () => ipcRenderer.invoke("gmat:select-installation"),
  saveGmatConfig: (config) => ipcRenderer.invoke("gmat:save-config", config),
  validateWithLocalGmat: (request) => ipcRenderer.invoke("gmat:validate-submission", request),
});
