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

test("does not trim when completion occurred before final coast", () => {
  const decisionVariables = {
    tWait: 10,
    burns: [
      { deltaV: [0.1, 0, 0], timeToNextBurn: 100 },
      { deltaV: [0.2, 0, 0] },
    ],
    finalCoastTime: 500,
  };

  const result = trimFinalCoastToCompletionTime(decisionVariables, 50);

  assert.equal(result.decisionVariables, decisionVariables);
  assert.equal(result.adjustment, null);
});
