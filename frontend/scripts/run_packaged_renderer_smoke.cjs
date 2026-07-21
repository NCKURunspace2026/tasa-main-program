const { spawnSync } = require("node:child_process");
const electronPath = require("electron");

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, ["scripts/smoke_packaged_renderer.cjs"], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
