const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

async function run() {
  ipcMain.handle("gmat:get-config", () => ({ executablePath: "smoke-gmat" }));

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const loadFailures = [];
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    loadFailures.push(`${errorCode} ${errorDescription} ${validatedUrl}`);
  });

  await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  const result = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    setTimeout(() => resolve({
      title: document.title,
      rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
      text: document.body.innerText,
    }), 500);
  })`);

  if (loadFailures.length > 0) {
    throw new Error(`Renderer load failed: ${loadFailures.join("; ")}`);
  }
  if (result.title !== "Mission Dashboard" || result.rootChildren === 0 || !result.text.includes("Submissions")) {
    throw new Error(`Renderer did not mount correctly: ${JSON.stringify(result)}`);
  }

  console.log(`Packaged renderer smoke passed: ${result.title}`);
  window.destroy();
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
