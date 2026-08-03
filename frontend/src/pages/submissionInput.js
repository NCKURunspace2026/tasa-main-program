export function parseDeltaVVector(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value = [value.x, value.y, value.z];
  }
  const components = Array.isArray(value)
    ? value
    : String(value ?? "")
      .trim()
      .replace(/^\[|\]$/g, "")
      .replace(/^\(|\)$/g, "")
      .split(/[\s,]+/)
      .filter(Boolean);

  if (components.length !== 3) {
    throw new Error("Each Delta-V vector must contain exactly three values.");
  }
  const vector = components.map(Number);
  if (!vector.every(Number.isFinite)) {
    throw new Error("Every Delta-V component must be a finite number.");
  }
  return vector;
}

export function normalizeSubmissionFile(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Submission JSON must contain an object.");
  }
  const solution = data.solution && typeof data.solution === "object" ? data.solution : {};
  const decisionVariables = solution.decisionVariables
    ?? data.decisionVariables
    ?? data.decision_variables
    ?? data;
  if (!decisionVariables || typeof decisionVariables !== "object" || Array.isArray(decisionVariables)) {
    throw new Error("Submission JSON is missing decision variables.");
  }

  if (decisionVariables.deltaV0 !== undefined) {
    return normalizeMatrixDecisionVariables(data, decisionVariables);
  }

  const tWait = nonNegativeNumber(
    decisionVariables.initialCoastTimeS
      ?? decisionVariables.tWait
      ?? decisionVariables.initialCoastTime,
    "Initial coast time",
  );
  const finalCoastTime = nonNegativeNumber(
    decisionVariables.finalCoastTimeS ?? decisionVariables.finalCoastTime,
    "Final coast time",
  );
  if (!Array.isArray(decisionVariables.burns) || decisionVariables.burns.length < 1) {
    throw new Error("Submission JSON must contain at least one burn.");
  }
  if (decisionVariables.burns.length > 100) {
    throw new Error("A submission can contain at most 100 burns.");
  }

  const burns = decisionVariables.burns.map((burn, index) => {
    if (!burn || typeof burn !== "object" || Array.isArray(burn)) {
      throw new Error(`Burn ${index + 1} must be an object.`);
    }
    const deltaV = parseDeltaVVector(burn.deltaV ?? burn.vector);
    const isLast = index === decisionVariables.burns.length - 1;
    const coastTime = isLast
      ? null
      : nonNegativeNumber(
        burn.timeToNextBurnS ?? burn.timeToNextBurn ?? burn.coastTime,
        `Burn ${index + 1} time to next burn`,
      );
    return { deltaV, coastTime };
  });

  return {
    name: String(solution.name ?? data.name ?? data.team ?? data.solution_name ?? "").trim(),
    scenarioId: String(data.scenarioId ?? data.scenario_id ?? "").trim(),
    tWait,
    burns,
    finalCoastTime,
  };
}

export function parseMatlabDecisionVariables(source) {
  const text = String(source ?? "");
  const tWait0 = parseMatlabScalar(text, "tWait0");
  const deltaV0 = parseMatlabMatrix(text, "deltaV0");
  const deltaT0 = parseMatlabMatrix(text, "deltaT0");
  const tCoast0 = parseMatlabScalar(text, "tCoast0");
  const orientation = detectMatrixOrientation(deltaV0);
  const burnCount = orientation === "rows" ? deltaV0.length : deltaV0[0].length;
  const deltaTimes = deltaT0.flat();
  if (deltaTimes.length !== burnCount - 1) {
    throw new Error(`deltaT0 must contain N-1 values (${burnCount - 1} expected).`);
  }
  return {
    name: "",
    scenarioId: "",
    tWait: nonNegativeNumber(tWait0, "tWait0"),
    burns: Array.from({ length: burnCount }, (_, index) => ({
      deltaV: orientation === "rows"
        ? deltaV0[index]
        : [deltaV0[0][index], deltaV0[1][index], deltaV0[2][index]],
      coastTime: index < burnCount - 1 ? nonNegativeNumber(deltaTimes[index], `deltaT0(${index + 1})`) : null,
    })),
    finalCoastTime: nonNegativeNumber(tCoast0, "tCoast0"),
    matrixShape: { deltaVRows: deltaV0.length, deltaVColumns: deltaV0[0].length, deltaTRows: deltaTimes.length, deltaTColumns: 1, orientation },
  };
}

function normalizeMatrixDecisionVariables(data, decisionVariables) {
  const rawMatrix = decisionVariables.deltaV0;
  if (!Array.isArray(rawMatrix) || rawMatrix.length < 1) {
    throw new Error("deltaV0 must contain at least one burn.");
  }
  const orientation = detectMatrixOrientation(rawMatrix);
  const burnCount = orientation === "rows" ? rawMatrix.length : rawMatrix[0].length;
  const deltaTimes = Array.isArray(decisionVariables.deltaT0) ? decisionVariables.deltaT0.flat() : [];
  if (deltaTimes.length !== burnCount - 1) {
    throw new Error(`deltaT0 must contain N-1 values (${burnCount - 1} expected).`);
  }
  const matrix = rawMatrix.map((row) => row.map((value) => finiteNumber(value, "deltaV0")));
  return {
    name: String(data.name ?? data.solution?.name ?? "").trim(),
    scenarioId: String(data.scenarioId ?? "").trim(),
    tWait: nonNegativeNumber(decisionVariables.tWait0, "tWait0"),
    burns: Array.from({ length: burnCount }, (_, index) => ({
      deltaV: orientation === "rows" ? matrix[index] : [matrix[0][index], matrix[1][index], matrix[2][index]],
      coastTime: index < burnCount - 1 ? nonNegativeNumber(deltaTimes[index], `deltaT0[${index}]`) : null,
    })),
    finalCoastTime: nonNegativeNumber(decisionVariables.tCoast0, "tCoast0"),
    matrixShape: { deltaVRows: matrix.length, deltaVColumns: matrix[0].length, deltaTRows: deltaTimes.length, deltaTColumns: 1, orientation },
  };
}

function parseMatlabScalar(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)`));
  if (!match) throw new Error(`${name} was not found.`);
  return Number(match[1]);
}

function parseMatlabMatrix(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) throw new Error(`${name} was not found.`);
  const rows = match[1].split(/[;\n]+/).map((row) => row.trim()).filter(Boolean);
  return rows.map((row) => row.split(/[ ,]+/).filter(Boolean).map((value) => finiteNumber(value, name)));
}

function detectMatrixOrientation(matrix) {
  const rowCount = matrix.length;
  const columnCount = matrix[0]?.length ?? 0;
  if (!matrix.every((row) => Array.isArray(row) && row.length === columnCount)) {
    throw new Error("deltaV0 must be a rectangular matrix.");
  }
  if (rowCount === 3 && columnCount !== 3) return "columns";
  if (columnCount === 3) return "rows";
  throw new Error("deltaV0 must be either 3 x N or N x 3, with N from 1 to 100.");
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} contains a non-finite number.`);
  return number;
}

export function formatDeltaVVector(vector) {
  return `[${vector.map((value) => String(value)).join(", ")}]`;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (value === "" || value == null || !Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a finite number greater than or equal to zero.`);
  }
  return number;
}
