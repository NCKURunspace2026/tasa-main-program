const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { createConfigStore, resolveGmatInstallation } = require("./main/configStore.cjs");
const { validateSubmission } = require("./main/validationService.cjs");

const isServerMode = !process.argv.includes("--client");
const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL || (
  app.isPackaged ? null : "http://127.0.0.1:5173"
);
const apiPort = Number(process.env.MISSION_DASHBOARD_API_PORT ?? 8000);
let backendProcess = null;

function getPythonExecutable() {
  if (process.env.MISSION_DASHBOARD_PYTHON) {
    return process.env.MISSION_DASHBOARD_PYTHON;
  }
  const projectRoot = path.join(__dirname, "..");
  return process.platform === "win32"
    ? path.join(projectRoot, "backend", ".venv", "Scripts", "python.exe")
    : path.join(projectRoot, "backend", ".venv", "bin", "python");
}

function startBackend() {
  if (!isServerMode || backendProcess) return;
  const pythonExecutable = getPythonExecutable();
  if (!fs.existsSync(pythonExecutable)) {
    throw new Error(
      "Python sidecar was not found. Set MISSION_DASHBOARD_PYTHON or bundle the backend executable before packaging.",
    );
  }
  const dataDirectory = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  const databasePath = path.join(dataDirectory, "mission_dashboard.db");
  const projectRoot = path.join(__dirname, "..");
  backendProcess = spawn(
    pythonExecutable,
    ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", String(apiPort)],
    {
      cwd: path.join(projectRoot, "backend"),
      env: { ...process.env, DATABASE_URL: `sqlite:///${databasePath}` },
      stdio: "pipe",
    },
  );
  backendProcess.on("exit", () => {
    backendProcess = null;
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const runtimeParams = new URLSearchParams({
    desktopRole: isServerMode ? "server" : "client",
    serverAddress: `http://127.0.0.1:${apiPort}`,
  });
  if (developmentRendererUrl) {
    window.loadURL(`${developmentRendererUrl}?${runtimeParams.toString()}`);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
      query: Object.fromEntries(runtimeParams),
    });
  }
}

app.whenReady().then(() => {
  try {
    startBackend();
  } catch (error) {
    dialog.showErrorBox("Mission Dashboard Server", error.message);
  }
  ipcMain.handle("runtime:get-config", () => ({
    role: isServerMode ? "server" : "client",
    localServerAddress: `http://127.0.0.1:${apiPort}`,
  }));
  const configStore = createConfigStore(app);
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
  if (backendProcess) backendProcess.kill();
});
