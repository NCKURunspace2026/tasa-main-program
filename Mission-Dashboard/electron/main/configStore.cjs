const fs = require("node:fs");
const path = require("node:path");

function resolveGmatInstallation(selectedPath) {
  const normalized = path.resolve(selectedPath);
  const candidates = [
    path.join(normalized, "bin", "GmatConsole"),
    path.join(normalized, "GmatConsole"),
    path.join(path.dirname(normalized), "bin", "GmatConsole"),
  ];
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error("This folder does not contain bin/GmatConsole. Select the GMAT installation folder or its api folder.");
  }
  return { gmatInstallationPath: normalized, executablePath };
}

function createConfigStore(app) {
  const configPath = path.join(app.getPath("userData"), "client-validation.json");

  function read() {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      return {};
    }
  }

  function write(next) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ ...read(), ...next }, null, 2));
    return read();
  }

  return { read, write };
}

module.exports = { createConfigStore, resolveGmatInstallation };
