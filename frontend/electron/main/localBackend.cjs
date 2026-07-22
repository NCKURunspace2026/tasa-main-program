const { spawn } = require("node:child_process");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function resolveBackendCommand({
  isPackaged,
  resourcesPath,
  platform = process.platform,
  appleSilicon,
}) {
  if (isPackaged) {
    const executableName = platform === "win32"
      ? "mission-dashboard-backend.exe"
      : "mission-dashboard-backend";
    return {
      command: path.join(resourcesPath, "backend", executableName),
      args: [],
      cwd: path.join(resourcesPath, "backend"),
    };
  }

  const backendDirectory = path.resolve(__dirname, "..", "..", "..", "backend");
  const pythonPath = platform === "win32"
    ? path.join(backendDirectory, ".venv", "Scripts", "python.exe")
    : path.join(backendDirectory, ".venv", "bin", "python");
  const serverEntry = path.join(backendDirectory, "server_entry.py");
  const shouldForceArm64 = appleSilicon ?? detectAppleSilicon(platform);
  return {
    command: platform === "darwin" && shouldForceArm64 ? "/usr/bin/arch" : pythonPath,
    args: platform === "darwin" && shouldForceArm64
      ? ["-arm64", pythonPath, serverEntry]
      : [serverEntry],
    cwd: backendDirectory,
  };
}

function detectAppleSilicon(platform = process.platform) {
  if (platform !== "darwin") return false;
  try {
    return execFileSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], {
      encoding: "utf8",
    }).trim() === "1";
  } catch {
    return process.arch === "arm64";
  }
}

async function startLocalBackend({
  app,
  port = 8765,
  spawnProcess = spawn,
  fetchHealth = fetch,
}) {
  const command = resolveBackendCommand({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  if (!fs.existsSync(command.command)) {
    throw new Error(`Local backend executable was not found: ${command.command}`);
  }
  const apiBaseUrl = `http://127.0.0.1:${port}/api`;
  const child = spawnProcess(command.command, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      MISSION_DASHBOARD_API_HOST: "127.0.0.1",
      MISSION_DASHBOARD_API_PORT: String(port),
      MISSION_DASHBOARD_DATA_DIR: path.join(app.getPath("userData"), "data"),
      MISSION_DASHBOARD_NODE_ROLE: "local",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => console.log(`[local-backend] ${String(chunk).trimEnd()}`));
  child.stderr?.on("data", (chunk) => console.error(`[local-backend] ${String(chunk).trimEnd()}`));

  try {
    await waitUntilReady(apiBaseUrl, fetchHealth);
  } catch (error) {
    child.kill();
    throw error;
  }
  return { apiBaseUrl, process: child };
}

async function waitUntilReady(apiBaseUrl, fetchHealth, attempts = 80) {
  const healthUrl = apiBaseUrl.replace(/\/api$/, "/health");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchHealth(healthUrl);
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // The sidecar may still be importing dependencies or opening SQLite.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local Mission Dashboard backend did not become ready.");
}

module.exports = { detectAppleSilicon, resolveBackendCommand, startLocalBackend, waitUntilReady };
