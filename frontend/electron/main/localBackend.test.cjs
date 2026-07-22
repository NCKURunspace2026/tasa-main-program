const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const { findAvailablePort, resolveBackendCommand } = require("./localBackend.cjs");

test("selects an available loopback port for each app instance", async () => {
  const fakeServer = new EventEmitter();
  fakeServer.unref = () => {};
  fakeServer.address = () => ({ port: 43125 });
  fakeServer.listen = (_port, host, callback) => {
    assert.equal(host, "127.0.0.1");
    callback();
  };
  fakeServer.close = (callback) => callback();
  const port = await findAvailablePort("127.0.0.1", () => fakeServer);
  assert.equal(port, 43125);
});

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
  assert.match(result.args[1].replaceAll("\\", "/"), /backend\/.venv\/bin\/python$/);
});
