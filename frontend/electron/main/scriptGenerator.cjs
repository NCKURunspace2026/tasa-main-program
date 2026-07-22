function requireState(definition, stateName) {
  const state = definition?.[stateName];
  if (!state || !Array.isArray(state.positionKm) || !Array.isArray(state.velocityKmPerS)
    || state.positionKm.length !== 3 || state.velocityKmPerS.length !== 3) {
    throw new Error(`Scenario definition is missing ${stateName} Cartesian state (km, km/s).`);
  }
  const values = [...state.positionKm, ...state.velocityKmPerS];
  if (values.some((value) => !Number.isFinite(Number(value)))) {
    throw new Error(`${stateName} Cartesian state must contain finite numeric values.`);
  }
  return {
    ...state,
    positionKm: state.positionKm.map(Number),
    velocityKmPerS: state.velocityKmPerS.map(Number),
  };
}

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a finite value greater than zero.`);
  }
  return number;
}

function getFormalScenarioState(scenario, role) {
  const definition = scenario.scenarioJson ?? scenario.definition;
  const spacecraft = definition?.spacecraft?.[role];
  const position = spacecraft?.positionKm ?? spacecraft?.initialState?.position;
  const velocity = spacecraft?.velocityKmPerSec ?? spacecraft?.initialState?.velocity;
  if (!Array.isArray(position) || !Array.isArray(velocity)) {
    return null;
  }
  if (position.length !== 3 || velocity.length !== 3
    || [...position, ...velocity].some((value) => !Number.isFinite(Number(value)))) {
    throw new Error(`${role} Cartesian state must contain three finite numeric values per vector.`);
  }
  return {
    epochUtc: definition.epoch?.value ?? definition.epoch,
    positionKm: position.map(Number),
    velocityKmPerS: velocity.map(Number),
    physicalProperties: {
      dryMassKg: finitePositive(spacecraft?.physicalProperties?.dryMassKg ?? 850, `${role} dry mass`),
      dragAreaM2: finitePositive(spacecraft?.physicalProperties?.dragAreaM2 ?? 15, `${role} drag area`),
      srpAreaM2: finitePositive(spacecraft?.physicalProperties?.srpAreaM2 ?? 1, `${role} SRP area`),
      coefficientOfDrag: finitePositive(spacecraft?.physicalProperties?.coefficientOfDrag ?? 2.2, `${role} coefficient of drag`),
      coefficientOfReflectivity: finitePositive(spacecraft?.physicalProperties?.coefficientOfReflectivity ?? 1.8, `${role} coefficient of reflectivity`),
    },
  };
}

const CELESTIAL_BODIES = new Set([
  "Earth", "Luna", "Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune",
]);
const ATMOSPHERE_MODELS = new Set(["JacchiaRoberts", "MSISE90"]);
const INTEGRATORS = new Set(["RungeKutta89", "PrinceDormand78", "RungeKutta68", "RungeKutta56"]);

function requireAllowed(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label} is not supported by the local GMAT runner.`);
  return value;
}

function toGmatUtcGregorian(value) {
  if (typeof value !== "string") throw new Error("Scenario epoch must be a UTC date string.");
  const trimmed = value.trim();
  if (/^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(trimmed)) {
    return trimmed;
  }
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?Z$/);
  if (!isoMatch) {
    throw new Error("Scenario epoch must use ISO 8601 UTC or GMAT UTCGregorian format.");
  }
  const [, year, month, day, hour, minute, second, fraction = "0"] = isoMatch;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = Number(month) - 1;
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp) || monthIndex < 0 || monthIndex > 11) {
    throw new Error("Scenario epoch is not a valid UTC date.");
  }
  return `${Number(day)} ${monthNames[monthIndex]} ${year} ${hour}:${minute}:${second}.${fraction.padEnd(3, "0")}`;
}

function normalizeForceModel(definition) {
  const forceModel = definition.forceModel ?? {};
  const centralBody = requireAllowed(forceModel.centralBody ?? "Earth", CELESTIAL_BODIES, "Central body");
  const gravity = forceModel.gravityField ?? forceModel.gravity ?? {};
  const gravityEnabled = gravity.enabled ?? Object.keys(gravity).length > 0;
  const degree = gravityEnabled ? Number(gravity.degree ?? 0) : 0;
  const order = gravityEnabled ? Number(gravity.order ?? 0) : 0;
  if (!Number.isInteger(degree) || degree < 0 || !Number.isInteger(order) || order < 0 || order > degree) {
    throw new Error("Gravity degree and order must be non-negative integers, with order no greater than degree.");
  }
  const pointMasses = [...new Set(forceModel.pointMasses ?? [])].map((body) => (
    requireAllowed(body, CELESTIAL_BODIES, "Point-mass body")
  ));
  if (pointMasses.includes(centralBody)) {
    throw new Error("The central body cannot also be configured as a point-mass perturbation.");
  }
  const dragEnabled = Boolean(forceModel.drag?.enabled);
  if (dragEnabled && centralBody !== "Earth") {
    throw new Error("The configured atmosphere models currently support Earth only.");
  }
  const dragModel = dragEnabled
    ? requireAllowed(forceModel.drag?.model ?? "JacchiaRoberts", ATMOSPHERE_MODELS, "Atmosphere model")
    : "None";
  const srpEnabled = Boolean(forceModel.solarRadiationPressure?.enabled);
  return {
    centralBody,
    degree,
    order,
    pointMasses,
    dragEnabled,
    dragModel,
    srpEnabled,
    relativityEnabled: Boolean(forceModel.relativisticCorrection?.enabled),
  };
}

function generateGmatScript({ scenario, finalDecisionVariables, reportPath }) {
  const definition = scenario.scenarioJson ?? scenario.definition;
  const chaser = getFormalScenarioState(scenario, "chaser") ?? requireState(definition, "chaserInitialState");
  const target = getFormalScenarioState(scenario, "target") ?? requireState(definition, "targetInitialState");
  const sourceEpoch = chaser.epochUtc;
  if (!sourceEpoch || sourceEpoch !== target.epochUtc) {
    throw new Error("Chaser and target must use the same epochUtc for local GMAT validation.");
  }
  const epoch = toGmatUtcGregorian(sourceEpoch);
  const frame = definition.coordinateSystem ?? definition.referenceFrame ?? "EarthMJ2000Eq";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(frame)) {
    throw new Error("Scenario coordinate system contains unsupported characters.");
  }
  const forceModel = normalizeForceModel(definition);
  const propagator = definition.propagator ?? {};
  const integrator = requireAllowed(
    propagator.integrator ?? "RungeKutta89",
    INTEGRATORS,
    "Propagator integrator",
  );
  const chaserName = "ChaserSC";
  const targetName = "TargetSC";
  const initialStep = finitePositive(propagator.initialStepSec ?? 1, "Initial step");
  const maxStep = finitePositive(propagator.maxStepSec ?? 1, "Maximum step");
  const minStep = finitePositive(propagator.minStepSec ?? 0.001, "Minimum step");
  const accuracy = finitePositive(propagator.accuracy ?? 1e-12, "Propagator accuracy");
  if (!(minStep <= initialStep && initialStep <= maxStep)) {
    throw new Error("Propagator steps must satisfy minStepSec <= initialStepSec <= maxStepSec.");
  }
  const burnDefinitions = finalDecisionVariables.burns.flatMap((burn, index) => {
    const name = `Burn${index + 1}`;
    return [
      `Create ImpulsiveBurn ${name};`,
      `GMAT ${name}.Element1 = ${burn.deltaV[0]};`,
      `GMAT ${name}.Element2 = ${burn.deltaV[1]};`,
      `GMAT ${name}.Element3 = ${burn.deltaV[2]};`,
      `GMAT ${name}.CoordinateSystem = ${frame};`,
      `GMAT ${name}.DecrementMass = false;`,
    ];
  });
  const lines = [
    "% Generated by Mission Dashboard. Units: km, km/s, s.",
    `Create Spacecraft ${chaserName};`, `Create Spacecraft ${targetName};`,
    `GMAT ${chaserName}.DateFormat = UTCGregorian;`, `GMAT ${targetName}.DateFormat = UTCGregorian;`,
    `GMAT ${chaserName}.Epoch = '${epoch}';`, `GMAT ${targetName}.Epoch = '${epoch}';`,
    `GMAT ${chaserName}.CoordinateSystem = ${frame};`, `GMAT ${targetName}.CoordinateSystem = ${frame};`,
    `GMAT ${chaserName}.DisplayStateType = Cartesian;`, `GMAT ${targetName}.DisplayStateType = Cartesian;`,
    ...["X", "Y", "Z", "VX", "VY", "VZ"].flatMap((key, index) => [
      `GMAT ${chaserName}.${key} = ${[...chaser.positionKm, ...chaser.velocityKmPerS][index]};`,
      `GMAT ${targetName}.${key} = ${[...target.positionKm, ...target.velocityKmPerS][index]};`,
    ]),
    ...[
      [chaserName, chaser.physicalProperties],
      [targetName, target.physicalProperties],
    ].flatMap(([name, properties]) => properties ? [
      `GMAT ${name}.DryMass = ${properties.dryMassKg};`,
      `GMAT ${name}.DragArea = ${properties.dragAreaM2};`,
      `GMAT ${name}.SRPArea = ${properties.srpAreaM2};`,
      `GMAT ${name}.Cd = ${properties.coefficientOfDrag};`,
      `GMAT ${name}.Cr = ${properties.coefficientOfReflectivity};`,
    ] : []),
    "Create ForceModel FM;",
    `GMAT FM.CentralBody = ${forceModel.centralBody};`,
    `GMAT FM.PrimaryBodies = {${forceModel.centralBody}};`,
    `GMAT FM.PointMasses = {${forceModel.pointMasses.join(", ")}};`,
    `GMAT FM.GravityField.${forceModel.centralBody}.Degree = ${forceModel.degree};`,
    `GMAT FM.GravityField.${forceModel.centralBody}.Order = ${forceModel.order};`,
    `GMAT FM.Drag.AtmosphereModel = ${forceModel.dragModel};`,
    `GMAT FM.SRP = ${forceModel.srpEnabled ? "On" : "Off"};`,
    `GMAT FM.RelativisticCorrection = ${forceModel.relativityEnabled ? "On" : "Off"};`,
    "Create Propagator Prop;", "GMAT Prop.FM = FM;",
    `GMAT Prop.Type = ${integrator};`,
    `GMAT Prop.InitialStepSize = ${initialStep};`,
    `GMAT Prop.MaxStep = ${maxStep};`,
    `GMAT Prop.MinStep = ${minStep};`,
    `GMAT Prop.Accuracy = ${accuracy};`,
    "Create ReportFile ValidationReport;", `GMAT ValidationReport.Filename = '${reportPath.replaceAll("\\", "/")}';`,
    `GMAT ValidationReport.Add = {${chaserName}.X, ${chaserName}.Y, ${chaserName}.Z, ${targetName}.X, ${targetName}.Y, ${targetName}.Z};`,
    ...burnDefinitions,
    "BeginMissionSequence;",
  ];
  if (finalDecisionVariables.tWait > 0) lines.push(`Propagate Prop(${chaserName}, ${targetName}) {${chaserName}.ElapsedSecs = ${finalDecisionVariables.tWait}};`);
  finalDecisionVariables.burns.forEach((burn, index) => {
    const name = `Burn${index + 1}`;
    lines.push(`Maneuver ${name}(${chaserName});`);
    if (burn.timeToNextBurn != null) lines.push(`Propagate Prop(${chaserName}, ${targetName}) {${chaserName}.ElapsedSecs = ${burn.timeToNextBurn}};`);
  });
  lines.push(
    `Propagate Prop(${chaserName}, ${targetName}) {${chaserName}.ElapsedSecs = ${finalDecisionVariables.finalCoastTime}};`,
    `Report ValidationReport ${chaserName}.X ${chaserName}.Y ${chaserName}.Z ${targetName}.X ${targetName}.Y ${targetName}.Z;`,
  );
  return `${lines.join("\n")}\n`;
}

module.exports = { generateGmatScript };
