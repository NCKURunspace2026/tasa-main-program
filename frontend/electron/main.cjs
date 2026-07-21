const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { createConfigStore, resolveGmatInstallation } = require("./main/configStore.cjs");
const { validateSubmission } = require("./main/validationService.cjs");
const { createValidationWorker } = require("./main/validationWorker.cjs");

const explicitRole = process.argv.includes("--client")
  ? "client"
  : process.argv.includes("--server")
    ? "server"
    : null;
let runtimeRole = explicitRole ?? null;
const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL || (
  app.isPackaged ? null : "http://127.0.0.1:5173"
);
const apiPort = Number(process.env.MISSION_DASHBOARD_API_PORT ?? 8000);
let backendProcess = null;
let validationWorker = null;
const workerToken = crypto.randomBytes(32).toString("hex");

async function chooseRuntimeRole() {
  const result = await dialog.showMessageBox({
    type: "question",
    title: "Mission Dashboard Mode",
    message: "Choose how to start Mission Dashboard",
    detail: "Server Mode hosts the central service on this computer. Client Mode connects to an existing central service.",
    buttons: ["Server Mode", "Client Mode", "Cancel"],
    defaultId: explicitRole === "server" ? 0 : 1,
    cancelId: 2,
    noLink: true,
  });
  if (result.response === 2) return null;
  return result.response === 0 ? "server" : "client";
}

function getPythonExecutable() {
  if (process.env.MISSION_DASHBOARD_PYTHON) {
    return process.env.MISSION_DASHBOARD_PYTHON;
  }
  const backendDirectory = getBackendDirectory();
  return process.platform === "win32"
    ? path.join(backendDirectory, ".venv", "Scripts", "python.exe")
    : path.join(backendDirectory, ".venv", "bin", "python");
}

function getPackagedBackendExecutable() {
  const executableName = process.platform === "win32"
    ? "mission-dashboard-backend.exe"
    : "mission-dashboard-backend";
  return path.join(process.resourcesPath, "backend-sidecar", executableName);
}

function getBackendDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.join(__dirname, "..", "..", "backend");
}

function getPythonLaunchCommand(pythonExecutable) {
  if (process.platform !== "darwin") {
    return { command: pythonExecutable, prefixArgs: [] };
  }
  try {
    const supportsArm64 = execFileSync(
      "/usr/sbin/sysctl",
      ["-n", "hw.optional.arm64"],
      { encoding: "utf8" },
    ).trim() === "1";
    if (supportsArm64) {
      return {
        command: "/usr/bin/arch",
        prefixArgs: ["-arm64", pythonExecutable],
      };
    }
  } catch (error) {
    console.warn(`[backend] could not detect Apple Silicon: ${error.message}`);
  }
  return { command: pythonExecutable, prefixArgs: [] };
}

function startBackend() {
  if (runtimeRole !== "server" || backendProcess) return;
  if (app.isPackaged) {
    const backendExecutable = getPackagedBackendExecutable();
    if (!fs.existsSync(backendExecutable)) {
      throw new Error("Bundled FastAPI sidecar was not found in this application.");
    }
    startBackendProcess(backendExecutable, [], path.dirname(backendExecutable));
    return;
  }
  const pythonExecutable = getPythonExecutable();
  if (!fs.existsSync(pythonExecutable)) {
    throw new Error(
      "Python sidecar was not found. Set MISSION_DASHBOARD_PYTHON or bundle the backend executable before packaging.",
    );
  }
  const pythonLaunch = getPythonLaunchCommand(pythonExecutable);
  startBackendProcess(
    pythonLaunch.command,
    [...pythonLaunch.prefixArgs, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", String(apiPort)],
    getBackendDirectory(),
  );
}

function startBackendProcess(command, args, workingDirectory) {
  const dataDirectory = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  const databasePath = path.join(dataDirectory, "main.db");
  backendProcess = spawn(command, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        DATABASE_URL: `sqlite:///${databasePath}`,
        MISSION_DASHBOARD_WORKER_TOKEN: workerToken,
        MISSION_DASHBOARD_API_PORT: String(apiPort),
      },
      stdio: "pipe",
    });
  backendProcess.stdout.on("data", (chunk) => {
    console.log(`[backend] ${chunk.toString().trimEnd()}`);
  });
  backendProcess.stderr.on("data", (chunk) => {
    console.error(`[backend] ${chunk.toString().trimEnd()}`);
  });
  backendProcess.on("error", (error) => {
    console.error(`[backend] failed to start: ${error.message}`);
  });
  backendProcess.on("exit", (code, signal) => {
    console.error(`[backend] exited (code=${code}, signal=${signal}).`);
    backendProcess = null;
  });
}

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
  const runtimeParams = new URLSearchParams({
    desktopRole: runtimeRole,
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

app.whenReady().then(async () => {
  const appIconPath = app.isPackaged
    ? path.join(__dirname, "..", "dist", "Team-Logo.png")
    : path.join(__dirname, "..", "public", "Team-Logo.png");
  if (process.platform === "darwin" && fs.existsSync(appIconPath)) {
    app.dock.setIcon(nativeImage.createFromPath(appIconPath));
  }
  runtimeRole = await chooseRuntimeRole();
  if (!runtimeRole) {
    app.quit();
    return;
  }
  try {
    startBackend();
  } catch (error) {
    dialog.showErrorBox("Mission Dashboard Server", error.message);
  }
  ipcMain.handle("runtime:get-config", () => ({
    role: runtimeRole,
    localServerAddress: runtimeRole === "server"
      ? `http://127.0.0.1:${apiPort}`
      : null,
  }));
  const configStore = createConfigStore(app);
  if (runtimeRole === "server") {
    validationWorker = createValidationWorker({
      apiBaseUrl: `http://127.0.0.1:${apiPort}/api`,
      workerToken,
      readConfig: () => configStore.read(),
    });
    validationWorker.start();
  }
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
  if (backendProcess) backendProcess.kill();
});
