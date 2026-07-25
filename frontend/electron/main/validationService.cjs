const { runGmat } = require("./gmatRunner.cjs");

function magnitude(deltaV) { return Math.hypot(...deltaV); }

const CENTRAL_BODY_RADIUS_KM = {
  Earth: 6378.1363,
};

function totalMissionTime(finalDecisionVariables) {
  return finalDecisionVariables.tWait + finalDecisionVariables.finalCoastTime + finalDecisionVariables.burns.reduce((sum, burn) => sum + (burn.timeToNextBurn ?? 0), 0);
}

function trimFinalCoastToCompletionTime(finalDecisionVariables, completionTimeSec) {
  if (!Number.isFinite(completionTimeSec)) {
    return { decisionVariables: finalDecisionVariables, adjustment: null };
  }

  const finalCoastStartTime = finalDecisionVariables.tWait + finalDecisionVariables.burns.reduce((sum, burn) => sum + (burn.timeToNextBurn ?? 0), 0);
  const originalTotalTime = totalMissionTime(finalDecisionVariables);
  const toleranceSec = 1e-6;
  if (completionTimeSec < finalCoastStartTime - toleranceSec || completionTimeSec >= originalTotalTime - toleranceSec) {
    return { decisionVariables: finalDecisionVariables, adjustment: null };
  }

  const adjustedFinalCoastTime = Math.max(0, completionTimeSec - finalCoastStartTime);
  return {
    decisionVariables: {
      ...finalDecisionVariables,
      finalCoastTime: adjustedFinalCoastTime,
    },
    adjustment: {
      type: "trim-final-coast-to-minimum-distance",
      originalFinalCoastTime: finalDecisionVariables.finalCoastTime,
      adjustedFinalCoastTime,
      originalTotalTime,
      adjustedTotalTime: finalCoastStartTime + adjustedFinalCoastTime,
      completionTimeSec,
    },
  };
}

async function validateSubmission({ executablePath, scenario, finalDecisionVariables, timeoutMs, keepTemporaryFiles }) {
  const propagation = await runGmat({ executablePath, scenario, finalDecisionVariables, timeoutMs, keepTemporaryFiles });
  const completionTimeSec = propagation.firstRequiredDistanceTimeSec ?? propagation.minimumDistanceTimeSec;
  const { decisionVariables: scoredDecisionVariables, adjustment } = trimFinalCoastToCompletionTime(finalDecisionVariables, completionTimeSec);
  const totalDeltaV = scoredDecisionVariables.burns.reduce((sum, burn) => sum + magnitude(burn.deltaV), 0);
  const totalTime = totalMissionTime(scoredDecisionVariables);
  const definition = scenario.scenarioJson ?? scenario.definition ?? {};
  const limits = definition.validation ?? definition.constraints ?? {};
  const distanceLimit = limits.requiredFinalDistanceKm ?? limits.interceptionDistance ?? limits.finalDistanceThreshold ?? limits.maximumFinalDistance;
  const minimumSpacecraftRadiusKm = limits.minimumSpacecraftRadiusKm
    ?? CENTRAL_BODY_RADIUS_KM[definition.forceModel?.centralBody ?? definition.centralBody ?? "Earth"];
  const deltaVPerBurnLimit = limits.maximumDeltaVPerBurn ?? limits.maximumTotalDeltaV;
  const timeLimit = limits.maximumSimulationTimeSec
    ?? limits.maximumMissionTimeSec
    ?? limits.maximumMissionTime;
  const minimumBurnCount = limits.minimumBurnCount;
  const maximumBurnCount = limits.maximumBurnCount;
  const minimumBurnSeparation = limits.minimumBurnSeparationSec;
  const constraints = [
    ["minimumDistance", propagation.minimumDistanceKm, distanceLimit],
    ["totalTime", totalTime, timeLimit],
  ].filter(([, , limit]) => Number.isFinite(limit)).map(([name, value, limit]) => ({ name, value, limit, operator: "<=", satisfied: value <= limit }));
  if (Number.isFinite(minimumSpacecraftRadiusKm)) {
    constraints.push({
      name: "chaserRadiusNorm",
      value: propagation.minimumChaserRadiusKm,
      limit: minimumSpacecraftRadiusKm,
      operator: ">=",
      satisfied: propagation.minimumChaserRadiusKm >= minimumSpacecraftRadiusKm,
    });
    constraints.push({
      name: "targetRadiusNorm",
      value: propagation.minimumTargetRadiusKm,
      limit: minimumSpacecraftRadiusKm,
      operator: ">=",
      satisfied: propagation.minimumTargetRadiusKm >= minimumSpacecraftRadiusKm,
    });
  }
  if (Number.isFinite(deltaVPerBurnLimit)) {
    scoredDecisionVariables.burns.forEach((burn, index) => {
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
      value: scoredDecisionVariables.burns.length,
      limit: minimumBurnCount,
      operator: ">=",
      satisfied: scoredDecisionVariables.burns.length >= minimumBurnCount,
    });
  }
  if (Number.isFinite(maximumBurnCount)) {
    constraints.push({
      name: "maximumBurnCount",
      value: scoredDecisionVariables.burns.length,
      limit: maximumBurnCount,
      operator: "<=",
      satisfied: scoredDecisionVariables.burns.length <= maximumBurnCount,
    });
  }
  if (Number.isFinite(minimumBurnSeparation)) {
    scoredDecisionVariables.burns.slice(0, -1).forEach((burn, index) => {
      constraints.push({
        name: `burnSeparation${index + 1}`,
        value: burn.timeToNextBurn,
        limit: minimumBurnSeparation,
        operator: ">=",
        satisfied: burn.timeToNextBurn >= minimumBurnSeparation,
      });
    });
  }
  return { provider: "gmat-console", status: constraints.every((item) => item.satisfied) ? "validated" : "failed", minimumDistance: propagation.minimumDistanceKm, minimumDistanceTime: propagation.minimumDistanceTimeSec, firstRequiredDistance: propagation.firstRequiredDistanceKm, firstRequiredDistanceTime: propagation.firstRequiredDistanceTimeSec, finalDistance: propagation.finalDistanceKm, totalDeltaV, totalTime, burnCount: scoredDecisionVariables.burns.length, constraints, adjustedDecisionVariables: scoredDecisionVariables, adjustment, artifacts: propagation };
}
module.exports = { trimFinalCoastToCompletionTime, validateSubmission };
