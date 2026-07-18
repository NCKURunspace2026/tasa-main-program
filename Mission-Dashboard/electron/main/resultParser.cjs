const fs = require("node:fs");

function parseGmatReport(reportPath) {
  const rows = fs.readFileSync(reportPath, "utf8").trim().split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("%"));
  const values = rows.at(-1).trim().split(/\s+/).map(Number);
  if (values.length < 6 || values.some((value) => !Number.isFinite(value))) throw new Error("GMAT report did not contain a numeric final Cartesian state.");
  const [chaserX, chaserY, chaserZ, targetX, targetY, targetZ] = values.slice(-6);
  const finalDistanceKm = Math.hypot(chaserX - targetX, chaserY - targetY, chaserZ - targetZ);
  return { finalDistanceKm, finalChaserPositionKm: [chaserX, chaserY, chaserZ], finalTargetPositionKm: [targetX, targetY, targetZ], reportPath };
}
module.exports = { parseGmatReport };
