const fs = require("node:fs");
const path = require("node:path");

function resolveGmatInstallation(selectedPath) {
  const normalized = path.resolve(selectedPath);
  const executableNames = ["GmatConsole", "GmatConsole.exe"];
  const candidateDirectories = [
    path.join(normalized, "bin"),
    normalized,
    path.join(path.dirname(normalized), "bin"),
  ];
  const candidates = candidateDirectories.flatMap((directory) =>
    executableNames.map((executableName) => path.join(directory, executableName)),
  );
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error("This folder does not contain bin/GmatConsole or bin/GmatConsole.exe. Select the GMAT installation folder or its api folder.");
  }
  return { gmatInstallationPath: normalized, executablePath };
}

function createConfigStore(app) {
  const configPath = path.join(app.getPath("userData"), "client-validation.json");

  function read() {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.executablePath && fs.statSync(config.executablePath).isDirectory()) {
        const resolved = resolveGmatInstallation(config.executablePath);
        const migrated = { ...config, ...resolved };
        fs.writeFileSync(configPath, JSON.stringify(migrated, null, 2));
        return migrated;
      }
      return config;
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
