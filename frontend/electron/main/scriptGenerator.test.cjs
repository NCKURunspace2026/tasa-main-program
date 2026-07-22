const assert = require("node:assert/strict");
const test = require("node:test");

const { generateGmatScript } = require("./scriptGenerator.cjs");

function scenario(forceModel) {
  const spacecraft = (positionKm) => ({
    positionKm,
    velocityKmPerSec: [0, 7.5, 0],
  });
  return {
    scenarioJson: {
      epoch: { value: "29 Aug 2026 05:00:00.000" },
      coordinateSystem: "EarthMJ2000Eq",
      spacecraft: {
        chaser: spacecraft([7000, 0, 0]),
        target: spacecraft([7005, 0, 0]),
      },
      forceModel,
      propagator: {},
    },
  };
}

const decisionVariables = { tWait: 0, burns: [], finalCoastTime: 60 };

test("writes the Scenario force model into the GMAT script", () => {
  const script = generateGmatScript({
    scenario: scenario({
      centralBody: "Earth",
      gravity: { enabled: true, degree: 4, order: 2 },
      pointMasses: ["Sun", "Luna"],
      drag: { enabled: true, model: "JacchiaRoberts" },
      solarRadiationPressure: { enabled: true },
      relativisticCorrection: { enabled: true },
    }),
    finalDecisionVariables: decisionVariables,
    reportPath: "/tmp/report.txt",
  });

  assert.match(script, /FM\.PrimaryBodies = \{Earth\}/);
  assert.match(script, /FM\.PointMasses = \{Sun, Luna\}/);
  assert.match(script, /FM\.GravityField\.Earth\.Degree = 4/);
  assert.match(script, /FM\.GravityField\.Earth\.Order = 2/);
  assert.match(script, /FM\.Drag\.AtmosphereModel = JacchiaRoberts/);
  assert.match(script, /FM\.SRP = On/);
  assert.doesNotMatch(script, /FM\.SRP\.Model/);
  assert.match(script, /FM\.RelativisticCorrection = On/);
});

test("uses point-mass central gravity when gravity harmonics are disabled", () => {
  const script = generateGmatScript({
    scenario: scenario({ centralBody: "Earth", gravity: { enabled: false } }),
    finalDecisionVariables: decisionVariables,
    reportPath: "/tmp/report.txt",
  });
  assert.match(script, /FM\.GravityField\.Earth\.Degree = 0/);
  assert.match(script, /FM\.GravityField\.Earth\.Order = 0/);
  assert.match(script, /FM\.Drag\.AtmosphereModel = None/);
  assert.match(script, /FM\.SRP = Off/);
});

test("rejects untrusted force-model tokens before writing a GMAT script", () => {
  assert.throws(() => generateGmatScript({
    scenario: scenario({ centralBody: "Earth; Save evil" }),
    finalDecisionVariables: decisionVariables,
    reportPath: "/tmp/report.txt",
  }), /Central body is not supported/);
});

test("rejects an unsupported propagator before writing a GMAT script", () => {
  const value = scenario({ centralBody: "Earth" });
  value.scenarioJson.propagator.integrator = "RungeKutta89; Save evil";
  assert.throws(() => generateGmatScript({
    scenario: value,
    finalDecisionVariables: decisionVariables,
    reportPath: "/tmp/report.txt",
  }), /Propagator integrator is not supported/);
});

test("converts an ISO UTC epoch to GMAT UTCGregorian format", () => {
  const value = scenario({ centralBody: "Earth" });
  value.scenarioJson.epoch.value = "2026-08-29T05:00:00Z";
  const script = generateGmatScript({
    scenario: value,
    finalDecisionVariables: decisionVariables,
    reportPath: "/tmp/report.txt",
  });
  assert.match(script, /Epoch = '29 Aug 2026 05:00:00\.000'/);
});
