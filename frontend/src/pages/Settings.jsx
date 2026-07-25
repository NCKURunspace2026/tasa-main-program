import { useEffect, useState } from "react";
import "./Pages.css";
import "./Settings.css";

import PageHeader from "../components/PageHeader.jsx";
import {
  createScenario,
  deleteScenario,
  downloadDataExport,
  getCloudAddress,
  getScenarios,
  getSyncSettings,
  testCloudConnection,
  runDataSync,
  updateSyncSettings,
  updateScenario as updateScenarioRequest,
} from "../services/api.js";

const sections = [
  ["connection", "Connection"],
  ["updates", "App Updates"],
  ["validation", "Local GMAT"],
  ["scenario-view", "Scenario Viewer"],
  ["scenario-publish", "Publish Scenario"],
];

const defaultSettings = {
  cloudAddress: getCloudAddress(),
  syncEnabled: true,
  gmatExecutablePath: "",
  validationTimeout: "120",
  keepTemporaryFiles: false,
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
  maximumDeltaVPerBurn: "",
  maximumMissionTimeSec: "",
  minimumBurnSeparationSec: "",
  timeReferenceSec: "",
  timeSlope: "",
  deltaVReferenceKmPerSec: "",
  deltaVSlope: "",
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
      physicalProperties: {
        dryMassKg: 850,
        dragAreaM2: 15,
        srpAreaM2: 1,
        coefficientOfDrag: 2.2,
        coefficientOfReflectivity: 1.8,
      },
    },
    chaser: {
      stateType: "Cartesian",
      positionKm: [6990, 0, 0],
      velocityKmPerSec: [0, 7.55, 0],
      physicalProperties: {
        dryMassKg: 850,
        dragAreaM2: 15,
        srpAreaM2: 1,
        coefficientOfDrag: 2.2,
        coefficientOfReflectivity: 1.8,
      },
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
    maximumDeltaVPerBurn: 1.5,
    maximumMissionTimeSec: 20000,
    minimumBurnSeparationSec: 100,
  },
  scoreConfig: {
    timeReferenceSec: 5000,
    timeSlope: 0.001,
    deltaVReferenceKmPerSec: 0.5,
    deltaVSlope: 10,
  },
};

const scenarioPackageTemplate = {
  name: "Rendezvous Challenge",
  description: "Chaser performs one or more impulsive maneuvers to intercept the target within the configured distance threshold.",
  scenarioJson: starterScenarioDefinition,
};

function newScenarioForm() {
  return {
    name: "",
    description: "",
    scenarioJson: JSON.stringify(starterScenarioDefinition, null, 2),
  };
}

export default function Settings() {
  const canAdmin = Boolean(window.missionDashboardDesktop?.localAdminRequest);
  const visibleSections = sections.filter(([id]) => !id.startsWith("scenario-") || canAdmin);
  const [activeSection, setActiveSection] = useState("connection");
  const [settings, setSettings] = useState(defaultSettings);
  const [message, setMessage] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [scenarioForm, setScenarioForm] = useState(newScenarioForm);
  const [isPublishing, setIsPublishing] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [scenarioDetails, setScenarioDetails] = useState({ name: "", description: "" });
  const [scenarioLimits, setScenarioLimits] = useState(emptyScenarioLimits);
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [startupSyncStatus, setStartupSyncStatus] = useState(null);
  const [scriptPreview, setScriptPreview] = useState("");
  const [scriptPreviewError, setScriptPreviewError] = useState("");
  const [showScenarioFormat, setShowScenarioFormat] = useState(false);
  const [scenarioRemoval, setScenarioRemoval] = useState(null);
  const [scenarioRemovalConfirmation, setScenarioRemovalConfirmation] = useState("");
  const [isRemovingScenario, setIsRemovingScenario] = useState(false);

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
    getScenarios()
      .then((result) => {
        if (isCurrent) {
          setScenarios(result.items);
          if (result.items.length > 0) {
            setSelectedScenarioId(result.items[0].scenarioId);
            setScenarioDetails({
              name: result.items[0].name,
              description: result.items[0].description,
            });
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

  useEffect(() => {
    let isCurrent = true;
    window.missionDashboardDesktop?.getStartupSyncStatus?.()
      .then((status) => { if (isCurrent) setStartupSyncStatus(status); })
      .catch(() => {});
    const unsubscribe = window.missionDashboardDesktop?.onStartupSyncStatus?.((status) => {
      if (isCurrent) setStartupSyncStatus(status);
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

  async function saveSyncSettings() {
    try {
      await updateSyncSettings({
        peerUrl: settings.cloudAddress,
        enabled: settings.syncEnabled,
      });
      setMessage("Synchronization settings saved on this device.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveGmatSettings() {
    try {
      if (!window.missionDashboardDesktop?.saveGmatConfig) {
        throw new Error("Local GMAT settings require the Electron app.");
      }
      const timeoutSeconds = Number(settings.validationTimeout);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        throw new Error("Maximum validation time must be greater than zero.");
      }
      await window.missionDashboardDesktop?.saveGmatConfig?.({
        gmatInstallationPath: settings.gmatExecutablePath.trim(),
        timeoutMs: timeoutSeconds * 1000,
        keepTemporaryFiles: settings.keepTemporaryFiles,
      });
      setMessage("Local GMAT settings saved on this device.");
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
        : `Sync repair complete: pushed ${result.pushed}, pulled ${result.pulled}, conflicts ${result.conflicts.length}. Relay manifest reconciliation also checked for missed records.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function copyScenarioFormat() {
    const text = JSON.stringify(scenarioPackageTemplate, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Scenario JSON package template copied.");
    } catch {
      setScenarioForm({
        name: scenarioPackageTemplate.name,
        description: scenarioPackageTemplate.description,
        scenarioJson: JSON.stringify(scenarioPackageTemplate.scenarioJson, null, 2),
      });
      setMessage("Clipboard is unavailable. The template was loaded into the form instead.");
    }
  }

  function downloadScenarioFormat() {
    const blob = new Blob([JSON.stringify(scenarioPackageTemplate, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mission-dashboard-scenario-template.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Scenario JSON package template downloaded.");
  }

  async function previewGmatScript() {
    const scenario = scenarios.find((item) => item.scenarioId === selectedScenarioId);
    if (!scenario) {
      setScriptPreviewError("Select a published Scenario first.");
      setScriptPreview("");
      return;
    }
    if (!window.missionDashboardDesktop?.generateGmatScript) {
      setScriptPreviewError("GMAT script preview is available in the Electron app only.");
      setScriptPreview("");
      return;
    }
    try {
      const scenarioJson = buildEditedScenarioJson(scenario);
      const script = await window.missionDashboardDesktop.generateGmatScript({
        scenario: {
          ...scenario,
          name: scenarioDetails.name.trim() || scenario.name,
          description: scenarioDetails.description.trim(),
          scenarioJson,
        },
        finalDecisionVariables: {
          tWait: 0,
          burns: [],
          finalCoastTime: 60,
        },
      });
      setScriptPreview(script);
      setScriptPreviewError("");
    } catch (error) {
      setScriptPreview("");
      setScriptPreviewError(error.message);
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
        name: scenarioForm.name.trim(),
        description: scenarioForm.description.trim(),
        scenarioJson: JSON.parse(scenarioForm.scenarioJson),
      });
      setScenarios((current) => [...current, created].sort(
        (left, right) => left.scenarioId.localeCompare(right.scenarioId),
      ));
      setSelectedScenarioId(created.scenarioId);
      setScenarioDetails({ name: created.name, description: created.description });
      setScenarioLimits(readScenarioLimits(created.scenarioJson));
      setScenarioForm(newScenarioForm());
      setMessage(`${created.scenarioId} published.`);
      runDataSync().catch(() => {});
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
        name: String(data.name ?? ""),
        description: String(data.description ?? ""),
        scenarioJson: JSON.stringify(data.scenarioJson ?? data.definition ?? {}, null, 2),
      });
      setMessage(`${file.name} loaded. Review it before publishing.`);
      setActiveSection("scenario-publish");
    } catch {
      setMessage("Scenario package must be valid JSON.");
    }
  }

  function selectScenarioForEditing(event) {
    const scenarioId = event.target.value;
    const scenario = scenarios.find((item) => item.scenarioId === scenarioId);
    setSelectedScenarioId(scenarioId);
    setScenarioRemoval(null);
    setScenarioRemovalConfirmation("");
    setScenarioDetails({
      name: scenario?.name ?? "",
      description: scenario?.description ?? "",
    });
    setScenarioLimits(readScenarioLimits(scenario?.scenarioJson ?? {}));
  }

  function updateScenarioDetails(event) {
    const { name, value } = event.target;
    setScenarioDetails((current) => ({ ...current, [name]: value }));
  }

  function updateScenarioLimit(event) {
    const { name, value, type, checked } = event.target;
    setScenarioLimits((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function buildEditedScenarioJson(scenario) {
    const scenarioJson = structuredClone(scenario.scenarioJson);
    const gravityDegree = nonNegativeInteger(scenarioLimits.gravityDegree, "Gravity degree");
    const gravityOrder = nonNegativeInteger(scenarioLimits.gravityOrder, "Gravity order");
    if (gravityOrder > gravityDegree) {
      throw new Error("Gravity order cannot be greater than gravity degree.");
    }
    if (scenarioLimits.dragEnabled && scenarioLimits.centralBody !== "Earth") {
      throw new Error("The available atmosphere models currently support Earth only.");
    }
    const preservedPointMasses = (scenarioJson.forceModel?.pointMasses ?? []).filter(
      (body) => body !== "Sun" && body !== "Luna",
    );
    scenarioJson.forceModel = {
      centralBody: scenarioLimits.centralBody,
      gravity: {
        type: "spherical-harmonic",
        enabled: scenarioLimits.gravityEnabled,
        degree: gravityDegree,
        order: gravityOrder,
      },
      pointMasses: [
        ...preservedPointMasses,
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
      requiredFinalDistanceKm: 5,
      maximumDeltaVPerBurn: positiveNumber(scenarioLimits.maximumDeltaVPerBurn, "Maximum Delta-V per burn"),
      maximumMissionTimeSec: positiveNumber(scenarioLimits.maximumMissionTimeSec, "Maximum mission time"),
      minimumBurnSeparationSec: nonNegativeNumber(scenarioLimits.minimumBurnSeparationSec, "Minimum burn separation"),
    };
    delete scenarioJson.validation.minimumBurnCount;
    delete scenarioJson.validation.maximumBurnCount;
    scenarioJson.scoreConfig = {
      timeReferenceSec: nonNegativeNumber(scenarioLimits.timeReferenceSec, "Time reference"),
      timeSlope: positiveNumber(scenarioLimits.timeSlope, "Time slope"),
      deltaVReferenceKmPerSec: nonNegativeNumber(scenarioLimits.deltaVReferenceKmPerSec, "Delta-V reference"),
      deltaVSlope: positiveNumber(scenarioLimits.deltaVSlope, "Delta-V slope"),
    };
    if (scenarioJson.propagator.minStepSec > scenarioJson.propagator.maxStepSec) {
      throw new Error("Minimum step cannot be greater than maximum step.");
    }
    return scenarioJson;
  }

  async function saveScenarioLimits(event) {
    event.preventDefault();
    const scenario = scenarios.find((item) => item.scenarioId === selectedScenarioId);
    if (!scenario) return;
    setIsSavingScenario(true);
    setMessage("");
    try {
      const scenarioJson = buildEditedScenarioJson(scenario);
      const updated = await updateScenarioRequest(selectedScenarioId, {
        name: scenarioDetails.name.trim(),
        description: scenarioDetails.description.trim(),
        scenarioJson,
      });
      let syncMessage = "";
      try {
        const syncResult = await runDataSync();
        if (syncResult.status === "error") throw new Error(syncResult.lastError);
        if (syncResult.conflicts?.length) {
          syncMessage = ` Synchronization reported ${syncResult.conflicts.length} conflict(s).`;
        }
      } catch (syncError) {
        syncMessage = ` Saved locally; synchronization failed: ${syncError.message}`;
      }
      const refreshed = await getScenarios();
      const persisted = refreshed.items.find((item) => item.scenarioId === updated.scenarioId);
      if (!persisted) throw new Error("The saved Scenario could not be read back from SQLite.");
      setScenarios(refreshed.items);
      setScenarioDetails({ name: persisted.name, description: persisted.description });
      setScenarioLimits(readScenarioLimits(persisted.scenarioJson));
      const wasReplaced = JSON.stringify(persisted.scenarioJson) !== JSON.stringify(updated.scenarioJson);
      setMessage(wasReplaced
        ? `${updated.scenarioId} was saved, but synchronization selected a different Scenario version.${syncMessage}`
        : `${updated.scenarioId} details and limits were verified in SQLite.${syncMessage}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSavingScenario(false);
    }
  }

  async function exportCompleteDataset() {
    try {
      const filename = await downloadDataExport("jsonl", {
        scope: "all",
        includeArchived: true,
      });
      setMessage(`${filename} downloaded with all active and archived records.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function removeScenario(scenario) {
    setScenarioRemoval(scenario);
    setScenarioRemovalConfirmation("");
  }

  async function confirmRemoveScenario(event) {
    event?.preventDefault();
    if (!scenarioRemoval || isRemovingScenario || scenarioRemovalConfirmation !== "Delete") return;
    setIsRemovingScenario(true);
    setMessage("");
    try {
      await deleteScenario(scenarioRemoval.scenarioId);
      setScenarios((current) => {
        const next = current.filter((item) => item.scenarioId !== scenarioRemoval.scenarioId);
        if (selectedScenarioId === scenarioRemoval.scenarioId) {
          setSelectedScenarioId(next[0]?.scenarioId ?? "");
          setScenarioDetails({
            name: next[0]?.name ?? "",
            description: next[0]?.description ?? "",
          });
          setScenarioLimits(next[0] ? readScenarioLimits(next[0].scenarioJson) : emptyScenarioLimits);
        }
        return next;
      });
      setScenarioRemoval(null);
      setScenarioRemovalConfirmation("");
      setMessage(`${scenarioRemoval.scenarioId} removed from active Scenario lists.`);
      runDataSync().catch(() => {});
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsRemovingScenario(false);
    }
  }

  const selectedScenario = scenarios.find((item) => item.scenarioId === selectedScenarioId);

  return (
    <section className="settings-page">
      <PageHeader
        title="Settings"
        description="This application validates once with local GMAT and stores mission data in this device's SQLite database."
      />

      <div className="settings-layout">
        <aside className="settings-navigation">
          <div className="settings-navigation-header">
            <span>Settings</span>
            <small>Device and Scenario controls</small>
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
              <p className="settings-section-note">
                When enabled, this device synchronizes every 60 seconds and immediately after a locally validated Solution is saved.
              </p>
              <div className={`sync-startup-status sync-startup-status-${startupSyncStatus?.state ?? "pending"}`}>
                <strong>Startup sync check</strong>
                <span>{startupSyncStatus?.message ?? "Waiting for desktop sync status..."}</span>
                {startupSyncStatus?.checkedAt ? <small>{new Date(startupSyncStatus.checkedAt).toLocaleString()}</small> : null}
              </div>
              {startupSyncStatus?.state === "error" ? (
                <p className="settings-section-note">
                  Try Test Relay, Sync Now, or update the relay address. If the error persists, report it at <a href="https://github.com/HSL-WHU/tasa-main-program/issues" target="_blank" rel="noreferrer">GitHub Issues</a> with the message above.
                </p>
              ) : null}
              <div className="settings-inline-actions scenario-form-actions">
                <button className="settings-secondary-button" type="button" onClick={testConnection}>Test Relay</button>
                <button className="settings-secondary-button" type="button" onClick={syncNow}>Repair Sync</button>
                <button className="settings-primary-button" type="button" onClick={saveSyncSettings}>Save</button>
              </div>
              <div className="sync-repair-guide">
                <strong>How synchronization is repaired</strong>
                <span>Repair Sync compares this device with the relay manifest. It pulls missing Solutions and pushes local Solutions that the relay does not have, so it does not need to know how many devices exist.</span>
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
              <button className="settings-primary-button" type="button" onClick={saveGmatSettings}>Save Local GMAT</button>
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

          {activeSection === "scenario-view" ? (
            <SettingsSection
              title="Scenario Viewer"
              description="Review the real Scenario state vectors, validation limits, and generated GMAT script before teams submit Solutions."
            >
              <form className="scenario-limits-form" onSubmit={saveScenarioLimits}>
                <SettingsRow label="Edit published Scenario" interactiveGroup>
                  <div className="settings-input-action">
                    <select value={selectedScenarioId} onChange={selectScenarioForEditing} required>
                      {scenarios.map((scenario) => (
                        <option key={scenario.scenarioId} value={scenario.scenarioId}>
                          {scenario.scenarioId}: {scenario.name}
                        </option>
                      ))}
                    </select>
                    <button className="solution-remove-button" type="button" onClick={() => removeScenario(selectedScenario)} disabled={!selectedScenario}>
                      Remove
                    </button>
                  </div>
                </SettingsRow>
                <SettingsRow label="Scenario name">
                  <input
                    name="name"
                    value={scenarioDetails.name}
                    onChange={updateScenarioDetails}
                    required
                    disabled={!selectedScenarioId}
                  />
                </SettingsRow>
                <SettingsRow label="Description">
                  <textarea
                    name="description"
                    value={scenarioDetails.description}
                    onChange={updateScenarioDetails}
                    disabled={!selectedScenarioId}
                  />
                </SettingsRow>
                <div className="scenario-edit-actions">
                  <button className="settings-primary-button" type="submit" disabled={isSavingScenario || !selectedScenarioId}>
                    {isSavingScenario ? "Saving…" : "Save Scenario"}
                  </button>
                  <button className="settings-secondary-button" type="button" onClick={previewGmatScript} disabled={!selectedScenarioId}>
                    Preview GMAT Script
                  </button>
                </div>
                <fieldset className="scenario-config-fields" disabled={!selectedScenarioId}>
                <ScenarioOverview scenario={selectedScenario} />
                <div className="scenario-limit-heading">Force Model</div>
                <p className="scenario-model-note">
                  Central-body point-mass gravity is always applied. Gravity field enables spherical harmonics above that baseline.
                </p>
                <div className="scenario-parameter-grid">
                  <ScenarioSelectField label="Central body" description="Defined by the uploaded state vectors" name="centralBody" value={scenarioLimits.centralBody} onChange={updateScenarioLimit} options={[scenarioLimits.centralBody || "Earth"]} disabled />
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
                  <ScenarioNumberField label="ΔVburn" description="Maximum Delta-V per burn, km/s" name="maximumDeltaVPerBurn" value={scenarioLimits.maximumDeltaVPerBurn} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="Tmax" description="Maximum mission time, s" name="maximumMissionTimeSec" value={scenarioLimits.maximumMissionTimeSec} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="Minimum burn separation" description="Seconds between consecutive burns" name="minimumBurnSeparationSec" value={scenarioLimits.minimumBurnSeparationSec} onChange={updateScenarioLimit} />
                </div>
                <div className="scenario-limit-heading">Score function</div>
                <div className="scenario-score-formula" aria-label="Score function formula">
                  <code>Score = 50 + 25 / (1 + exp(kt(Tteam - Ct))) + 25 / (1 + exp(kv(ΔVteam - Cv)))</code>
                  <span>Valid Solutions have intercepted within 5 km, so their distance term is always 50 points.</span>
                </div>
                <div className="scenario-parameter-grid">
                  <ScenarioNumberField label="Ct" description="Time center, s" name="timeReferenceSec" value={scenarioLimits.timeReferenceSec} onChange={updateScenarioLimit} allowZero />
                  <ScenarioNumberField label="kt" description="Time logistic slope" name="timeSlope" value={scenarioLimits.timeSlope} onChange={updateScenarioLimit} />
                  <ScenarioNumberField label="Cv" description="Delta-V center, km/s" name="deltaVReferenceKmPerSec" value={scenarioLimits.deltaVReferenceKmPerSec} onChange={updateScenarioLimit} allowZero />
                  <ScenarioNumberField label="kv" description="Delta-V logistic slope" name="deltaVSlope" value={scenarioLimits.deltaVSlope} onChange={updateScenarioLimit} />
                </div>
                </fieldset>
              </form>
              {scriptPreviewError ? <p className="settings-message settings-message-error">{scriptPreviewError}</p> : null}
              {scriptPreview ? (
                <div className="gmat-script-preview">
                  <div>
                    <strong>Generated GMAT script</strong>
                    <span>Preview uses the current unsaved Scenario settings with tWait=0, no burns, and finalCoastTime=60 s.</span>
                  </div>
                  <pre>{scriptPreview}</pre>
                </div>
              ) : null}
              <div className="scenario-admin-divider"><span>Complete data export</span></div>
              <div className="settings-inline-actions scenario-form-actions">
                <button className="settings-secondary-button" type="button" onClick={exportCompleteDataset}>Export all data</button>
              </div>
            </SettingsSection>
          ) : null}

          {activeSection === "scenario-publish" ? (
            <SettingsSection
              title="Publish Scenario"
              description="Upload or create a Scenario package. This page is separate from Scenario Viewer so published Scenarios are not confused with draft JSON."
            >
              <div className="scenario-schema-guide">
                <strong>Scenario JSON map</strong>
                <div>
                  <code>scenarioId</code><span>Assigned automatically when the Scenario is published.</span>
                  <code>name / description</code><span>Package fields shown in Scenario selectors and administration.</span>
                  <code>epoch</code><span>Initial epoch and time system</span>
                  <code>spacecraft.target / chaser</code><span>Cartesian position (km) and velocity (km/s)</span>
                  <code>forceModel</code><span>Gravity, third bodies, drag, SRP, and relativity</span>
                  <code>propagator</code><span>Integrator type, step sizes, and accuracy</span>
                  <code>validation</code><span>Mission and maneuver constraints</span>
                  <code>scoreConfig</code><span>Leaderboard score parameters</span>
                </div>
                <p>The editor below starts with a complete runnable template. Replace its example state vectors before publishing.</p>
              </div>
              <div className="scenario-format-actions scenario-form-actions">
                <button className="settings-secondary-button" type="button" onClick={() => setShowScenarioFormat((value) => !value)}>
                  {showScenarioFormat ? "Hide JSON Format" : "Show JSON Format"}
                </button>
                <button className="settings-secondary-button" type="button" onClick={copyScenarioFormat}>Copy Format</button>
                <button className="settings-secondary-button" type="button" onClick={downloadScenarioFormat}>Download Format</button>
              </div>
              {showScenarioFormat ? (
                <div className="scenario-format-preview">
                  <div>
                    <strong>Complete Scenario package format</strong>
                    <span>Load JSON Package accepts this full object. The manual form below separates name, description, and scenarioJson into individual fields. Scenario ID is generated automatically.</span>
                  </div>
                  <pre>{JSON.stringify(scenarioPackageTemplate, null, 2)}</pre>
                </div>
              ) : null}
              <label className="settings-secondary-button settings-file-button">
                Load JSON Package
                <input type="file" accept=".json" onChange={uploadScenario} hidden />
              </label>
              <form className="scenario-create-form" onSubmit={publishScenario}>
                <p className="settings-section-note">Scenario ID is assigned automatically using a sync-safe SC number.</p>
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
            </SettingsSection>
          ) : null}

          {message ? <p className="settings-message">{message}</p> : null}
        </main>
      </div>
      {scenarioRemoval ? (
        <div className="settings-dialog-backdrop" role="presentation">
          <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-scenario-title">
            <p className="submission-panel-eyebrow">Protected action</p>
            <h2 id="remove-scenario-title">Confirm removal</h2>
            <p>Type <strong>Delete</strong> to remove {scenarioRemoval.scenarioId}: {scenarioRemoval.name} from active lists. Its archived record remains in the complete export.</p>
            <input
              type="text"
              autoComplete="off"
              value={scenarioRemovalConfirmation}
              onChange={(event) => setScenarioRemovalConfirmation(event.target.value)}
              placeholder="Delete"
              autoFocus
            />
            <div className="settings-dialog-actions">
              <button
                type="button"
                onClick={() => { setScenarioRemoval(null); setScenarioRemovalConfirmation(""); }}
                disabled={isRemovingScenario}
              >
                Cancel
              </button>
              <button
                className="solution-remove-button"
                type="button"
                onClick={confirmRemoveScenario}
                disabled={isRemovingScenario || scenarioRemovalConfirmation !== "Delete"}
              >
                {isRemovingScenario ? "Removing…" : "Confirm Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ScenarioOverview({ scenario }) {
  if (!scenario?.scenarioJson) return null;
  const definition = scenario.scenarioJson;
  const target = readScenarioState(definition, "target");
  const chaser = readScenarioState(definition, "chaser");
  const validation = definition.validation ?? {};
  const initialDistance = vectorDistance(target.positionKm, chaser.positionKm);
  return (
    <section className="scenario-overview">
      <div className="scenario-overview-header">
        <div>
          <strong>Scenario Overview</strong>
          <span>These are the actual initial states used by GMAT validation.</span>
        </div>
        <code>{scenario.scenarioId}</code>
      </div>
      <div className="scenario-overview-grid">
        <ScenarioOverviewItem label="Epoch" value={definition.epoch?.value ?? definition.epoch ?? "Not set"} />
        <ScenarioOverviewItem label="Coordinate system" value={definition.coordinateSystem ?? "EarthMJ2000Eq"} />
        <ScenarioOverviewItem label="Initial distance" value={initialDistance == null ? "Unknown" : `${initialDistance.toFixed(6)} km`} />
        <ScenarioOverviewItem label="Target r0" value={formatVector(target.positionKm, "km")} wide />
        <ScenarioOverviewItem label="Target v0" value={formatVector(target.velocityKmPerSec, "km/s")} wide />
        <ScenarioOverviewItem label="Chaser r0" value={formatVector(chaser.positionKm, "km")} wide />
        <ScenarioOverviewItem label="Chaser v0" value={formatVector(chaser.velocityKmPerSec, "km/s")} wide />
        <ScenarioOverviewItem label="Required distance" value={`${validation.requiredFinalDistanceKm ?? "?"} km`} />
        <ScenarioOverviewItem label="Max Delta-V per burn" value={`${validation.maximumDeltaVPerBurn ?? validation.maximumTotalDeltaV ?? "?"} km/s`} />
        <ScenarioOverviewItem label="Max mission time" value={`${validation.maximumMissionTimeSec ?? "?"} s`} />
      </div>
    </section>
  );
}

function ScenarioOverviewItem({ label, value, wide = false }) {
  return (
    <div className={wide ? "is-wide" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatVector(values, unit) {
  if (!Array.isArray(values) || values.length !== 3) return "Unknown";
  return `[${values.map((value) => Number(value).toFixed(9)).join(", ")}] ${unit}`;
}

function readScenarioState(definition, role) {
  const spacecraft = definition.spacecraft?.[role] ?? {};
  const legacyState = definition[`${role}InitialState`] ?? {};
  return {
    positionKm: spacecraft.positionKm ?? spacecraft.initialState?.position ?? legacyState.positionKm,
    velocityKmPerSec: spacecraft.velocityKmPerSec ?? spacecraft.velocityKmPerS ?? spacecraft.initialState?.velocity ?? legacyState.velocityKmPerS,
  };
}

function vectorDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 3 || right.length !== 3) return null;
  return Math.hypot(...left.map((value, index) => Number(value) - Number(right[index])));
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
    maximumDeltaVPerBurn: String(validation.maximumDeltaVPerBurn ?? validation.maximumTotalDeltaV ?? ""),
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

function SettingsRow({ label, description, children, interactiveGroup = false }) {
  const Component = interactiveGroup ? "div" : "label";
  return (
    <Component className="settings-row">
      <span className="settings-row-label">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="settings-row-control">{children}</span>
    </Component>
  );
}
