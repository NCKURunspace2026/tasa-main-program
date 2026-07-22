const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createPasswordRecord,
  resolveGmatInstallation,
  verifyPassword,
} = require("./configStore.cjs");

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

test("stores only a salted administration password hash", () => {
  const record = createPasswordRecord("correct horse");
  assert.equal(record.adminPasswordHash.includes("correct horse"), false);
  assert.equal(verifyPassword("correct horse", record), true);
  assert.equal(verifyPassword("wrong password", record), false);
  assert.throws(() => createPasswordRecord("short"), /at least 6/);
});
