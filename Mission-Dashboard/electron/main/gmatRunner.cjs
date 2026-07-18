const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { generateGmatScript } = require("./scriptGenerator.cjs");
const { parseGmatReport } = require("./resultParser.cjs");

function runGmat({ executablePath, scenario, finalDecisionVariables, timeoutMs = 120000, keepTemporaryFiles = false }) {
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error("Choose a valid local GmatConsole executable first.");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-dashboard-gmat-"));
  const scriptPath = path.join(directory, "validation.script");
  const reportPath = path.join(directory, "validation-report.txt");
  fs.writeFileSync(scriptPath, generateGmatScript({ scenario, finalDecisionVariables, reportPath }));
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["-r", scriptPath], { cwd: directory });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`GMAT exited with code ${code}. ${stderr}`.trim()));
      try {
        const result = parseGmatReport(reportPath);
        resolve({ ...result, scriptPath: keepTemporaryFiles ? scriptPath : null, workingDirectory: keepTemporaryFiles ? directory : null });
      } catch (error) { reject(error); }
    });
  });
}
module.exports = { runGmat };
