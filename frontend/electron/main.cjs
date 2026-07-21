const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { createConfigStore, resolveGmatInstallation } = require("./main/configStore.cjs");
const { validateSubmission } = require("./main/validationService.cjs");
const { createValidationWorker } = require("./main/validationWorker.cjs");

const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL || (
  app.isPackaged ? null : "http://127.0.0.1:5173"
);
const cloudApiBaseUrl = (
  process.env.MISSION_DASHBOARD_API_BASE_URL
  ?? "https://missiondashboard.fastapicloud.dev/api"
).replace(/\/$/, "");
const workerToken = process.env.MISSION_DASHBOARD_WORKER_TOKEN?.trim() ?? "";
const runtimeRole = workerToken ? "worker" : "client";
let validationWorker = null;

function createWindow() {
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
  const runtimeParams = new URLSearchParams({ runtimeRole });
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
  ipcMain.handle("runtime:get-config", () => ({
    role: runtimeRole,
    cloudApiBaseUrl,
  }));
  const configStore = createConfigStore(app);
  if (runtimeRole === "worker") {
    const currentConfig = configStore.read();
    const workerId = currentConfig.workerId ?? `GMAT-${crypto.randomUUID()}`;
    if (!currentConfig.workerId) configStore.write({ workerId });
    validationWorker = createValidationWorker({
      apiBaseUrl: cloudApiBaseUrl,
      workerToken,
      workerId,
      readConfig: () => configStore.read(),
    });
    validationWorker.start();
  }
  ipcMain.handle("cloud:admin-request", async (_event, pathName, options = {}) => {
    if (!workerToken || !/^\/scenarios(?:\/|$)/.test(pathName)) {
      throw new Error("Scenario administration is not enabled on this computer.");
    }
    const response = await fetch(`${cloudApiBaseUrl}${pathName}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": workerToken,
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? `Cloud request failed (${response.status}).`);
    return payload;
  });
  ipcMain.handle("gmat:get-config", () => configStore.read());
  ipcMain.handle("gmat:select-installation", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Select GMAT installation or api folder" });
    if (result.canceled) return configStore.read();
    return configStore.write(resolveGmatInstallation(result.filePaths[0]));
  });
  ipcMain.handle("gmat:save-config", (_event, config) => {
    const pathConfig = config.gmatInstallationPath
      ? resolveGmatInstallation(config.gmatInstallationPath)
      : config;
    return configStore.write({ ...config, ...pathConfig });
  });
  ipcMain.handle("gmat:validate-submission", async (_event, request) => {
    const config = configStore.read();
    return validateSubmission({ ...request, executablePath: config.executablePath, timeoutMs: Number(config.timeoutMs ?? 120000), keepTemporaryFiles: Boolean(config.keepTemporaryFiles) });
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  validationWorker?.stop();
});
