const assert = require("node:assert/strict");
const test = require("node:test");

const { createAppUpdater } = require("./appUpdater.cjs");

test("keeps automatic updates disabled during development", async () => {
  const handlers = new Map();
  const service = createAppUpdater({
    app: { isPackaged: false, getVersion: () => "0.2.0" },
    dialog: {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getWindows: () => [],
    updater: {},
  });
  assert.equal(service.getStatus().state, "disabled");
  assert.equal((await handlers.get("app:update:check")()).state, "disabled");
});
