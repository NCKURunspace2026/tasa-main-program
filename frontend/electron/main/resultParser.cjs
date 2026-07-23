const fs = require("node:fs");

function parseGmatReport(reportPath) {
  const rows = fs.readFileSync(reportPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%"))
    .map((line) => line.split(/\s+/).map(Number))
    .filter((values) => values.length >= 6 && values.every(Number.isFinite))
    .map((values) => ({ timeSec: values.length >= 7 ? values.at(-7) : null, state: values.slice(-6) }));
  if (rows.length === 0) {
    throw new Error("GMAT report did not contain numeric Cartesian states.");
  }
  const distances = rows.map(({ state: [cx, cy, cz, tx, ty, tz] }) => (
    Math.hypot(cx - tx, cy - ty, cz - tz)
  ));
  const minimumDistanceKm = Math.min(...distances);
  const minimumIndex = distances.indexOf(minimumDistanceKm);
  const finalState = rows.at(-1).state;
  return {
    minimumDistanceKm,
    minimumDistanceTimeSec: rows[minimumIndex].timeSec,
    finalDistanceKm: distances.at(-1),
    finalChaserPositionKm: finalState.slice(0, 3),
    finalTargetPositionKm: finalState.slice(3, 6),
    sampleCount: rows.length,
    reportPath,
  };
}

module.exports = { parseGmatReport };
