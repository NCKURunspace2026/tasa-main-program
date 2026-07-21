const fs = require("node:fs");

function parseGmatReport(reportPath) {
  const states = fs.readFileSync(reportPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%"))
    .map((line) => line.split(/\s+/).map(Number))
    .filter((values) => values.length >= 6 && values.every(Number.isFinite))
    .map((values) => values.slice(-6));
  if (states.length === 0) {
    throw new Error("GMAT report did not contain numeric Cartesian states.");
  }
  const distances = states.map(([cx, cy, cz, tx, ty, tz]) => (
    Math.hypot(cx - tx, cy - ty, cz - tz)
  ));
  const finalState = states.at(-1);
  return {
    minimumDistanceKm: Math.min(...distances),
    finalDistanceKm: distances.at(-1),
    finalChaserPositionKm: finalState.slice(0, 3),
    finalTargetPositionKm: finalState.slice(3, 6),
    sampleCount: states.length,
    reportPath,
  };
}

module.exports = { parseGmatReport };
