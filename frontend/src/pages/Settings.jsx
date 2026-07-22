import { useEffect, useState } from "react";
import "./Pages.css";
import "./Settings.css";

import PageHeader from "../components/PageHeader.jsx";
import {
  createScenario,
  downloadDataExport,
  getCloudAddress,
  getScenarios,
  getSyncSettings,
  setCloudAddress,
  testCloudConnection,
  runDataSync,
  updateSyncSettings,
  updateScenario as updateScenarioRequest,
} from "../services/api.js";

const sections = [
  ["connection", "Connection"],
  ["updates", "App Updates"],
  ["validation", "Local GMAT"],
  ["administration", "Scenario Administration"],
];

const defaultSettings = {
  cloudAddress: getCloudAddress(),
  syncEnabled: true,
  gmatExecutablePath: "",
  validationTimeout: "120",
  keepTemporaryFiles: false,
  runOfficialValidationWorker: false,
};

const emptyScenarioLimits = {
  centralBody: "Earth",
  gravityEnabled: true,
  gravityDegree: "2",
  gravityOrder: "0",
  pointMassSun: false,
  pointMassLuna: false,
  dragEnabled: false,
  dragModel: "JacchiaRoberts",
  solarRadiationPressureEnabled: false,
  relativisticCorrectionEnabled: false,
  propagatorIntegrator: "RungeKutta89",
  initialStepSec: "",
  maxStepSec: "",
  minStepSec: "",
  accuracy: "",
  requiredFinalDistanceKm: "",
  maximumTotalDeltaV: "",
  maximumMissionTimeSec: "",
  minimumBurnCount: "",
  maximumBurnCount: "",
  minimumBurnSeparationSec: "",
  distanceReferenceKm: "",
  distanceDecayKm: "",
  timeReferenceSec: "",
  timeSlope: "",
  deltaVReferenceKmPerSec: "",
  deltaVSlope: "",
  distanceWeight: "",
  timeWeight: "",
  deltaVWeight: "",
};

const starterScenarioDefinition = {
  schemaVersion: 1,
  epoch: { value: "29 Aug 2026 05:00:00.000", timeSystem: "UTCGregorian" },
  coordinateSystem: "EarthMJ2000Eq",
  spacecraft: {
    target: {
      stateType: "Cartesian",
      positionKm: [7000, 0, 0],
      velocityKmPerSec: [0, 7.546, 0],
    },
    chaser: {
      stateType: "Cartesian",
      positionKm: [6990, 0, 0],
      velocityKmPerSec: [0, 7.55, 0],
    },
  },
  forceModel: {
    centralBody: "Earth",
    gravity: { type: "spherical-harmonic", enabled: true, degree: 2, order: 0 },
    pointMasses: [],
    drag: { enabled: false, model: null },
    solarRadiationPressure: { enabled: false },
    relativisticCorrection: { enabled: false },
  },
  propagator: {
    integrator: "RungeKutta89",
    initialStepSec: 1,
    maxStepSec: 1,
    minStepSec: 0.001,
    accuracy: 1e-12,
  },
  validation: {
    requiredFinalDistanceKm: 5,
    maximumTotalDeltaV: 1.5,
    maximumMissionTimeSec: 20000,
    minimumBurnCount: 1,
    maximumBurnCount: 5,
    minimumBurnSeparationSec: 100,
  },
  scoreConfig: {
    distanceReferenceKm: 5,
    distanceDecayKm: 100,
    timeReferenceSec: 5000,
    timeSlope: 0.001,
    deltaVReferenceKmPerSec: 0.5,
    deltaVSlope: 10,
    distanceWeight: 50,
    timeWeight: 25,
    deltaVWeight: 25,
  },
};

function newScenarioForm() {
  return {
  scenarioId: "",
  name: "",
  description: "",
    scenarioJson: JSON.stringify(starterScenarioDefinition, null, 2),
  };
}

function loadSettings() {
  try {
    const value = window.localStorage.getItem("mission-dashboard-settings");
    return value ? { ...defaultSettings, ...JSON.parse(value) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export default function Settings({ runtimeConfig }) {
  const isWorker = runtimeConfig?.role === "worker";
  const canAdmin = Boolean(window.missionDashboardDesktop?.adminCloudRequest);
  const visibleSections = sections.filter(([id]) => id !== "administration" || canAdmin);
  const [activeSection, setActiveSection] = useState("connection");
  const [settings, setSettings] = useState(loadSettings);
  const [message, setMessage] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [scenarioForm, setScenarioForm] = useState(newScenarioForm);
  const [isPublishing, setIsPublishing] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [scenarioLimits, setScenarioLimits] = useState(emptyScenarioLimits);
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);

  useEffect(() => {
    let isCurrent = true;
    window.missionDashboardDesktop?.getGmatConfig?.()
      .then((config) => {
        if (isCurrent) {
          setSettings((current) => ({
            ...current,
            ...config,
            gmatExecutablePath: config.gmatInstallationPath ?? "",
            validationTimeout: String(Number(config.timeoutMs ?? 120000) / 1000),
          }));
        }
      })
      .catch(() => {});
    getScenarios({ includeInactive: canAdmin })
      .then((result) => {
        if (isCurrent) {
          setScenarios(result.items);
          if (result.items.length > 0) {
            setSelectedScenarioId(result.items[0].scenarioId);
            setScenarioLimits(readScenarioLimits(result.items[0].scenarioJson));
          }
        }
      })
      .catch((error) => {
        if (isCurrent) setMessage(error.message);
      });
    getSyncSettings()
      .then((sync) => {
        if (isCurrent) {
          setSettings((current) => ({
            ...current,
            cloudAddress: sync.peerUrl?.replace(/\/api$/, "") ?? current.cloudAddress,
            syncEnabled: sync.enabled,
          }));
        }
      })
      .catch(() => {});
    return () => { isCurrent = false; };
  }, [canAdmin]);

  useEffect(() => {
    let isCurrent = true;
    window.missionDashboardDesktop?.getUpdateStatus?.()
      .then((status) => { if (isCurrent) setUpdateStatus(status); })
      .catch(() => {});
    const unsubscribe = window.missionDashboardDesktop?.onUpdateStatus?.((status) => {
      if (isCurrent) setUpdateStatus(status);
    });
    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, []);

  function updateSetting(event) {
    const { name, value, type, checked } = event.target;
    setSettings((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function saveSettings() {
    try {
      setCloudAddress(settings.cloudAddress);
      await updateSyncSettings({
        peerUrl: settings.cloudAddress,
        enabled: settings.syncEnabled,
      });
      window.localStorage.setItem("mission-dashboard-settings", JSON.stringify(settings));
      await window.missionDashboardDesktop?.saveGmatConfig?.({
        gmatInstallationPath: settings.gmatExecutablePath.trim(),
        timeoutMs: Number(settings.validationTimeout) * 1000,
        keepTemporaryFiles: settings.keepTemporaryFiles,
        runOfficialValidationWorker: settings.runOfficialValidationWorker,
      });
      setMessage("Settings saved on this device.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function testConnection() {
    setMessage("Testing optional relay connection…");
    try {
      const result = await testCloudConnection(settings.cloudAddress);
      setMessage(
        `Relay connected in ${result.latencyMs} ms (${result.nodeRole ?? "unknown role"}).`,
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function syncNow() {
    setMessage("Synchronizing passed Solutions…");
    try {
      const result = await runDataSync();
      if (result.status === "error") throw new Error(result.lastError);
      setMessage(result.status === "disabled"
        ? "Synchronization is disabled on this device."
        : `Sync complete: pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts.length}.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function checkForUpdates() {
    if (updateStatus?.state === "manual") {
      await window.missionDashboardDesktop?.openUpdateReleases?.();
      return;
    }
    if (!window.missionDashboardDesktop?.checkForUpdates) {
      setMessage("App updates are available in the installed Electron app only.");
      return;
    }
    const status = await window.missionDashboardDesktop.checkForUpdates();
    setUpdateStatus(status);
  }

  async function browseGmat() {
    if (!window.missionDashboardDesktop?.selectGmatInstallation) {
      setMessage("Folder selection is available in the Electron app only.");
      return;
    }
    const config = await window.missionDashboardDesktop.selectGmatInstallation();
    if (config.gmatInstallationPath) {
      setSettings((current) => ({
        ...current,
        gmatExecutablePath: config.gmatInstallationPath,
      }));
    }
  }

  function updateScenario(event) {
    const { name, value } = event.target;
    setScenarioForm((current) => ({ ...current, [name]: value }));
  }

  async function publishScenario(event) {
    event.preventDefault();
    setIsPublishing(true);
    setMessage("");
    try {
      const created = await createScenario({
        scenarioId: scenarioForm.scenarioId.trim().toUpperCase(),
        name: scenarioForm.name.trim(),
        description: scenarioForm.description.trim(),
        scenarioJson: JSON.parse(scenarioForm.scenarioJson),
      });
      setScenarios((current) => [...current, created].sort(
        (left, right) => left.scenarioId.localeCompare(right.scenarioId),
      ));
      setScenarioForm(newScenarioForm());
      setMessage(`${created.scenarioId} published.`);
    } catch (error) {
      setMessage(error instanceof SyntaxError
        ? "Scenario JSON is not valid JSON."
        : error.message);
    } finally {
      setIsPublishing(false);
    }
  }

  async function uploadScenario(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      setScenarioForm({
        scenarioId: String(data.scenarioId ?? ""),
        name: String(data.name ?? ""),
        description: String(data.description ?? ""),
        scenarioJson: JSON.stringify(data.scenarioJson ?? data.definition ?? {}, null, 2),
      });
      setMessage(`${file.name} loaded. Review it before publishing.`);
      setActiveSection("administration");
    } catch {
      setMessage("Scenario package must be valid JSON.");
    }
  }

  function selectScenarioForEditing(event) {
    const scenarioId = event.target.value;
    const scenario = scenarios.find((item) => item.scenarioId === scenarioId);
    setSelectedScenarioId(scenarioId);
    setScenarioLimits(readScenarioLimits(scenario?.scenarioJson ?? {}));
  }

  function updateScenarioLimit(event) {
    const { name, value, type, checked } = event.target;
    setScenarioLimits((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function saveScenarioLimits(event) {
    event.preventDefault();
    const scenario = scenarios.find((item) => item.scenarioId === selectedScenarioId);
    if (!scenario) return;
    setIsSavingScenario(true);
    setMessage("");
    try {
      const scenarioJson = structuredClone(scenario.scenarioJson);
      const gravityDegree = nonNegativeInteger(scenarioLimits.gravityDegree, "Gravity degree");
      const gravityOrder = nonNegativeInteger(scenarioLimits.gravityOrder, "Gravity order");
      if (gravityOrder > gravityDegree) {
        throw new Error("Gravity order cannot be greater than gravity degree.");
      }
      if (scenarioLimits.dragEnabled && scenarioLimits.centralBody !== "Earth") {
        throw new Error("The available atmosphere models currently support Earth only.");
      }
      scenarioJson.forceModel = {
        centralBody: scenarioLimits.centralBody,
        gravity: {
          type: "spherical-harmonic",
          enabled: scenarioLimits.gravityEnabled,
          degree: gravityDegree,
          order: gravityOrder,
        },
        pointMasses: [
          ...(scenarioLimits.pointMassSun ? ["Sun"] : []),
          ...(scenarioLimits.pointMassLuna ? ["Luna"] : []),
        ],
        drag: {
          enabled: scenarioLimits.dragEnabled,
          model: scenarioLimits.dragEnabled ? scenarioLimits.dragModel : null,
        },
        solarRadiationPressure: {
          enabled: scenarioLimits.solarRadiationPressureEnabled,
        },
        relativisticCorrection: {
          enabled: scenarioLimits.relativisticCorrectionEnabled,
        },
      };
      scenarioJson.propagator = {
        ...scenarioJson.propagator,
        integrator: scenarioLimits.propagatorIntegrator,
        initialStepSec: positiveNumber(scenarioLimits.initialStepSec, "Initial step"),
        maxStepSec: positiveNumber(scenarioLimits.maxStepSec, "Maximum step"),
        minStepSec: positiveNumber(scenarioLimits.minStepSec, "Minimum step"),
        accuracy: positiveNumber(scenarioLimits.accuracy, "Accuracy"),
      };
      scenarioJson.validation = {
        ...scenarioJson.validation,
        requiredFinalDistanceKm: nonNegativeNumber(scenarioLimits.requiredFinalDistanceKm, "Required final distance"),
        maximumTotalDeltaV: positiveNumber(scenarioLimits.maximumTotalDeltaV, "Maximum total Delta-V"),
        maximumMissionTimeSec: positiveNumber(scenarioLimits.maximumMissionTimeSec, "Maximum mission time"),
        minimumBurnCount: positiveInteger(scenarioLimits.minimumBurnCount, "Minimum burn count"),
        maximumBurnCount: positiveInteger(scenarioLimits.maximumBurnCount, "Maximum burn count"),
        minimumBurnSeparationSec: nonNegativeNumber(scenarioLimits.minimumBurnSeparationSec, "Minimum burn separation"),
      };
      scenarioJson.scoreConfig = {
        ...scenarioJson.scoreConfig,
        distanceReferenceKm: nonNegativeNumber(scenarioLimits.distanceReferenceKm, "Distance reference"),
        distanceDecayKm: positiveNumber(scenarioLimits.distanceDecayKm, "Distance decay"),
        timeReferenceSec: nonNegativeNumber(scenarioLimits.timeReferenceSec, "Time reference"),
        timeSlope: positiveNumber(scenarioLimits.timeSlope, "Time slope"),
        deltaVReferenceKmPerSec: nonNegativeNumber(scenarioLimits.deltaVReferenceKmPerSec, "Delta-V reference"),
        deltaVSlope: positiveNumber(scenarioLimits.deltaVSlope, "Delta-V slope"),
        distanceWeight: nonNegativeNumber(scenarioLimits.distanceWeight, "Distance weight"),
        timeWeight: nonNegativeNumber(scenarioLimits.timeWeight, "Time weight"),
        deltaVWeight: nonNegativeNumber(scenarioLimits.deltaVWeight, "Delta-V weight"),
      };
      if (scenarioJson.propagator.minStepSec > scenarioJson.propagator.maxStepSec) {
        throw new Error("Minimum step cannot be greater than maximum step.");
      }
      if (scenarioJson.validation.minimumBurnCount > scenarioJson.validation.maximumBurnCount) {
        throw new Error("Minimum burn count cannot be greater than maximum burn count.");
      }
      const updated = await updateScenarioRequest(selectedScenarioId, {
        name: scenario.name,
        description: scenario.description,
        scenarioJson,
      });
      setScenarios((current) => current.map((item) => (
        item.scenarioId === updated.scenarioId ? updated : item
      )));
      setScenarioLimits(readScenarioLimits(updated.scenarioJson));
      setMessage(`${updated.scenarioId} limits saved to this device.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSavingScenario(false);
    }
  }

  async function exportDataset(format) {
    try {
      const filename = await downloadDataExport(format);
      setMessage(`${filename} downloaded with active and archived records.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="settings-page">
      <PageHeader
        title="Settings"
        description={isWorker
          ? "This designated computer runs official GMAT validation and Scenario Administration."
          : "This application stores mission data in this device's local SQLite database."}
      />

      <div className="settings-layout">
        <aside className="settings-navigation">
          <div className="settings-navigation-header">
            <span>Settings</span>
            <small>Only active controls are shown</small>
          </div>
          <nav className="settings-navigation-list">
            {visibleSections.map(([id, label]) => (
              <button
                key={id}
                className={`settings-navigation-item${activeSection === id ? " is-active" : ""}`}
                type="button"
                onClick={() => setActiveSection(id)}
              >
                <span className="settings-navigation-text"><strong>{label}</strong></span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-content">
          {activeSection === "connection" ? (
            <SettingsSection
              title="Optional Data Relay"
              description="Local SQLite is authoritative. The relay only helps trusted devices exchange Scenario and passed Solution records."
            >
              <SettingsRow label="Relay address">
                <input
                  name="cloudAddress"
                  value={settings.cloudAddress}
                  onChange={updateSetting}
                  placeholder="https://missiondashboard.fastapicloud.dev"
                />
              </SettingsRow>
              <SettingsRow label="Enable background synchronization">
                <input
                  name="syncEnabled"
                  type="checkbox"
                  checked={settings.syncEnabled}
                  onChange={updateSetting}
                />
              </SettingsRow>
              <div className="settings-inline-actions scenario-form-actions">
                <button className="settings-secondary-button" type="button" onClick={testConnection}>Test Relay</button>
                <button className="settings-secondary-button" type="button" onClick={syncNow}>Sync Now</button>
                <button className="settings-primary-button" type="button" onClick={saveSettings}>Save</button>
              </div>
            </SettingsSection>
          ) : null}

          {activeSection === "validation" ? (
            <SettingsSection
              title="Local GMAT"
              description="The Electron Client runs this installation before uploading a Solution."
            >
              <SettingsRow label="GMAT installation / API folder">
                <div className="settings-input-action">
                  <input
                    name="gmatExecutablePath"
                    value={settings.gmatExecutablePath}
                    onChange={updateSetting}
                  />
                  <button className="settings-secondary-button" type="button" onClick={browseGmat}>Browse…</button>
                </div>
              </SettingsRow>
              <SettingsRow
                label="Maximum validation time"
                description="Stop GMAT if one validation runs longer than this. The default is 120 seconds."
              >
                <input
                  name="validationTimeout"
                  type="number"
                  min="1"
                  value={settings.validationTimeout}
                  onChange={updateSetting}
                />
              </SettingsRow>
              <SettingsRow label="Keep temporary GMAT files">
                <input
                  name="keepTemporaryFiles"
                  type="checkbox"
                  checked={settings.keepTemporaryFiles}
                  onChange={updateSetting}
                />
              </SettingsRow>
              <SettingsRow
                label="Run official validation worker"
                description="When enabled, this device claims queued submissions and validates them with its configured GMAT installation."
              >
                <input name="runOfficialValidationWorker" type="checkbox" checked={settings.runOfficialValidationWorker} onChange={updateSetting} />
              </SettingsRow>
              <button className="settings-primary-button" type="button" onClick={saveSettings}>Save Local GMAT</button>
            </SettingsSection>
          ) : null}

          {activeSection === "updates" ? (
            <SettingsSection
              title="Application Updates"
              description="Installed builds check GitHub Releases. Updates are downloaded only after confirmation and installed after a safe restart."
            >
              <SettingsRow label="Installed version">
                <span>{updateStatus?.currentVersion ?? "Unknown"}</span>
              </SettingsRow>
              <SettingsRow label="Update status">
                <span>{updateStatus?.message ?? "Update service is starting…"}</span>
              </SettingsRow>
              {updateStatus?.state === "downloading" ? (
                <SettingsRow label="Download progress">
                  <progress max="100" value={updateStatus.percent ?? 0} />
                </SettingsRow>
              ) : null}
              <button className="settings-primary-button" type="button" onClick={checkForUpdates}>
                {updateStatus?.state === "manual" ? "Open GitHub Releases" : "Check for Updates"}
              </button>
            </SettingsSection>
          ) : null}

          {activeSection === "administration" ? (
            <SettingsSection
              title="Scenario Administration"
              description="Upload a package, review its fixed simulation environment, then publish it to clients."
            >
              <form className="scenario-limits-form" onSubmit={saveScenarioLimits}>
                <SettingsRow label="Edit published Scenario">
                  <select value={selectedScenarioId} onChange={selectScenarioForEditing} required>
                    {scenarios.map((scenario) => (
                      <option key={scenario.scenarioId} value={scenario.scenarioId}>
                        {scenario.scenarioId}: {scenario.name}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
                <div className="scenario-limit-heading">Force Model</div>
                <p className="scenario-model-note">
                  Central-body point-mass gravity is always applied. Gravity field enables spherical harmonics above that baseline.
                </p>
                <div className="scenario-parameter-grid">
                  <ScenarioSelectField label="Central body" description="Propagation origin and primary body" name="centralBody" value={scenarioLimits.centralBody} onChange={updateScenarioLimit} options={["Earth"]} />
                  <ScenarioToggleField label="Gravity field" description="Spherical-harmonic gravity" name="gravityEnabled" checked={scenarioLimits.gravityEnabled} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="Degree" description="Gravity harmonic degree" name="gravityDegree" value={scenarioLimits.gravityDegree} onChange={updateScenarioLimit} integer allowZero disabled={!scenarioLimits.gravityEnabled} />
                  <ScenarioNumberField label="Order" description="Gravity harmonic order" name="gravityOrder" value={scenarioLimits.gravityOrder} onChange={updateScenarioLimit} integer allowZero disabled={!scenarioLimits.gravityEnabled} />
                  <ScenarioToggleField label="Sun" description="Sun point-mass perturbation" name="pointMassSun" checked={scenarioLimits.pointMassSun} onChange={updateScenarioLimit} />
                  <ScenarioToggleField label="Luna" description="Moon point-mass perturbation" name="pointMassLuna" checked={scenarioLimits.pointMassLuna} onChange={updateScenarioLimit} />
                  <ScenarioToggleField label="Drag" description="Earth atmospheric drag" name="dragEnabled" checked={scenarioLimits.dragEnabled} onChange={updateScenarioLimit} />
                  <ScenarioSelectField label="Atmosphere" description="GMAT atmosphere model" name="dragModel" value={scenarioLimits.dragModel} onChange={updateScenarioLimit} options={["JacchiaRoberts", "MSISE90"]} disabled={!scenarioLimits.dragEnabled} />
                  <ScenarioToggleField label="SRP" description="Solar radiation pressure" name="solarRadiationPressureEnabled" checked={scenarioLimits.solarRadiationPressureEnabled} onChange={updateScenarioLimit} />
                  <ScenarioToggleField label="Relativity" description="Relativistic correction" name="relativisticCorrectionEnabled" checked={scenarioLimits.relativisticCorrectionEnabled} onChange={updateScenarioLimit} />
                </div>
                <div className="scenario-limit-heading">Propagator</div>
                <div className="scenario-parameter-grid">
                  <ScenarioSelectField label="Integrator" description="GMAT numerical integrator" name="propagatorIntegrator" value={scenarioLimits.propagatorIntegrator} onChange={updateScenarioLimit} options={["RungeKutta89", "PrinceDormand78", "RungeKutta68", "RungeKutta56"]} />
                  <ScenarioNumberField label="h0" description="Initial integration step, s" name="initialStepSec" value={scenarioLimits.initialStepSec} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="hmax" description="Maximum integration step, s" name="maxStepSec" value={scenarioLimits.maxStepSec} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="hmin" description="Minimum integration step, s" name="minStepSec" value={scenarioLimits.minStepSec} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="ε" description="Integrator accuracy" name="accuracy" value={scenarioLimits.accuracy} onChange={updateScenarioLimit} />
                </div>
                <div className="scenario-limit-heading">Validation limits</div>
                <div className="scenario-parameter-grid">
                  <ScenarioNumberField label="Δr_req" description="Intercept distance threshold, km" name="requiredFinalDistanceKm" value={scenarioLimits.requiredFinalDistanceKm} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="ΔVlim" description="Total Delta-V limit, km/s" name="maximumTotalDeltaV" value={scenarioLimits.maximumTotalDeltaV} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="Tmax" description="Maximum mission time, s" name="maximumMissionTimeSec" value={scenarioLimits.maximumMissionTimeSec} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="N_min" description="Minimum burn count" name="minimumBurnCount" value={scenarioLimits.minimumBurnCount} onChange={updateScenarioLimit} integer />
                  <ScenarioNumberField label="N_max" description="Maximum burn count" name="maximumBurnCount" value={scenarioLimits.maximumBurnCount} onChange={updateScenarioLimit} integer />
                  <ScenarioNumberField label="Δtmin" description="Minimum burn separation, s" name="minimumBurnSeparationSec" value={scenarioLimits.minimumBurnSeparationSec} onChange={updateScenarioLimit} />
                </div>
                <div className="scenario-limit-heading">Score function</div>
                <div className="scenario-score-formula" aria-label="Score function formula">
                  <code>Score = W_r exp(-(Δr_min - R0) / R_decay) + W_t / (1 + exp(kt(Tteam - Ct))) + W_v / (1 + exp(kv(ΔVteam - Cv))) - ΣPn</code>
                  <span>The displayed signs match the current backend score calculation.</span>
                </div>
                <div className="scenario-parameter-grid">
                  <ScenarioNumberField label="R0" description="Distance floor, km" name="distanceReferenceKm" value={scenarioLimits.distanceReferenceKm} onChange={updateScenarioLimit} allowZero />
                  <ScenarioNumberField label="R_decay" description="Distance decay, km" name="distanceDecayKm" value={scenarioLimits.distanceDecayKm} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="W_r" description="Distance score weight" name="distanceWeight" value={scenarioLimits.distanceWeight} onChange={updateScenarioLimit} allowZero />
                  <ScenarioNumberField label="Ct" description="Time center, s" name="timeReferenceSec" value={scenarioLimits.timeReferenceSec} onChange={updateScenarioLimit} allowZero />
                  <ScenarioNumberField label="kt" description="Time logistic slope" name="timeSlope" value={scenarioLimits.timeSlope} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="W_t" description="Time score weight" name="timeWeight" value={scenarioLimits.timeWeight} onChange={updateScenarioLimit} allowZero />
                  <ScenarioNumberField label="Cv" description="Delta-V center, km/s" name="deltaVReferenceKmPerSec" value={scenarioLimits.deltaVReferenceKmPerSec} onChange={updateScenarioLimit} allowZero />
                  <ScenarioNumberField label="kv" description="Delta-V logistic slope" name="deltaVSlope" value={scenarioLimits.deltaVSlope} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="W_v" description="Delta-V score weight" name="deltaVWeight" value={scenarioLimits.deltaVWeight} onChange={updateScenarioLimit} allowZero />
                </div>
                <button className="settings-primary-button" type="submit" disabled={isSavingScenario || !selectedScenarioId}>
                  {isSavingScenario ? "Saving…" : "Save Scenario Limits"}
                </button>
              </form>
              <div className="scenario-admin-divider"><span>Publish another Scenario</span></div>
              <div className="scenario-schema-guide">
                <strong>Scenario JSON map</strong>
                <div>
                  <code>epoch</code><span>Initial epoch and time system</span>
                  <code>spacecraft.target / chaser</code><span>Cartesian position (km) and velocity (km/s)</span>
                  <code>forceModel</code><span>Gravity, third bodies, drag, SRP, and relativity</span>
                  <code>propagator</code><span>Integrator type, step sizes, and accuracy</span>
                  <code>validation</code><span>Mission and maneuver constraints</span>
                  <code>scoreConfig</code><span>Leaderboard score parameters</span>
                </div>
                <p>The editor below starts with a complete runnable template. Replace its example state vectors before publishing.</p>
              </div>
              <label className="settings-secondary-button settings-file-button">
                Load JSON Package
                <input type="file" accept=".json" onChange={uploadScenario} hidden />
              </label>
              <button className="settings-secondary-button scenario-template-button" type="button" onClick={() => setScenarioForm(newScenarioForm())}>
                Reset to Complete Template
              </button>
              <form className="scenario-create-form" onSubmit={publishScenario}>
                <SettingsRow label="Scenario ID">
                  <input name="scenarioId" value={scenarioForm.scenarioId} onChange={updateScenario} placeholder="SC-003" required />
                </SettingsRow>
                <SettingsRow label="Name">
                  <input name="name" value={scenarioForm.name} onChange={updateScenario} required />
                </SettingsRow>
                <SettingsRow label="Description">
                  <textarea name="description" value={scenarioForm.description} onChange={updateScenario} />
                </SettingsRow>
                <SettingsRow label="Scenario JSON">
                  <textarea
                    className="scenario-definition-input"
                    name="scenarioJson"
                    value={scenarioForm.scenarioJson}
                    onChange={updateScenario}
                    spellCheck="false"
                    aria-describedby="scenario-json-help"
                    required
                  />
                </SettingsRow>
                <p className="scenario-json-help" id="scenario-json-help">
                  Units are fixed: position km, velocity and Delta-V km/s, time s. Coordinate frames must match the supplied state vectors.
                </p>
                <button className="settings-primary-button" type="submit" disabled={isPublishing}>
                  {isPublishing ? "Publishing…" : "Publish Scenario"}
                </button>
              </form>
              <div className="scenario-admin-list">
                {scenarios.map((scenario) => (
                  <article key={scenario.scenarioId}>
                    <div><strong>{scenario.scenarioId}</strong><span>{scenario.name}</span></div>
                  </article>
                ))}
              </div>
              <div className="scenario-admin-divider"><span>Data export</span></div>
              <div className="settings-inline-actions scenario-form-actions">
                <button className="settings-secondary-button" type="button" onClick={() => exportDataset("jsonl")}>Export JSONL</button>
                <button className="settings-secondary-button" type="button" onClick={() => exportDataset("csv")}>Export CSV</button>
              </div>
            </SettingsSection>
          ) : null}

          {message ? <p className="settings-message">{message}</p> : null}
        </main>
      </div>
    </section>
  );
}

function ScenarioNumberField({ label, description, name, value, onChange, integer = false, allowZero = false, disabled = false }) {
  return (
    <SettingsRow label={label} description={description}>
      <input
        type="number"
        name={name}
        value={value}
        step={integer ? "1" : "any"}
        min={allowZero || name === "requiredFinalDistanceKm" || name === "minimumBurnSeparationSec" ? "0" : "0.000000000001"}
        onChange={onChange}
        disabled={disabled}
        required
      />
    </SettingsRow>
  );
}

function ScenarioToggleField({ label, description, name, checked, onChange }) {
  return (
    <SettingsRow label={label} description={description}>
      <span className="scenario-toggle">
        <input type="checkbox" name={name} checked={checked} onChange={onChange} />
        <span>{checked ? "Enabled" : "Disabled"}</span>
      </span>
    </SettingsRow>
  );
}

function ScenarioSelectField({ label, description, name, value, onChange, options, disabled = false }) {
  return (
    <SettingsRow label={label} description={description}>
      <select name={name} value={value} onChange={onChange} disabled={disabled}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </SettingsRow>
  );
}

function readScenarioLimits(definition) {
  const propagator = definition.propagator ?? {};
  const validation = definition.validation ?? {};
  const scoreConfig = definition.scoreConfig ?? {};
  const forceModel = definition.forceModel ?? {};
  const gravity = forceModel.gravityField ?? forceModel.gravity ?? {};
  const pointMasses = Array.isArray(forceModel.pointMasses) ? forceModel.pointMasses : [];
  return {
    ...Object.fromEntries(Object.keys(emptyScenarioLimits).map((key) => [
      key,
      String(propagator[key] ?? validation[key] ?? scoreConfig[key] ?? ""),
    ])),
    centralBody: forceModel.centralBody ?? "Earth",
    gravityEnabled: gravity.enabled ?? Object.keys(gravity).length > 0,
    gravityDegree: String(gravity.degree ?? 0),
    gravityOrder: String(gravity.order ?? 0),
    pointMassSun: pointMasses.includes("Sun"),
    pointMassLuna: pointMasses.includes("Luna"),
    dragEnabled: Boolean(forceModel.drag?.enabled),
    dragModel: forceModel.drag?.model ?? "JacchiaRoberts",
    solarRadiationPressureEnabled: Boolean(forceModel.solarRadiationPressure?.enabled),
    relativisticCorrectionEnabled: Boolean(forceModel.relativisticCorrection?.enabled),
    propagatorIntegrator: propagator.integrator ?? "RungeKutta89",
  };
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or greater.`);
  return number;
}

function positiveInteger(value, label) {
  const number = positiveNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer.`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = nonNegativeNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer.`);
  return number;
}

function SettingsSection({ title, description, children }) {
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <p>Configuration</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </header>
      <div className="settings-group"><div className="settings-group-content">{children}</div></div>
    </section>
  );
}

function SettingsRow({ label, description, children }) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="settings-row-control">{children}</span>
    </label>
  );
}
