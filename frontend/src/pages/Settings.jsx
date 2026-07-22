import { useEffect, useState } from "react";
import "./Pages.css";
import "./Settings.css";

import PageHeader from "../components/PageHeader.jsx";
import {
  createScenario,
  deleteScenario,
  deleteSolution,
  downloadDataExport,
  getCloudAddress,
  getScenarios,
  getSyncSettings,
  getSolutions,
  restoreScenario,
  restoreSolution,
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
  syncSharedKey: "",
  gmatExecutablePath: "",
  validationTimeout: "120",
  keepTemporaryFiles: false,
  runOfficialValidationWorker: false,
};

const emptyScenarioLimits = {
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

const emptyScenario = {
  scenarioId: "",
  name: "",
  description: "",
  scenarioJson: "{}",
};

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
  const [scenarioForm, setScenarioForm] = useState(emptyScenario);
  const [isPublishing, setIsPublishing] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [scenarioLimits, setScenarioLimits] = useState(emptyScenarioLimits);
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const [solutions, setSolutions] = useState([]);
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

  useEffect(() => {
    if (!canAdmin || !selectedScenarioId) {
      setSolutions([]);
      return;
    }
    getSolutions({ scenarioId: selectedScenarioId, includeDeleted: true })
      .then((result) => setSolutions(result.items))
      .catch((error) => setMessage(error.message));
  }, [canAdmin, selectedScenarioId]);

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
        ...(settings.syncSharedKey ? { sharedKey: settings.syncSharedKey } : {}),
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
      setScenarioForm(emptyScenario);
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
    const { name, value } = event.target;
    setScenarioLimits((current) => ({ ...current, [name]: value }));
  }

  async function saveScenarioLimits(event) {
    event.preventDefault();
    const scenario = scenarios.find((item) => item.scenarioId === selectedScenarioId);
    if (!scenario) return;
    setIsSavingScenario(true);
    setMessage("");
    try {
      const scenarioJson = structuredClone(scenario.scenarioJson);
      scenarioJson.propagator = {
        ...scenarioJson.propagator,
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

  async function changeScenarioStatus(scenario) {
    try {
      const updated = scenario.status === "active"
        ? await deleteScenario(scenario.scenarioId)
        : await restoreScenario(scenario.scenarioId);
      setScenarios((current) => current.map((item) => (
        item.scenarioId === updated.scenarioId ? updated : item
      )));
      setMessage(`${updated.scenarioId} is now ${updated.status}. No database rows were deleted.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function changeSolutionStatus(solution) {
    try {
      const updated = solution.deletedAt
        ? await restoreSolution(solution.solutionId)
        : await deleteSolution(solution.solutionId);
      setSolutions((current) => current.map((item) => (
        item.solutionId === updated.solutionId
          ? { ...item, deletedAt: updated.deletedAt }
          : item
      )));
      setMessage(`${updated.solutionId} ${updated.deletedAt ? "archived" : "restored"}. The ML record remains stored.`);
    } catch (error) {
      setMessage(error.message);
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
              <SettingsRow
                label="Shared sync key"
                description="Leave blank to keep the key already saved in the local database."
              >
                <input
                  name="syncSharedKey"
                  type="password"
                  value={settings.syncSharedKey}
                  onChange={updateSetting}
                  autoComplete="off"
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
                Check for Updates
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
                <div className="scenario-limit-heading">Propagator</div>
                <ScenarioNumberField label="Initial step" description="Integrator initial step in seconds." name="initialStepSec" value={scenarioLimits.initialStepSec} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Maximum step" description="Largest integration step allowed, in seconds." name="maxStepSec" value={scenarioLimits.maxStepSec} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Minimum step" description="Smallest integration step allowed, in seconds." name="minStepSec" value={scenarioLimits.minStepSec} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Integrator accuracy" description="Numerical integration error tolerance." name="accuracy" value={scenarioLimits.accuracy} onChange={updateScenarioLimit} />
                <div className="scenario-limit-heading">Validation limits</div>
                <ScenarioNumberField label="Required final distance" description="Maximum accepted interception distance in km." name="requiredFinalDistanceKm" value={scenarioLimits.requiredFinalDistanceKm} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Maximum total Delta-V (ΔVlim)" description="Maximum total maneuver magnitude in km/s." name="maximumTotalDeltaV" value={scenarioLimits.maximumTotalDeltaV} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Maximum mission time (Tmax)" description="Maximum propagated mission duration in seconds." name="maximumMissionTimeSec" value={scenarioLimits.maximumMissionTimeSec} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Minimum burn count" name="minimumBurnCount" value={scenarioLimits.minimumBurnCount} onChange={updateScenarioLimit} integer />
                <ScenarioNumberField label="Maximum burn count" name="maximumBurnCount" value={scenarioLimits.maximumBurnCount} onChange={updateScenarioLimit} integer />
                <ScenarioNumberField label="Minimum burn separation (Δtmin)" description="Minimum time between burns in seconds." name="minimumBurnSeparationSec" value={scenarioLimits.minimumBurnSeparationSec} onChange={updateScenarioLimit} />
                <div className="scenario-limit-heading">Score function</div>
                <ScenarioNumberField label="Distance reference (Dref)" description="Distance with no exponential decay, in km." name="distanceReferenceKm" value={scenarioLimits.distanceReferenceKm} onChange={updateScenarioLimit} allowZero />
                <ScenarioNumberField label="Distance decay (kd)" description="Distance exponential decay scale, in km." name="distanceDecayKm" value={scenarioLimits.distanceDecayKm} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Time reference (Tref)" description="Center of the time sigmoid, in seconds." name="timeReferenceSec" value={scenarioLimits.timeReferenceSec} onChange={updateScenarioLimit} allowZero />
                <ScenarioNumberField label="Time slope (kt)" description="Slope of the mission-time sigmoid." name="timeSlope" value={scenarioLimits.timeSlope} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Delta-V reference (Delta Vlim)" description="Center of the Delta-V sigmoid, in km/s." name="deltaVReferenceKmPerSec" value={scenarioLimits.deltaVReferenceKmPerSec} onChange={updateScenarioLimit} allowZero />
                <ScenarioNumberField label="Delta-V slope (kv)" description="Slope of the Delta-V sigmoid." name="deltaVSlope" value={scenarioLimits.deltaVSlope} onChange={updateScenarioLimit} />
                <ScenarioNumberField label="Distance coefficient (Cd)" name="distanceWeight" value={scenarioLimits.distanceWeight} onChange={updateScenarioLimit} allowZero />
                <ScenarioNumberField label="Time coefficient (Ct)" name="timeWeight" value={scenarioLimits.timeWeight} onChange={updateScenarioLimit} allowZero />
                <ScenarioNumberField label="Delta-V coefficient (Cv)" name="deltaVWeight" value={scenarioLimits.deltaVWeight} onChange={updateScenarioLimit} allowZero />
                <button className="settings-primary-button" type="submit" disabled={isSavingScenario || !selectedScenarioId}>
                  {isSavingScenario ? "Saving…" : "Save Scenario Limits"}
                </button>
              </form>
              <div className="scenario-admin-divider"><span>Publish another Scenario</span></div>
              <label className="settings-secondary-button settings-file-button">
                Load JSON Package
                <input type="file" accept=".json" onChange={uploadScenario} hidden />
              </label>
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
                    required
                  />
                </SettingsRow>
                <button className="settings-primary-button" type="submit" disabled={isPublishing}>
                  {isPublishing ? "Publishing…" : "Publish Scenario"}
                </button>
              </form>
              <div className="scenario-admin-list">
                {scenarios.map((scenario) => (
                  <article key={scenario.scenarioId}>
                    <div><strong>{scenario.scenarioId}</strong><span>{scenario.name} · {scenario.status}</span></div>
                    <button className="settings-secondary-button" type="button" onClick={() => changeScenarioStatus(scenario)}>
                      {scenario.status === "active" ? "Archive" : "Restore"}
                    </button>
                  </article>
                ))}
              </div>
              <div className="scenario-admin-divider"><span>Solutions and ML dataset</span></div>
              <p className="settings-data-note">Archive hides a Solution from the leaderboard without deleting its submissions or validation data.</p>
              <div className="settings-inline-actions scenario-form-actions">
                <button className="settings-secondary-button" type="button" onClick={() => exportDataset("jsonl")}>Export JSONL</button>
                <button className="settings-secondary-button" type="button" onClick={() => exportDataset("csv")}>Export CSV</button>
              </div>
              <div className="scenario-admin-list solution-admin-list">
                {solutions.length === 0 ? <p>No Solutions for this Scenario.</p> : null}
                {solutions.map((solution) => (
                  <article key={solution.solutionId}>
                    <div><strong>{solution.solutionId}</strong><span>{solution.name} · {solution.deletedAt ? "archived" : solution.status}</span></div>
                    <button className="settings-secondary-button" type="button" onClick={() => changeSolutionStatus(solution)}>
                      {solution.deletedAt ? "Restore" : "Archive"}
                    </button>
                  </article>
                ))}
              </div>
            </SettingsSection>
          ) : null}

          {message ? <p className="settings-message">{message}</p> : null}
        </main>
      </div>
    </section>
  );
}

function ScenarioNumberField({ label, description, name, value, onChange, integer = false, allowZero = false }) {
  return (
    <SettingsRow label={label} description={description}>
      <input
        type="number"
        name={name}
        value={value}
        step={integer ? "1" : "any"}
        min={allowZero || name === "requiredFinalDistanceKm" || name === "minimumBurnSeparationSec" ? "0" : "0.000000000001"}
        onChange={onChange}
        required
      />
    </SettingsRow>
  );
}

function readScenarioLimits(definition) {
  const propagator = definition.propagator ?? {};
  const validation = definition.validation ?? {};
  const scoreConfig = definition.scoreConfig ?? {};
  return Object.fromEntries(Object.keys(emptyScenarioLimits).map((key) => [
    key,
    String(propagator[key] ?? validation[key] ?? scoreConfig[key] ?? ""),
  ]));
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
