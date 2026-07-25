const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const {
  createConfigStore,
  resolveGmatInstallation,
} = require("./main/configStore.cjs");
const { generateGmatScript } = require("./main/scriptGenerator.cjs");
const { validateSubmission } = require("./main/validationService.cjs");
const { startLocalBackend } = require("./main/localBackend.cjs");
const { createAppUpdater } = require("./main/appUpdater.cjs");

const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL || (
  app.isPackaged ? null : "http://127.0.0.1:5173"
);
let configStore = null;
let localBackend = null;
let activeLocalApiBaseUrl = null;
let startupSyncStatus = {
  state: "pending",
  message: "Startup synchronization check has not run yet.",
  checkedAt: null,
  result: null,
};
let backgroundSyncTimer = null;
let activeSyncRun = null;

function safeFileNamePart(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function createUniqueOutputDirectory(parentDirectory, baseName) {
  let candidate = path.join(parentDirectory, baseName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDirectory, `${baseName}_${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(candidate, { recursive: false });
  return candidate;
}

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

function publishStartupSyncStatus(status) {
  startupSyncStatus = { ...startupSyncStatus, ...status };
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("sync:startup-status", startupSyncStatus);
  });
}

function runStartupSyncCheck(localApiBaseUrl) {
  if (activeSyncRun) return activeSyncRun;
  activeSyncRun = performSyncCheck(localApiBaseUrl).finally(() => {
    activeSyncRun = null;
  });
  return activeSyncRun;
}

async function performSyncCheck(localApiBaseUrl) {
  publishStartupSyncStatus({
    state: "running",
    message: "Checking the data relay after application startup...",
    checkedAt: new Date().toISOString(),
    result: null,
  });
  try {
    const response = await fetch(`${localApiBaseUrl}/sync/run`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? `Startup sync failed (${response.status}).`);
    publishStartupSyncStatus({
      state: payload?.status === "error" ? "error" : "ok",
      message: payload?.status === "disabled"
        ? "Synchronization is disabled on this device."
        : payload?.status === "error"
          ? (payload.lastError ?? "Startup synchronization reported an error.")
          : `Startup sync check complete: pushed ${payload.pushed ?? 0}, pulled ${payload.pulled ?? 0}, conflicts ${payload.conflicts?.length ?? 0}.`,
      checkedAt: new Date().toISOString(),
      result: payload,
    });
  } catch (error) {
    publishStartupSyncStatus({
      state: "error",
      message: error.message,
      checkedAt: new Date().toISOString(),
      result: null,
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
    const requestOptions = options;
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
  ipcMain.handle("gmat:select-installation", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Select GMAT installation or api folder" });
    if (result.canceled) return publicDeviceConfig(configStore.read());
    return resolveGmatInstallation(result.filePaths[0]);
  });
  ipcMain.handle("gmat:save-config", (_event, config) => {
    const pathConfig = config.gmatInstallationPath
      ? resolveGmatInstallation(config.gmatInstallationPath)
      : { gmatInstallationPath: "", executablePath: null };
    const saved = configStore.write({ ...config, ...pathConfig });
    return publicDeviceConfig(saved);
  });
  ipcMain.handle("gmat:validate-submission", async (_event, request) => {
    const config = configStore.read();
    return validateSubmission({ ...request, executablePath: config.executablePath, timeoutMs: Number(config.timeoutMs ?? 120000), keepTemporaryFiles: Boolean(config.keepTemporaryFiles) });
  });
  ipcMain.handle("gmat:generate-script", (_event, request) => generateGmatScript({
    ...request,
    reportPath: request.reportPath ?? path.join(app.getPath("temp"), "mission-dashboard-preview-report.txt"),
  }));
  ipcMain.handle("gmat:download-validation-script", async (_event, request) => {
    const scenarioId = safeFileNamePart(request?.scenarioId, "Scenario");
    const solutionId = safeFileNamePart(request?.solutionId, "Solution");
    const submissionId = safeFileNamePart(request?.submissionId, "Submission");
    const baseName = `MissionDashboard_${scenarioId}_${solutionId}_${submissionId}_Validation`;
    const result = await dialog.showOpenDialog({
      title: "Choose where to save the GMAT validation package",
      defaultPath: app.getPath("downloads"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { saved: false };
    const outputDirectory = createUniqueOutputDirectory(result.filePaths[0], baseName);
    const scriptPath = path.join(outputDirectory, `${baseName}.script`);
    const script = generateGmatScript({
      scenario: request?.scenario,
      finalDecisionVariables: request?.finalDecisionVariables,
      reportPath: path.join(outputDirectory, `${baseName}_Report.txt`),
      inspectionReportPath: path.join(outputDirectory, `${baseName}_Inspection.txt`),
      includeVisualization: true,
    });
    fs.writeFileSync(scriptPath, script, "utf8");
    return { saved: true, filePath: scriptPath, outputDirectory };
  });
  ipcMain.handle("sync:get-startup-status", () => startupSyncStatus);
  createWindow(localApiBaseUrl);
  runStartupSyncCheck(localApiBaseUrl);
  backgroundSyncTimer = setInterval(() => runStartupSyncCheck(localApiBaseUrl), 60000);
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
  if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);
  localBackend?.process?.kill();
});
