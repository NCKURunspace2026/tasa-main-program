const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveGmatInstallation } = require("./configStore.cjs");

function withTemporaryGmat(executableName, callback) {
  const installationPath = fs.mkdtempSync(path.join(os.tmpdir(), "mission-dashboard-config-"));
  const binPath = path.join(installationPath, "bin");
  fs.mkdirSync(binPath);
  const executablePath = path.join(binPath, executableName);
  fs.writeFileSync(executablePath, "");
  try {
    callback({ installationPath, executablePath });
  } finally {
    fs.rmSync(installationPath, { recursive: true, force: true });
  }
}

test("resolves the macOS and Linux GmatConsole executable", () => {
  withTemporaryGmat("GmatConsole", ({ installationPath, executablePath }) => {
    assert.deepEqual(resolveGmatInstallation(installationPath), {
      gmatInstallationPath: installationPath,
      executablePath,
    });
  });
});

test("resolves the Windows GmatConsole.exe executable", () => {
  withTemporaryGmat("GmatConsole.exe", ({ installationPath, executablePath }) => {
    assert.deepEqual(resolveGmatInstallation(installationPath), {
      gmatInstallationPath: installationPath,
      executablePath,
    });
  });
});
