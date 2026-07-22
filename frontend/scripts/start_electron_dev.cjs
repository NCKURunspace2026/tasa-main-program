const { spawn } = require("node:child_process");

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const electronBinary = require("electron");
const child = spawn(electronBinary, ["."], {
  env: environment,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
