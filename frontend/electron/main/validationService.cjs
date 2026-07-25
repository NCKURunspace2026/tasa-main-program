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

  const originalTotalTime = totalMissionTime(finalDecisionVariables);
  const toleranceSec = 1e-6;
  if (completionTimeSec >= originalTotalTime - toleranceSec) {
    return { decisionVariables: finalDecisionVariables, adjustment: null };
  }

  if (completionTimeSec <= finalDecisionVariables.tWait + toleranceSec) {
    const adjusted = {
      ...finalDecisionVariables,
      tWait: Math.max(0, completionTimeSec),
      burns: [],
      finalCoastTime: 0,
    };
    return completionAdjustment(finalDecisionVariables, adjusted, completionTimeSec, originalTotalTime);
  }

  let elapsed = finalDecisionVariables.tWait;
  for (let index = 0; index < finalDecisionVariables.burns.length - 1; index += 1) {
    const coastTime = finalDecisionVariables.burns[index].timeToNextBurn ?? 0;
    if (completionTimeSec <= elapsed + coastTime + toleranceSec) {
      const burns = finalDecisionVariables.burns.slice(0, index + 1).map((burn) => ({ ...burn }));
      burns[burns.length - 1].timeToNextBurn = null;
      const adjusted = {
        ...finalDecisionVariables,
        burns,
        finalCoastTime: Math.max(0, completionTimeSec - elapsed),
      };
      return completionAdjustment(finalDecisionVariables, adjusted, completionTimeSec, originalTotalTime);
    }
    elapsed += coastTime;
  }

  const adjusted = {
    ...finalDecisionVariables,
    finalCoastTime: Math.max(0, completionTimeSec - elapsed),
  };
  return completionAdjustment(finalDecisionVariables, adjusted, completionTimeSec, originalTotalTime);
}

function completionAdjustment(original, adjusted, completionTimeSec, originalTotalTime) {
  return {
    decisionVariables: adjusted,
    adjustment: {
      type: "trim-mission-to-first-intercept",
      originalFinalCoastTime: original.finalCoastTime,
      adjustedFinalCoastTime: adjusted.finalCoastTime,
      originalTotalTime,
      adjustedTotalTime: totalMissionTime(adjusted),
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
  const deltaVPerBurnLimit = limits.maximumDeltaVPerBurn;
  const timeLimit = limits.maximumSimulationTimeSec
    ?? limits.maximumMissionTimeSec
    ?? limits.maximumMissionTime;
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
