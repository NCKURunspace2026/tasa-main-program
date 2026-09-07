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

function gmatString(value) {
  return String(value).replaceAll("\\", "/").replaceAll("'", "''");
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

function generateGmatScript({
  scenario,
  finalDecisionVariables,
  reportPath,
  inspectionReportPath = null,
  includeVisualization = false,
  outputProfile = "validation",
}) {
  const definition = scenario.scenarioJson ?? scenario.definition;
  if (definition?.competitionMode === "two-team-pursuit") {
    throw new Error("Two-team pursuit GMAT generation is reserved until its ruleset is defined.");
  }
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
  const limits = definition.validation ?? definition.constraints ?? {};
  const requiredFinalDistanceKm = limits.requiredFinalDistanceKm
    ?? limits.interceptionDistance
    ?? limits.finalDistanceThreshold
    ?? limits.maximumFinalDistance;
  const maximumDeltaVPerBurn = limits.maximumDeltaVPerBurn;
  const integrator = requireAllowed(
    propagator.integrator ?? "RungeKutta89",
    INTEGRATORS,
    "Propagator integrator",
  );
  const isLeaderboardDownload = outputProfile === "leaderboard";
  const chaserName = isLeaderboardDownload ? "SC_Human" : "ChaserSC";
  const targetName = isLeaderboardDownload ? "SC_Alien" : "TargetSC";
  const forceModelName = isLeaderboardDownload ? "DefaultProp_ForceModel" : "FM";
  const propagatorName = isLeaderboardDownload ? "DefaultProp" : "Prop";
  const reportName = isLeaderboardDownload ? "ReportFile1" : "ValidationReport";
  const orbitViewName = isLeaderboardDownload ? "DefaultOrbitView" : "ValidationOrbitView";
  const orbitViewObjectName = `${orbitViewName}_View`;
  const spacecraftList = isLeaderboardDownload
    ? `${targetName}, ${chaserName}`
    : `${chaserName}, ${targetName}`;
  const reportField = (spacecraftName, field) => isLeaderboardDownload
    ? `${spacecraftName}.${frame}.${field}`
    : `${spacecraftName}.${field}`;
  const reportFields = isLeaderboardDownload ? [
    `${targetName}.ElapsedSecs`,
    ...["X", "Y", "Z", "VX", "VY", "VZ"].map((field) => reportField(targetName, field)),
    `${chaserName}.ElapsedSecs`,
    ...["Y", "X", "VX", "VY", "VZ", "Z"].map((field) => reportField(chaserName, field)),
  ] : [
    `${chaserName}.ElapsedSecs`,
    ...["X", "Y", "Z"].map((field) => reportField(chaserName, field)),
    ...["X", "Y", "Z"].map((field) => reportField(targetName, field)),
  ];
  const initialStep = finitePositive(propagator.initialStepSec ?? 1, "Initial step");
  const maxStep = finitePositive(propagator.maxStepSec ?? 1, "Maximum step");
  const minStep = finitePositive(propagator.minStepSec ?? 0.001, "Minimum step");
  const accuracy = finitePositive(propagator.accuracy ?? 1e-12, "Propagator accuracy");
  if (!(minStep <= initialStep && initialStep <= maxStep)) {
    throw new Error("Propagator steps must satisfy minStepSec <= initialStepSec <= maxStepSec.");
  }
  const burnDefinitions = finalDecisionVariables.burns.flatMap((burn, index) => {
    const name = `${isLeaderboardDownload ? "ImpulsiveBurn" : "Burn"}${index + 1}`;
    return [
      `Create ImpulsiveBurn ${name};`,
      `GMAT ${name}.Element1 = ${burn.deltaV[0]};`,
      `GMAT ${name}.Element2 = ${burn.deltaV[1]};`,
      `GMAT ${name}.Element3 = ${burn.deltaV[2]};`,
      `GMAT ${name}.CoordinateSystem = ${frame};`,
      `GMAT ${name}.DecrementMass = false;`,
      ...(isLeaderboardDownload ? [
        `GMAT ${name}.Isp = 300;`,
        `GMAT ${name}.GravitationalAccel = 9.81;`,
      ] : []),
    ];
  });
  const burnNorms = finalDecisionVariables.burns.map((burn) => Math.hypot(...burn.deltaV));
  const burnNormVariableNames = burnNorms.map((_, index) => `Burn${index + 1}DeltaVNormKmPerS`);
  const inspectionVariableNames = [
    "FinalDistanceKm",
    ...(Number.isFinite(requiredFinalDistanceKm) ? ["RequiredFinalDistanceKm"] : []),
    ...(Number.isFinite(maximumDeltaVPerBurn) ? ["MaximumDeltaVPerBurnKmPerS"] : []),
    ...burnNormVariableNames,
  ];
  const lines = [
    ...(isLeaderboardDownload ? [
      "%General Mission Analysis Tool(GMAT) Script",
      "%Created by Mission Dashboard",
      "",
      "%----------------------------------------",
      "%---------- Spacecraft",
      "%----------------------------------------",
      "",
    ] : ["% Generated by Mission Dashboard. Units: km, km/s, s."]),
    ...(isLeaderboardDownload
      ? [`Create Spacecraft ${targetName};`, `Create Spacecraft ${chaserName};`]
      : [`Create Spacecraft ${chaserName};`, `Create Spacecraft ${targetName};`]),
    `GMAT ${chaserName}.DateFormat = UTCGregorian;`, `GMAT ${targetName}.DateFormat = UTCGregorian;`,
    `GMAT ${chaserName}.Epoch = '${epoch}';`, `GMAT ${targetName}.Epoch = '${epoch}';`,
    `GMAT ${chaserName}.CoordinateSystem = ${frame};`, `GMAT ${targetName}.CoordinateSystem = ${frame};`,
    `GMAT ${chaserName}.DisplayStateType = Cartesian;`, `GMAT ${targetName}.DisplayStateType = Cartesian;`,
    ...(includeVisualization ? (isLeaderboardDownload ? [
      `GMAT ${targetName}.OrbitColor = Red;`,
      `GMAT ${targetName}.TargetColor = Teal;`,
      `GMAT ${chaserName}.OrbitColor = Green;`,
      `GMAT ${chaserName}.TargetColor = LightGray;`,
    ] : [
      `GMAT ${chaserName}.OrbitColor = Red;`,
      `GMAT ${chaserName}.TargetColor = Teal;`,
      `GMAT ${targetName}.OrbitColor = Green;`,
      `GMAT ${targetName}.TargetColor = Yellow;`,
    ]) : []),
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
    ...(isLeaderboardDownload ? [targetName, chaserName].flatMap((name) => [
      `GMAT ${name}.SPADDragScaleFactor = 1;`,
      `GMAT ${name}.SPADSRPScaleFactor = 1;`,
      `GMAT ${name}.AtmosDensityScaleFactor = 1;`,
      `GMAT ${name}.ExtendedMassPropertiesModel = 'None';`,
      `GMAT ${name}.OrbitErrorCovariance = [ 1e+70 0 0 0 0 0 ; 0 1e+70 0 0 0 0 ; 0 0 1e+70 0 0 0 ; 0 0 0 1e+70 0 0 ; 0 0 0 0 1e+70 0 ; 0 0 0 0 0 1e+70 ];`,
      `GMAT ${name}.CdSigma = 1e+70;`,
      `GMAT ${name}.CrSigma = 1e+70;`,
      `GMAT ${name}.Id = 'SatId';`,
      `GMAT ${name}.Attitude = CoordinateSystemFixed;`,
      `GMAT ${name}.SPADSRPInterpolationMethod = Bilinear;`,
      `GMAT ${name}.SPADSRPScaleFactorSigma = 1e+70;`,
      `GMAT ${name}.SPADDragInterpolationMethod = Bilinear;`,
      `GMAT ${name}.SPADDragScaleFactorSigma = 1e+70;`,
      `GMAT ${name}.AtmosDensityScaleFactorSigma = 1e+70;`,
      `GMAT ${name}.ModelFile = 'aura.3ds';`,
      `GMAT ${name}.ModelOffsetX = 0;`,
      `GMAT ${name}.ModelOffsetY = 0;`,
      `GMAT ${name}.ModelOffsetZ = 0;`,
      `GMAT ${name}.ModelRotationX = 0;`,
      `GMAT ${name}.ModelRotationY = 0;`,
      `GMAT ${name}.ModelRotationZ = 0;`,
      `GMAT ${name}.ModelScale = 1;`,
      `GMAT ${name}.AttitudeDisplayStateType = 'Quaternion';`,
      `GMAT ${name}.AttitudeRateDisplayStateType = 'AngularVelocity';`,
      `GMAT ${name}.AttitudeCoordinateSystem = ${frame};`,
      `GMAT ${name}.EulerAngleSequence = '321';`,
    ]) : []),
    ...(isLeaderboardDownload ? [
      "",
      "%----------------------------------------",
      "%---------- ForceModels",
      "%----------------------------------------",
      "",
    ] : []),
    `Create ForceModel ${forceModelName};`,
    `GMAT ${forceModelName}.CentralBody = ${forceModel.centralBody};`,
    `GMAT ${forceModelName}.PrimaryBodies = {${forceModel.centralBody}};`,
    `GMAT ${forceModelName}.PointMasses = {${forceModel.pointMasses.join(", ")}};`,
    `GMAT ${forceModelName}.GravityField.${forceModel.centralBody}.Degree = ${forceModel.degree};`,
    `GMAT ${forceModelName}.GravityField.${forceModel.centralBody}.Order = ${forceModel.order};`,
    `GMAT ${forceModelName}.Drag.AtmosphereModel = ${forceModel.dragModel};`,
    `GMAT ${forceModelName}.SRP = ${forceModel.srpEnabled ? "On" : "Off"};`,
    `GMAT ${forceModelName}.RelativisticCorrection = ${forceModel.relativityEnabled ? "On" : "Off"};`,
    ...(isLeaderboardDownload ? [
      "",
      "%----------------------------------------",
      "%---------- Propagators",
      "%----------------------------------------",
      "",
    ] : []),
    `Create Propagator ${propagatorName};`, `GMAT ${propagatorName}.FM = ${forceModelName};`,
    `GMAT ${propagatorName}.Type = ${integrator};`,
    `GMAT ${propagatorName}.InitialStepSize = ${initialStep};`,
    `GMAT ${propagatorName}.MaxStep = ${maxStep};`,
    `GMAT ${propagatorName}.MinStep = ${minStep};`,
    `GMAT ${propagatorName}.Accuracy = ${accuracy};`,
    ...(isLeaderboardDownload ? [
      `GMAT ${propagatorName}.MaxStepAttempts = 50;`,
      `GMAT ${propagatorName}.StopIfAccuracyIsViolated = true;`,
    ] : []),
    ...(isLeaderboardDownload ? [
      "",
      "%----------------------------------------",
      "%---------- Burns",
      "%----------------------------------------",
      "",
      ...burnDefinitions,
      "",
      "%----------------------------------------",
      "%---------- Subscribers",
      "%----------------------------------------",
      "",
    ] : []),
    `Create ReportFile ${reportName};`, `GMAT ${reportName}.Filename = '${gmatString(reportPath)}';`,
    `GMAT ${reportName}.Add = {${reportFields.join(", ")}};`,
    `GMAT ${reportName}.WriteHeaders = true;`,
    ...(isLeaderboardDownload ? [
      `GMAT ${reportName}.SolverIterations = Current;`,
      `GMAT ${reportName}.LeftJustify = On;`,
      `GMAT ${reportName}.ZeroFill = Off;`,
      `GMAT ${reportName}.FixedWidth = true;`,
      `GMAT ${reportName}.Delimiter = ' ';`,
      `GMAT ${reportName}.ColumnWidth = 23;`,
    ] : []),
    `GMAT ${reportName}.WriteReport = true;`,
    `GMAT ${reportName}.AppendToExistingFile = false;`,
    `GMAT ${reportName}.Precision = 16;`,
    ...(includeVisualization ? [
      `Create OpenFramesInterface ${orbitViewName};`,
      `GMAT ${orbitViewName}.SolverIterations = Current;`,
      `GMAT ${orbitViewName}.Add = {${targetName}, ${chaserName}, ${forceModel.centralBody}};`,
      `GMAT ${orbitViewName}.View = {${orbitViewObjectName}};`,
      `GMAT ${orbitViewName}.CoordinateSystem = ${frame};`,
      `GMAT ${orbitViewName}.DrawObject = [true true true];`,
      `GMAT ${orbitViewName}.DrawTrajectory = [true true true];`,
      `GMAT ${orbitViewName}.DrawAxes = [false false false];`,
      `GMAT ${orbitViewName}.DrawXYPlane = [false false false];`,
      `GMAT ${orbitViewName}.DrawLabel = [true true true];`,
      `GMAT ${orbitViewName}.DrawCenterPoint = [true true true];`,
      `GMAT ${orbitViewName}.DrawEndPoints = [true true true];`,
      `GMAT ${orbitViewName}.DrawVelocity = [false false false];`,
      `GMAT ${orbitViewName}.DrawGrid = [false false false];`,
      `GMAT ${orbitViewName}.DrawLineWidth = [2 2 2];`,
      `GMAT ${orbitViewName}.DrawMarkerSize = [10 10 10];`,
      `GMAT ${orbitViewName}.DrawFontSize = [20 20 20];`,
      `GMAT ${orbitViewName}.Axes = On;`,
      `GMAT ${orbitViewName}.AxesLabels = On;`,
      `GMAT ${orbitViewName}.XYPlane = On;`,
      `GMAT ${orbitViewName}.EclipticPlane = Off;`,
      `GMAT ${orbitViewName}.EnableStars = On;`,
      `GMAT ${orbitViewName}.ShowPlot = true;`,
      `GMAT ${orbitViewName}.ShowToolbar = true;`,
      `GMAT ${orbitViewName}.SolverIterLastN = 1;`,
      `GMAT ${orbitViewName}.PlaybackTimeScale = 3600;`,
      ...(forceModel.centralBody === "Earth" ? [
        "Create GroundTrack DefaultGroundTrackPlot;",
        "GMAT DefaultGroundTrackPlot.SolverIterations = Current;",
        "GMAT DefaultGroundTrackPlot.CentralBody = Earth;",
        `GMAT DefaultGroundTrackPlot.Add = {${targetName}, ${chaserName}};`,
        "GMAT DefaultGroundTrackPlot.DataCollectFrequency = 1;",
        "GMAT DefaultGroundTrackPlot.UpdatePlotFrequency = 50;",
        "GMAT DefaultGroundTrackPlot.NumPointsToRedraw = 0;",
        "GMAT DefaultGroundTrackPlot.MaxPlotPoints = 20000;",
        "GMAT DefaultGroundTrackPlot.ShowPlot = true;",
      ] : []),
      ...(isLeaderboardDownload ? [
        "",
        "%----------------------------------------",
        "%---------- User Objects",
        "%----------------------------------------",
        "",
      ] : []),
      `Create OpenFramesView ${orbitViewObjectName};`,
      `GMAT ${orbitViewObjectName}.ViewFrame = CoordinateSystem;`,
      `GMAT ${orbitViewObjectName}.ViewTrajectory = Off;`,
      `GMAT ${orbitViewObjectName}.InertialFrame = Off;`,
      `GMAT ${orbitViewObjectName}.SetDefaultLocation = On;`,
      `GMAT ${orbitViewObjectName}.DefaultEye = [30000 0 0];`,
      `GMAT ${orbitViewObjectName}.DefaultCenter = [0 0 0];`,
      `GMAT ${orbitViewObjectName}.DefaultUp = [0 0 1];`,
      `GMAT ${orbitViewObjectName}.FOVy = 45;`,
    ] : []),
    ...(inspectionReportPath ? [
      `Create Variable ${inspectionVariableNames.join(" ")};`,
      ...(Number.isFinite(requiredFinalDistanceKm) ? [`GMAT RequiredFinalDistanceKm = ${requiredFinalDistanceKm};`] : []),
      ...(Number.isFinite(maximumDeltaVPerBurn) ? [`GMAT MaximumDeltaVPerBurnKmPerS = ${maximumDeltaVPerBurn};`] : []),
      ...burnNorms.map((norm, index) => `GMAT ${burnNormVariableNames[index]} = ${norm};`),
      "Create ReportFile InspectionReport;",
      `GMAT InspectionReport.Filename = '${gmatString(inspectionReportPath)}';`,
      "GMAT InspectionReport.WriteHeaders = true;",
      "GMAT InspectionReport.WriteReport = true;",
      "GMAT InspectionReport.AppendToExistingFile = false;",
      "GMAT InspectionReport.Precision = 16;",
    ] : []),
    ...(!isLeaderboardDownload ? burnDefinitions : []),
    ...(isLeaderboardDownload ? [
      "",
      "%----------------------------------------",
      "%---------- Mission Sequence",
      "%----------------------------------------",
      "",
    ] : []),
    "BeginMissionSequence;",
  ];
  const propagationStop = (duration) => isLeaderboardDownload
    ? `${targetName}.ElapsedSecs = ${duration}, ${chaserName}.ElapsedSecs = ${duration}`
    : `${chaserName}.ElapsedSecs = ${duration}`;
  if (finalDecisionVariables.tWait > 0) lines.push(`Propagate ${propagatorName}(${spacecraftList}) {${propagationStop(finalDecisionVariables.tWait)}};`);
  finalDecisionVariables.burns.forEach((burn, index) => {
    const name = `${isLeaderboardDownload ? "ImpulsiveBurn" : "Burn"}${index + 1}`;
    lines.push(`Maneuver ${name}(${chaserName});`);
    if (burn.timeToNextBurn != null) lines.push(`Propagate ${propagatorName}(${spacecraftList}) {${propagationStop(burn.timeToNextBurn)}};`);
  });
  lines.push(
    `Propagate ${propagatorName}(${spacecraftList}) {${propagationStop(finalDecisionVariables.finalCoastTime)}};`,
    `Report ${reportName} ${reportFields.join(" ")};`,
  );
  if (inspectionReportPath) {
    lines.push(
      `GMAT FinalDistanceKm = sqrt((${chaserName}.X - ${targetName}.X)^2 + (${chaserName}.Y - ${targetName}.Y)^2 + (${chaserName}.Z - ${targetName}.Z)^2);`,
      `Report InspectionReport ${inspectionVariableNames.join(" ")};`,
    );
  }
  const outputLines = isLeaderboardDownload
    ? lines.map((line) => line.replace(/^GMAT /, ""))
    : lines;
  return `${outputLines.join("\n")}\n`;
}

module.exports = { generateGmatScript };
