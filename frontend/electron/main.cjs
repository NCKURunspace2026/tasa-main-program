const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const {
  createConfigStore,
  createPasswordRecord,
  resolveGmatInstallation,
  verifyPassword,
} = require("./main/configStore.cjs");
const { validateSubmission } = require("./main/validationService.cjs");
const { startLocalBackend } = require("./main/localBackend.cjs");
const { createAppUpdater } = require("./main/appUpdater.cjs");

const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL || (
  app.isPackaged ? null : "http://127.0.0.1:5173"
);
let configStore = null;
let localBackend = null;
let activeLocalApiBaseUrl = null;

function publicDeviceConfig(config) {
  const publicConfig = { ...config };
  delete publicConfig.adminPasswordHash;
  delete publicConfig.adminPasswordSalt;
  return publicConfig;
}

function createWindow(localApiBaseUrl) {
  const iconPath = app.isPackaged
    ? path.join(__dirname, "..", "dist", "Team-Logo.png")
    : path.join(__dirname, "..", "public", "Team-Logo.png");
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const runtimeParams = new URLSearchParams({
    apiBaseUrl: localApiBaseUrl,
  });
  if (developmentRendererUrl) {
    window.loadURL(`${developmentRendererUrl}?${runtimeParams.toString()}`);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
      query: Object.fromEntries(runtimeParams),
    });
  }
}

app.whenReady().then(async () => {
  const appIconPath = app.isPackaged
    ? path.join(__dirname, "..", "dist", "Team-Logo.png")
    : path.join(__dirname, "..", "public", "Team-Logo.png");
  if (process.platform === "darwin" && fs.existsSync(appIconPath)) {
    app.dock.setIcon(nativeImage.createFromPath(appIconPath));
  }
  configStore = createConfigStore(app);
  localBackend = await startLocalBackend({ app });
  const localApiBaseUrl = localBackend.apiBaseUrl;
  activeLocalApiBaseUrl = localApiBaseUrl;
  createAppUpdater({
    app,
    dialog,
    ipcMain,
    shell,
    getWindows: () => BrowserWindow.getAllWindows(),
  });

  ipcMain.handle("local:admin-request", async (_event, pathName, options = {}) => {
    if (!/^\/(?:scenarios|solutions|data)(?:\/|$)/.test(pathName)) {
      throw new Error("This administration request is not allowed.");
    }
    const { adminPassword, ...requestOptions } = options;
    if (String(requestOptions.method ?? "GET").toUpperCase() === "DELETE") {
      const securityConfig = configStore.read();
      if (!securityConfig.adminPasswordHash) {
        throw new Error("Set a device administration password in Settings before removing a Solution.");
      }
      if (!verifyPassword(adminPassword, securityConfig)) {
        throw new Error("The device administration password is incorrect.");
      }
    }
    const response = await fetch(`${localApiBaseUrl}${pathName}`, {
      ...requestOptions,
      headers: {
        "Content-Type": "application/json",
        "X-Mission-Dashboard-Admin-Token": localBackend.adminToken,
        ...requestOptions.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? `Local request failed (${response.status}).`);
    return payload;
  });
  ipcMain.handle("gmat:get-config", () => publicDeviceConfig(configStore.read()));
  ipcMain.handle("admin:password-status", () => ({
    configured: Boolean(configStore.read().adminPasswordHash),
  }));
  ipcMain.handle("admin:set-password", (_event, request) => {
    const current = configStore.read();
    if (current.adminPasswordHash && !verifyPassword(request.currentPassword, current)) {
      throw new Error("The current device administration password is incorrect.");
    }
    configStore.write(createPasswordRecord(request.newPassword));
    return { configured: true };
  });
  ipcMain.handle("gmat:select-installation", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Select GMAT installation or api folder" });
    if (result.canceled) return publicDeviceConfig(configStore.read());
    return publicDeviceConfig(configStore.write(resolveGmatInstallation(result.filePaths[0])));
  });
  ipcMain.handle("gmat:save-config", (_event, config) => {
    const pathConfig = config.gmatInstallationPath
      ? resolveGmatInstallation(config.gmatInstallationPath)
      : config;
    const saved = configStore.write({ ...config, ...pathConfig });
    return publicDeviceConfig(saved);
  });
  ipcMain.handle("gmat:validate-submission", async (_event, request) => {
    const config = configStore.read();
    return validateSubmission({ ...request, executablePath: config.executablePath, timeoutMs: Number(config.timeoutMs ?? 120000), keepTemporaryFiles: Boolean(config.keepTemporaryFiles) });
  });
  createWindow(localApiBaseUrl);
}).catch((error) => {
  console.error(`[startup] ${error.stack ?? error.message}`);
  dialog.showErrorBox("Mission Dashboard could not start", error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && activeLocalApiBaseUrl) {
    createWindow(activeLocalApiBaseUrl);
  }
});

app.on("before-quit", () => {
  localBackend?.process?.kill();
});
