const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { resolveBackendCommand } = require("./localBackend.cjs");

test("resolves the packaged macOS local backend", () => {
  const result = resolveBackendCommand({
    isPackaged: true,
    resourcesPath: "/Applications/Mission Dashboard.app/Contents/Resources",
    platform: "darwin",
  });
  assert.equal(result.command, path.join(result.cwd, "mission-dashboard-backend"));
});

test("resolves the packaged Windows local backend", () => {
  const result = resolveBackendCommand({
    isPackaged: true,
    resourcesPath: "C:\\Mission Dashboard\\resources",
    platform: "win32",
  });
  assert.equal(path.basename(result.command), "mission-dashboard-backend.exe");
});

test("forces an arm64 Python sidecar on Apple Silicon development machines", () => {
  const result = resolveBackendCommand({
    isPackaged: false,
    resourcesPath: "",
    platform: "darwin",
    appleSilicon: true,
  });
  assert.equal(result.command, "/usr/bin/arch");
  assert.equal(result.args[0], "-arm64");
  assert.match(result.args[1], /backend\/.venv\/bin\/python$/);
});
