const assert = require("node:assert/strict");
const test = require("node:test");

const { createAppUpdater, formatUpdateError } = require("./appUpdater.cjs");

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

test("turns a missing macOS release manifest into a short recovery message", () => {
  const message = formatUpdateError(
    new Error("Cannot find latest-mac.yml. HttpError: 404 method: GET url: https://example.test/latest-mac.yml\nstack"),
    "darwin",
  );
  assert.equal(
    message,
    "The latest release has no macOS update metadata. Download its DMG manually from GitHub Releases.",
  );
  assert.doesNotMatch(message, /HttpError|stack|https:/);
});
