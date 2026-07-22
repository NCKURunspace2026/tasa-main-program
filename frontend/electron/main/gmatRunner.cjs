const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { generateGmatScript } = require("./scriptGenerator.cjs");
const { parseGmatReport } = require("./resultParser.cjs");

function runGmat({ executablePath, scenario, finalDecisionVariables, timeoutMs = 120000, keepTemporaryFiles = false }) {
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error("Choose a valid local GmatConsole executable first.");
  // GMAT startup files resolve MEASUREMENT_PATH and VEHICLE_EPHEM_PATH against
  // bin/../output. A clean installation may not include it yet.
  ensureGmatOutputDirectory(executablePath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-dashboard-gmat-"));
  const scriptPath = path.join(directory, "validation.script");
  const reportPath = path.join(directory, "validation-report.txt");
  fs.writeFileSync(scriptPath, generateGmatScript({ scenario, finalDecisionVariables, reportPath }));
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(executablePath, ["-r", scriptPath], { cwd: directory });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const diagnostic = `${stdout}\n${stderr}`.trim();
        return reject(new Error(
          `GMAT exited with code ${code}. ${diagnostic || "No diagnostic output was produced."}`,
        ));
      }
      try {
        const result = parseGmatReport(reportPath);
        const scriptSha256 = sha256File(scriptPath);
        const reportSha256 = sha256File(reportPath);
        const execution = {
          mode: "GmatConsole subprocess",
          executablePath,
          arguments: ["-r", "validation.script"],
          exitCode: code,
          durationMs: Date.now() - startedAt,
          scriptSha256,
          reportSha256,
          reportBytes: fs.statSync(reportPath).size,
        };
        const response = {
          ...result,
          execution,
          scriptPath: keepTemporaryFiles ? scriptPath : null,
          workingDirectory: keepTemporaryFiles ? directory : null,
        };
        if (!keepTemporaryFiles) fs.rmSync(directory, { recursive: true, force: true });
        resolve(response);
      } catch (error) { reject(error); }
    });
  });
}

function ensureGmatOutputDirectory(executablePath) {
  const outputPath = path.resolve(path.dirname(executablePath), "..", "output");
  fs.mkdirSync(outputPath, { recursive: true });
  return outputPath;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
module.exports = { ensureGmatOutputDirectory, runGmat };
