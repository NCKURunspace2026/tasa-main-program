const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ensureGmatOutputDirectory } = require("./gmatRunner.cjs");

test("creates GMAT bin/../output before a validation run", () => {
  const installationPath = fs.mkdtempSync(path.join(os.tmpdir(), "mission-dashboard-gmat-"));
  const executablePath = path.join(installationPath, "bin", "GmatConsole");
  fs.mkdirSync(path.dirname(executablePath));
  fs.writeFileSync(executablePath, "");

  try {
    const outputPath = ensureGmatOutputDirectory(executablePath);
    assert.equal(outputPath, path.join(installationPath, "output"));
    assert.equal(fs.statSync(outputPath).isDirectory(), true);
  } finally {
    fs.rmSync(installationPath, { recursive: true, force: true });
  }
});
