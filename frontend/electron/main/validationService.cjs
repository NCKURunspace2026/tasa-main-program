const { runGmat } = require("./gmatRunner.cjs");

function magnitude(deltaV) { return Math.hypot(...deltaV); }

async function validateSubmission({ executablePath, scenario, finalDecisionVariables, timeoutMs, keepTemporaryFiles }) {
  const propagation = await runGmat({ executablePath, scenario, finalDecisionVariables, timeoutMs, keepTemporaryFiles });
  const totalDeltaV = finalDecisionVariables.burns.reduce((sum, burn) => sum + magnitude(burn.deltaV), 0);
  const totalTime = finalDecisionVariables.tWait + finalDecisionVariables.finalCoastTime + finalDecisionVariables.burns.reduce((sum, burn) => sum + (burn.timeToNextBurn ?? 0), 0);
  const definition = scenario.scenarioJson ?? scenario.definition ?? {};
  const limits = definition.validation ?? definition.constraints ?? {};
  const finalDistanceLimit = limits.requiredFinalDistanceKm ?? limits.interceptionDistance ?? limits.finalDistanceThreshold ?? limits.maximumFinalDistance;
  const deltaVLimit = limits.maximumTotalDeltaV ?? limits.maximumDeltaVPerBurn;
  const timeLimit = limits.maximumSimulationTimeSec
    ?? limits.maximumMissionTimeSec
    ?? limits.maximumMissionTime;
  const constraints = [
    ["minimumDistance", propagation.minimumDistanceKm, finalDistanceLimit],
    ["totalDeltaV", totalDeltaV, deltaVLimit],
    ["totalTime", totalTime, timeLimit],
  ].filter(([, , limit]) => Number.isFinite(limit)).map(([name, value, limit]) => ({ name, value, limit, operator: "<=", satisfied: value <= limit }));
  return { provider: "gmat-console", status: constraints.every((item) => item.satisfied) ? "validated" : "failed", minimumDistance: propagation.minimumDistanceKm, finalDistance: propagation.finalDistanceKm, totalDeltaV, totalTime, burnCount: finalDecisionVariables.burns.length, constraints, artifacts: propagation };
}
module.exports = { validateSubmission };
