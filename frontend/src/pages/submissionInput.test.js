import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDeltaVVector,
  normalizeSubmissionFile,
  parseMatlabDecisionVariables,
  parseDeltaVVector,
} from "./submissionInput.js";

test("parses pasted Delta-V vectors", () => {
  assert.deepEqual(parseDeltaVVector("[0.1, -2e-3, 4]"), [0.1, -0.002, 4]);
  assert.deepEqual(parseDeltaVVector("0.1 0.2 0.3"), [0.1, 0.2, 0.3]);
  assert.equal(formatDeltaVVector([0.1, 0.2, 0.3]), "[0.1, 0.2, 0.3]");
});

test("loads a complete submission package", () => {
  assert.deepEqual(normalizeSubmissionFile({
    scenarioId: "SC-001",
    name: "Apex Trajectory",
    initialCoastTimeS: 10,
    burns: [
      { deltaV: { x: 0.1, y: 0.2, z: 0.3 }, timeToNextBurnS: 100 },
      { deltaV: { x: -0.1, y: 0, z: 0 } },
    ],
    finalCoastTimeS: 500,
  }), {
    name: "Apex Trajectory",
    scenarioId: "SC-001",
    tWait: 10,
    burns: [
      { deltaV: [0.1, 0.2, 0.3], coastTime: 100 },
      { deltaV: [-0.1, 0, 0], coastTime: null },
    ],
    finalCoastTime: 500,
  });
});

test("rejects incomplete vectors and burn timing", () => {
  assert.throws(() => parseDeltaVVector("1, 2"), /exactly three/);
  assert.throws(() => normalizeSubmissionFile({
    tWait: 0,
    burns: [{ deltaV: [1, 2, 3] }, { deltaV: [0, 0, 0] }],
    finalCoastTime: 10,
  }), /time to next burn/);
  assert.throws(() => normalizeSubmissionFile({
    initialCoastTimeS: 0,
    burns: [],
    finalCoastTimeS: 10,
  }), /at least one burn/);
});

test("parses MATLAB matrix output as 3 by N Delta-V values", () => {
  const parsed = parseMatlabDecisionVariables(`
    tWait0 = 0;
    deltaV0 = [
      0.1 0.0 0.0
      0.0 -0.05 0.0
      0.0 0.0 0.0
    ];
    deltaT0 = [100; 100];
    tCoast0 = 5000;
  `);
  assert.deepEqual(parsed.burns.map((burn) => burn.deltaV), [
    [0.1, 0, 0],
    [0, -0.05, 0],
    [0, 0, 0],
  ]);
  assert.deepEqual(parsed.burns.map((burn) => burn.coastTime), [100, 100, null]);
  assert.deepEqual(parsed.matrixShape, {
    deltaVRows: 3,
    deltaVColumns: 3,
    deltaTRows: 2,
    deltaTColumns: 1,
    orientation: "rows",
  });
});

test("parses the optimizer N by 3 output format", () => {
  const parsed = parseMatlabDecisionVariables(`
    tWait0 = 7003.758905526603;
    deltaV0 = [
      0.000000024357 -0.000000046306 0.000000032362
      0.000004036900 -0.000002046450 0.000001539386
      1.024175948520 -0.283927452500 0.272764557237
      0.1 0.2 0.3
    ];
    deltaT0 = [132.8; 105.2; 118.15];
    tCoast0 = 11607.085037744951;
  `);
  assert.equal(parsed.burns.length, 4);
  assert.deepEqual(parsed.burns[0].deltaV, [0.000000024357, -0.000000046306, 0.000000032362]);
  assert.equal(parsed.burns[3].coastTime, null);
  assert.equal(parsed.matrixShape.orientation, "rows");
});
