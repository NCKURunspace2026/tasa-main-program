const { runGmat } = require("./gmatRunner.cjs");

function magnitude(deltaV) { return Math.hypot(...deltaV); }

async function validateSubmission({ executablePath, scenario, finalDecisionVariables, timeoutMs, keepTemporaryFiles }) {
  const propagation = await runGmat({ executablePath, scenario, finalDecisionVariables, timeoutMs, keepTemporaryFiles });
  const totalDeltaV = finalDecisionVariables.burns.reduce((sum, burn) => sum + magnitude(burn.deltaV), 0);
  const totalTime = finalDecisionVariables.tWait + finalDecisionVariables.finalCoastTime + finalDecisionVariables.burns.reduce((sum, burn) => sum + (burn.timeToNextBurn ?? 0), 0);
  const definition = scenario.scenarioJson ?? scenario.definition ?? {};
  const limits = definition.validation ?? definition.constraints ?? {};
  const finalDistanceLimit = limits.requiredFinalDistanceKm ?? limits.interceptionDistance ?? limits.finalDistanceThreshold ?? limits.maximumFinalDistance;
  const deltaVPerBurnLimit = limits.maximumDeltaVPerBurn ?? limits.maximumTotalDeltaV;
  const timeLimit = limits.maximumSimulationTimeSec
    ?? limits.maximumMissionTimeSec
    ?? limits.maximumMissionTime;
  const minimumBurnCount = limits.minimumBurnCount;
  const maximumBurnCount = limits.maximumBurnCount;
  const minimumBurnSeparation = limits.minimumBurnSeparationSec;
  const constraints = [
    ["minimumDistance", propagation.minimumDistanceKm, finalDistanceLimit],
    ["totalTime", totalTime, timeLimit],
  ].filter(([, , limit]) => Number.isFinite(limit)).map(([name, value, limit]) => ({ name, value, limit, operator: "<=", satisfied: value <= limit }));
  if (Number.isFinite(deltaVPerBurnLimit)) {
    finalDecisionVariables.burns.forEach((burn, index) => {
      const value = magnitude(burn.deltaV);
      constraints.push({
        name: `burn${index + 1}DeltaV`,
        value,
        limit: deltaVPerBurnLimit,
        operator: "<=",
        satisfied: value <= deltaVPerBurnLimit,
      });
    });
  }
  if (Number.isFinite(minimumBurnCount)) {
    constraints.push({
      name: "minimumBurnCount",
      value: finalDecisionVariables.burns.length,
      limit: minimumBurnCount,
      operator: ">=",
      satisfied: finalDecisionVariables.burns.length >= minimumBurnCount,
    });
  }
  if (Number.isFinite(maximumBurnCount)) {
    constraints.push({
      name: "maximumBurnCount",
      value: finalDecisionVariables.burns.length,
      limit: maximumBurnCount,
      operator: "<=",
      satisfied: finalDecisionVariables.burns.length <= maximumBurnCount,
    });
  }
  if (Number.isFinite(minimumBurnSeparation)) {
    finalDecisionVariables.burns.slice(0, -1).forEach((burn, index) => {
      constraints.push({
        name: `burnSeparation${index + 1}`,
        value: burn.timeToNextBurn,
        limit: minimumBurnSeparation,
        operator: ">=",
        satisfied: burn.timeToNextBurn >= minimumBurnSeparation,
      });
    });
  }
  return { provider: "gmat-console", status: constraints.every((item) => item.satisfied) ? "validated" : "failed", minimumDistance: propagation.minimumDistanceKm, finalDistance: propagation.finalDistanceKm, totalDeltaV, totalTime, burnCount: finalDecisionVariables.burns.length, constraints, artifacts: propagation };
}
module.exports = { validateSubmission };
