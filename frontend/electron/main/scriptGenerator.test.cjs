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

test("adds OpenFrames animation and inspection metrics only to downloaded scripts", () => {
  const value = scenario({ centralBody: "Earth", gravity: { enabled: false } });
  value.scenarioJson.validation = {
    requiredFinalDistanceKm: 5,
    maximumDeltaVPerBurn: 6,
  };
  const variables = {
    tWait: 0,
    finalCoastTime: 100,
    burns: [
      { deltaV: [3, 4, 0], timeToNextBurn: 20 },
      { deltaV: [0, 0, 2] },
    ],
  };
  const workerScript = generateGmatScript({
    scenario: value,
    finalDecisionVariables: variables,
    reportPath: "/tmp/report.txt",
  });
  const downloadScript = generateGmatScript({
    scenario: value,
    finalDecisionVariables: variables,
    reportPath: "Mission_Validation_Report.txt",
    inspectionReportPath: "Mission_Validation_Inspection.txt",
    includeVisualization: true,
  });

  assert.doesNotMatch(workerScript, /OpenFramesInterface/);
  assert.doesNotMatch(workerScript, /InspectionReport/);
  assert.match(downloadScript, /Create OpenFramesView ValidationOrbitView_View;/);
  assert.match(downloadScript, /Create OpenFramesInterface ValidationOrbitView;/);
  assert.match(downloadScript, /ValidationOrbitView\.DrawTrajectory = \[true true true\];/);
  assert.match(downloadScript, /GMAT Burn1DeltaVNormKmPerS = 5;/);
  assert.match(downloadScript, /GMAT Burn2DeltaVNormKmPerS = 2;/);
  assert.match(downloadScript, /GMAT RequiredFinalDistanceKm = 5;/);
  assert.match(downloadScript, /GMAT FinalDistanceKm = sqrt\(/);
  assert.match(downloadScript, /GMAT InspectionReport\.WriteReport = true;/);
  assert.match(downloadScript, /GMAT InspectionReport\.AppendToExistingFile = false;/);
  assert.match(downloadScript, /Report InspectionReport FinalDistanceKm RequiredFinalDistanceKm MaximumDeltaVPerBurnKmPerS Burn1DeltaVNormKmPerS Burn2DeltaVNormKmPerS;/);
});

test("formats Leaderboard downloads like the reference GMAT script without changing dynamics", () => {
  const value = scenario({ centralBody: "Earth", gravity: { enabled: false } });
  const variables = {
    tWait: 10,
    finalCoastTime: 100,
    burns: [
      { deltaV: [0.1, -0.2, 0.3], timeToNextBurn: 20 },
      { deltaV: [0, 0, 0.5] },
    ],
  };
  const script = generateGmatScript({
    scenario: value,
    finalDecisionVariables: variables,
    reportPath: "ODC_2026_Team22.txt",
    inspectionReportPath: "ODC_2026_Team22_Inspection.txt",
    includeVisualization: true,
    outputProfile: "leaderboard",
  });

  assert.match(script, /^%General Mission Analysis Tool\(GMAT\) Script/);
  assert.match(script, /%---------- Spacecraft/);
  assert.match(script, /Create Spacecraft SC_Alien;[\s\S]*Create Spacecraft SC_Human;/);
  assert.match(script, /SC_Alien\.OrbitColor = Red;/);
  assert.match(script, /SC_Human\.OrbitColor = Green;/);
  assert.match(script, /Create ForceModel DefaultProp_ForceModel;/);
  assert.match(script, /DefaultProp_ForceModel\.GravityField\.Earth\.Degree = 0;/);
  assert.match(script, /Create Propagator DefaultProp;/);
  assert.match(script, /Create ImpulsiveBurn ImpulsiveBurn1;/);
  assert.match(script, /ImpulsiveBurn1\.Isp = 300;/);
  assert.match(script, /Create OpenFramesInterface DefaultOrbitView;/);
  assert.match(script, /DefaultOrbitView\.Add = \{SC_Alien, SC_Human, Earth\};/);
  assert.match(script, /Create GroundTrack DefaultGroundTrackPlot;/);
  assert.match(script, /Create ReportFile ReportFile1;/);
  assert.match(script, /ReportFile1\.FixedWidth = true;/);
  assert.match(script, /ReportFile1\.Add = \{SC_Alien\.ElapsedSecs, SC_Alien\.EarthMJ2000Eq\.X, SC_Alien\.EarthMJ2000Eq\.Y, SC_Alien\.EarthMJ2000Eq\.Z, SC_Alien\.EarthMJ2000Eq\.VX, SC_Alien\.EarthMJ2000Eq\.VY, SC_Alien\.EarthMJ2000Eq\.VZ, SC_Human\.ElapsedSecs, SC_Human\.EarthMJ2000Eq\.Y, SC_Human\.EarthMJ2000Eq\.X, SC_Human\.EarthMJ2000Eq\.VX, SC_Human\.EarthMJ2000Eq\.VY, SC_Human\.EarthMJ2000Eq\.VZ, SC_Human\.EarthMJ2000Eq\.Z\};/);
  assert.match(script, /Maneuver ImpulsiveBurn1\(SC_Human\);/);
  assert.match(script, /Propagate DefaultProp\(SC_Alien, SC_Human\) \{SC_Alien\.ElapsedSecs = 20, SC_Human\.ElapsedSecs = 20\};/);
  assert.doesNotMatch(script, /^GMAT /m);
  assert.doesNotMatch(script, /Maneuver ImpulsiveBurn1\(SC_Alien\)/);
});

test("reserves two-team pursuit generation until its ruleset is defined", () => {
  const value = scenario({ centralBody: "Earth" });
  value.scenarioJson.competitionMode = "two-team-pursuit";
  assert.throws(() => generateGmatScript({
    scenario: value,
    finalDecisionVariables: decisionVariables,
    reportPath: "/tmp/report.txt",
  }), /reserved until its ruleset is defined/);
});
