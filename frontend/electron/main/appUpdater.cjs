const RELEASES_URL = "https://github.com/NCKURunspace2026/tasa-main-program/releases/latest";

function createAppUpdater({ app, dialog, ipcMain, getWindows, updater, shell, platform = process.platform }) {
  const requiresManualInstall = app.isPackaged && platform === "darwin";
  const activeUpdater = app.isPackaged
    ? (updater ?? require("electron-updater").autoUpdater)
    : null;
  let status = {
    state: requiresManualInstall ? "manual" : app.isPackaged ? "idle" : "disabled",
    currentVersion: app.getVersion(),
    availableVersion: null,
    percent: null,
    message: requiresManualInstall
      ? "macOS updates require a manually installed DMG until the app has a Developer ID signature."
      : app.isPackaged ? "Ready to check for updates." : "Updates are disabled in development.",
  };

  function publish(next) {
    status = { ...status, ...next };
    for (const window of getWindows()) window.webContents.send("app:update-status", status);
    return status;
  }

  ipcMain.handle("app:update:get-status", () => status);
  ipcMain.handle("app:update:open-releases", async () => {
    await shell?.openExternal(RELEASES_URL);
    return status;
  });
  ipcMain.handle("app:update:check", async () => {
    if (requiresManualInstall) return status;
    if (!app.isPackaged) return status;
    publish({ state: "checking", message: "Checking GitHub Releases…", percent: null });
    try {
      await activeUpdater.checkForUpdates();
    } catch (error) {
      publish({ state: "error", message: formatUpdateError(error, platform) });
    }
    return status;
  });

  if (requiresManualInstall || !app.isPackaged) {
    return { getStatus: () => status, check: () => status };
  }

  activeUpdater.autoDownload = false;
  activeUpdater.autoInstallOnAppQuit = true;
  activeUpdater.on("update-available", async (info) => {
    publish({
      state: "available",
      availableVersion: info.version,
      message: `Version ${info.version} is available.`,
    });
    const choice = await dialog.showMessageBox({
      type: "info",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Mission Dashboard Update",
      message: `Version ${info.version} is available.`,
      detail: "Download it now? Your local SQLite data will remain on this device.",
    });
    if (choice.response === 0) {
      publish({ state: "downloading", message: `Downloading version ${info.version}…`, percent: 0 });
      activeUpdater.downloadUpdate().catch((error) => {
        publish({ state: "error", message: formatUpdateError(error, platform) });
      });
    }
  });
  activeUpdater.on("update-not-available", () => publish({
    state: "current",
    availableVersion: null,
    percent: null,
    message: "This device already has the latest version.",
  }));
  activeUpdater.on("download-progress", (progress) => publish({
    state: "downloading",
    percent: Math.round(progress.percent),
    message: `Downloading update: ${Math.round(progress.percent)}%.`,
  }));
  activeUpdater.on("update-downloaded", async (info) => {
    publish({
      state: "downloaded",
      availableVersion: info.version,
      percent: 100,
      message: `Version ${info.version} is ready to install.`,
    });
    const choice = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart and Install", "Install Later"],
      defaultId: 1,
      cancelId: 1,
      title: "Mission Dashboard Update Ready",
      message: `Version ${info.version} has been downloaded.`,
      detail: "Finish any running GMAT job before restarting. If you choose Later, the update installs on a normal app exit.",
    });
    if (choice.response === 0) activeUpdater.quitAndInstall(false, true);
  });
  activeUpdater.on("error", (error) => publish({
    state: "error",
    percent: null,
    message: formatUpdateError(error, platform),
  }));

  const check = () => activeUpdater.checkForUpdates().catch((error) => {
    publish({ state: "error", message: formatUpdateError(error, platform) });
  });
  const firstCheck = setTimeout(check, 30_000);
  const periodicCheck = setInterval(check, 6 * 60 * 60 * 1000);
  firstCheck.unref?.();
  periodicCheck.unref?.();
  return { getStatus: () => status, check };
}

function formatUpdateError(error, platform) {
  const message = String(error?.message ?? error ?? "Unknown update error.");
  if (platform === "darwin" && /latest-mac\.yml|HTTP(?:Error)?:? 404|404.*GET/is.test(message)) {
    return "The latest release has no macOS update metadata. Download its DMG manually from GitHub Releases.";
  }
  const firstLine = message.split(/\r?\n/, 1)[0].replace(/https?:\/\/\S+/g, "the release server");
  return `Update check failed: ${firstLine.slice(0, 240)}`;
}

module.exports = { createAppUpdater, formatUpdateError };
