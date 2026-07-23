const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseGmatReport } = require("./resultParser.cjs");

test("reports the elapsed time at minimum distance", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-dashboard-parser-"));
  const reportPath = path.join(directory, "report.txt");
  fs.writeFileSync(reportPath, [
    "% elapsed chaser xyz target xyz",
    "0 0 0 0 10 0 0",
    "25 0 0 0 3 4 0",
    "40 0 0 0 9 0 0",
    "",
  ].join("\n"));

  try {
    const result = parseGmatReport(reportPath);
    assert.equal(result.minimumDistanceKm, 5);
    assert.equal(result.minimumDistanceTimeSec, 25);
    assert.equal(result.finalDistanceKm, 9);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps parsing legacy reports without elapsed time", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-dashboard-parser-"));
  const reportPath = path.join(directory, "report.txt");
  fs.writeFileSync(reportPath, [
    "0 0 0 3 4 0",
    "0 0 0 9 0 0",
    "",
  ].join("\n"));

  try {
    const result = parseGmatReport(reportPath);
    assert.equal(result.minimumDistanceKm, 5);
    assert.equal(result.minimumDistanceTimeSec, null);
    assert.equal(result.finalDistanceKm, 9);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
