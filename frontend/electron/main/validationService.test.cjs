const assert = require("node:assert/strict");
const test = require("node:test");

const { trimFinalCoastToCompletionTime } = require("./validationService.cjs");

test("trims final coast to the completion time", () => {
  const decisionVariables = {
    tWait: 10,
    burns: [
      { deltaV: [0.1, 0, 0], timeToNextBurn: 100 },
      { deltaV: [0.2, 0, 0] },
    ],
    finalCoastTime: 500,
  };

  const result = trimFinalCoastToCompletionTime(decisionVariables, 250);

  assert.equal(result.decisionVariables.finalCoastTime, 140);
  assert.equal(result.adjustment.originalTotalTime, 610);
  assert.equal(result.adjustment.adjustedTotalTime, 250);
});

test("removes burns after an intercept during an earlier coast", () => {
  const decisionVariables = {
    tWait: 10,
    burns: [
      { deltaV: [0.1, 0, 0], timeToNextBurn: 100 },
      { deltaV: [0.2, 0, 0] },
    ],
    finalCoastTime: 500,
  };

  const result = trimFinalCoastToCompletionTime(decisionVariables, 50);

  assert.deepEqual(result.decisionVariables.burns, [
    { deltaV: [0.1, 0, 0], timeToNextBurn: null },
  ]);
  assert.equal(result.decisionVariables.finalCoastTime, 40);
  assert.equal(result.adjustment.adjustedTotalTime, 50);
});

test("removes all burns when interception occurs during initial coast", () => {
  const decisionVariables = {
    tWait: 10,
    burns: [{ deltaV: [0.1, 0, 0] }],
    finalCoastTime: 500,
  };
  const result = trimFinalCoastToCompletionTime(decisionVariables, 5);
  assert.equal(result.decisionVariables.tWait, 5);
  assert.deepEqual(result.decisionVariables.burns, []);
  assert.equal(result.adjustment.adjustedTotalTime, 5);
});
