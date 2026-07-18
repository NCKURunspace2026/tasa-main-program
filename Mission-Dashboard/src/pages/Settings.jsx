import { useEffect, useState } from "react";
import "./Pages.css";
import "./Settings.css";

import PageHeader from "../components/PageHeader.jsx";
import {
  createScenario,
  getServerAddress,
  getScenarios,
  setServerAddress,
  testServerConnection,
} from "../services/api.js";

const settingSections = [
  {
    id: "connection",
    label: "Connection",
    description: "Server and device configuration",
    icon: <ConnectionIcon />,
  },
  {
    id: "validation",
    label: "Validation",
    description: "Local GMAT validation settings",
    icon: <ValidationIcon />,
  },
  {
    id: "server",
    label: "Server Administration",
    description: "Publish scenarios for connected clients",
    icon: <ServerIcon />,
  },
];

const initialSettings = {
  serverAddress: getServerAddress(),
  gmatExecutablePath: "",
  validationTimeout: "120",
  keepTemporaryFiles: false,
};

const initialScenarioForm = {
  scenarioId: "",
  name: "",
  description: "",
  definition: "{}",
};

function loadInitialSettings() {
  try {
    const saved = window.localStorage.getItem(
      "mission-dashboard-settings",
    );
    return saved
      ? { ...initialSettings, ...JSON.parse(saved) }
      : initialSettings;
  } catch {
    return initialSettings;
  }
}

export default function Settings() {
  const [activeSection, setActiveSection] =
    useState("connection");

  const [settings, setSettings] =
    useState(loadInitialSettings);

  const [connectionState, setConnectionState] =
    useState("connected");

  const [testMessage, setTestMessage] =
    useState("");

  const [hasUnsavedChanges, setHasUnsavedChanges] =
    useState(false);

  const [saveMessage, setSaveMessage] = useState("");
  const [serverScenarios, setServerScenarios] = useState([]);
  const [scenarioForm, setScenarioForm] = useState(initialScenarioForm);
  const [scenarioMessage, setScenarioMessage] = useState("");
  const [isCreatingScenario, setIsCreatingScenario] = useState(false);
  const [isUploadingScenarioPackage, setIsUploadingScenarioPackage] =
    useState(false);

  useEffect(() => {
    let isCurrent = true;
    window.missionDashboardDesktop?.getGmatConfig?.()
      .then((result) => {
        if (isCurrent && result.gmatInstallationPath) {
          setSettings((current) => ({ ...current, gmatExecutablePath: result.gmatInstallationPath }));
        }
      })
      .catch(() => {});

    getScenarios()
      .then((result) => {
        if (isCurrent) setServerScenarios(result.items);
      })
      .catch((error) => {
        if (isCurrent) setScenarioMessage(error.message);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  function updateSetting(name, value) {
    setSettings((previousSettings) => ({
      ...previousSettings,
      [name]: value,
    }));

    setHasUnsavedChanges(true);
  }

  function handleInputChange(event) {
    const {
      name,
      value,
      type,
      checked,
    } = event.target;

    updateSetting(
      name,
      type === "checkbox"
        ? checked
        : value,
    );
  }

  async function handleSaveSettings() {
    setSaveMessage("Saving settings...");
    try {
      window.localStorage.setItem(
        "mission-dashboard-settings",
        JSON.stringify(settings),
      );
      setServerAddress(settings.serverAddress);
      if (window.missionDashboardDesktop?.saveGmatConfig) {
        await window.missionDashboardDesktop.saveGmatConfig({
          gmatInstallationPath: settings.gmatExecutablePath.trim(),
          timeoutMs: Number(settings.validationTimeout) * 1000,
          keepTemporaryFiles: settings.keepTemporaryFiles,
        });
      }
      setHasUnsavedChanges(false);
      setSaveMessage("Settings saved successfully.");
    } catch (error) {
      setSaveMessage(error.message);
    }
  }

  function handleResetSettings() {
    setSettings(initialSettings);
    setHasUnsavedChanges(false);
    setTestMessage("");
    setSaveMessage("");
  }

  async function handleTestConnection() {
    setConnectionState("checking");
    setTestMessage("Testing server connection...");
    try {
      const result = await testServerConnection(settings.serverAddress);
      setConnectionState("connected");
      setTestMessage(
        `Connection successful. Server responded in ${result.latencyMs} ms (${result.validationProvider}).`,
      );
    } catch (error) {
      setConnectionState("disconnected");
      setTestMessage(error.message);
    }
  }

  function handleTestGmat() {
    if (!window.missionDashboardDesktop) {
      setTestMessage("Local GMAT execution is available in the Electron Client app, not the browser preview.");
      return;
    }
    setTestMessage(settings.gmatExecutablePath.trim()
      ? "GMAT installation path is saved. A real propagation test runs when a Scenario with initial states is submitted."
      : "Choose the local GMAT installation or api folder first.");
  }

  async function handleBrowsePath(settingName) {
    if (settingName === "gmatExecutablePath" && window.missionDashboardDesktop?.selectGmatInstallation) {
      const config = await window.missionDashboardDesktop.selectGmatInstallation();
      if (config.gmatInstallationPath) updateSetting(settingName, config.gmatInstallationPath);
      return;
    }
    setTestMessage(
      "Browse is available only in the Electron app. Browser preview cannot access local folders.",
    );
  }

  function handleScenarioFormChange(event) {
    const { name, value } = event.target;
    setScenarioForm((current) => ({ ...current, [name]: value }));
  }

  async function handleCreateScenario(event) {
    event.preventDefault();
    setScenarioMessage("");
    setIsCreatingScenario(true);
    try {
      const definition = scenarioForm.definition.trim()
        ? JSON.parse(scenarioForm.definition)
        : {};
      const created = await createScenario({
        scenarioId: scenarioForm.scenarioId.trim().toUpperCase(),
        name: scenarioForm.name.trim(),
        description: scenarioForm.description.trim(),
        definition,
      });
      setServerScenarios((current) => [...current, created]
        .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)));
      setScenarioForm(initialScenarioForm);
      setScenarioMessage(
        `${created.scenarioId} was published to connected devices.`,
      );
    } catch (error) {
      setScenarioMessage(
        error instanceof SyntaxError
          ? "Scenario definition must be valid JSON."
          : error.message,
      );
    } finally {
      setIsCreatingScenario(false);
    }
  }

  async function handleScenarioPackageUpload(event) {
    const packageFile = event.target.files?.[0];
    event.target.value = "";
    if (!packageFile) return;

    setScenarioMessage("");
    setIsUploadingScenarioPackage(true);
    try {
      const scenarioPackage = JSON.parse(await packageFile.text());
      const created = await createScenario({
        scenarioId: String(scenarioPackage.scenarioId ?? "")
          .trim()
          .toUpperCase(),
        name: String(scenarioPackage.name ?? "").trim(),
        description: String(scenarioPackage.description ?? "").trim(),
        definition: scenarioPackage.definition ?? {},
      });
      setServerScenarios((current) => [...current, created]
        .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)));
      setScenarioMessage(
        `${created.scenarioId} was published from ${packageFile.name}.`,
      );
    } catch (error) {
      setScenarioMessage(
        error instanceof SyntaxError
          ? "Scenario package must be valid JSON."
          : error.message,
      );
    } finally {
      setIsUploadingScenarioPackage(false);
    }
  }

  return (
    <section className="settings-page">
      <PageHeader title="Settings" description="Configure the server connection, local GMAT installation and published scenarios." />

      <div className="settings-layout">
        <aside className="settings-navigation">
          <div className="settings-navigation-header">
            <span>Settings</span>

            <small>Local configuration</small>
          </div>

          <nav
            className="settings-navigation-list"
            aria-label="Settings sections"
          >
            {settingSections.map(
              (section) => (
                <button
                  key={section.id}
                  className={[
                    "settings-navigation-item",

                    activeSection ===
                    section.id
                      ? "is-active"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={() =>
                    setActiveSection(
                      section.id,
                    )
                  }
                >
                  <span className="settings-navigation-icon">
                    {section.icon}
                  </span>

                  <span className="settings-navigation-text">
                    <strong>
                      {section.label}
                    </strong>

                    <small>
                      {
                        section.description
                      }
                    </small>
                  </span>

                  <ChevronRightIcon />
                </button>
              ),
            )}
          </nav>

        </aside>

        <main className="settings-content">
          {activeSection ===
            "connection" && (
            <ConnectionSettings
              settings={settings}
              connectionState={
                connectionState
              }
              testMessage={testMessage}
              onChange={handleInputChange}
              onTestConnection={
                handleTestConnection
              }
            />
          )}

          {activeSection ===
            "validation" && (
            <ValidationSettings
              settings={settings}
              testMessage={testMessage}
              onChange={handleInputChange}
              onBrowsePath={
                handleBrowsePath
              }
              onTestGmat={handleTestGmat}
            />
          )}

          {activeSection === "server" && (
              <ServerSettings
                scenarios={serverScenarios}
                scenarioForm={scenarioForm}
                scenarioMessage={scenarioMessage}
                isCreatingScenario={isCreatingScenario}
                isUploadingScenarioPackage={isUploadingScenarioPackage}
                onScenarioChange={handleScenarioFormChange}
                onCreateScenario={handleCreateScenario}
                onScenarioPackageUpload={handleScenarioPackageUpload}
              />
            )}

          <div className="settings-save-bar">
            <div>
              <span
                className={[
                  "settings-save-indicator",

                  hasUnsavedChanges
                    ? "has-changes"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />

              <span>
                {hasUnsavedChanges
                  ? "You have unsaved changes."
                  : saveMessage || "All settings are saved."}
              </span>
            </div>

            <div className="settings-save-actions">
              <button
                className="settings-secondary-button"
                type="button"
                onClick={
                  handleResetSettings
                }
              >
                Reset
              </button>

              <button
                className="settings-primary-button"
                type="button"
                disabled={
                  !hasUnsavedChanges
                }
                onClick={
                  handleSaveSettings
                }
              >
                <SaveIcon />
                Save Changes
              </button>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

function GeneralSettings({
  settings,
  onChange,
}) {
  return (
    <SettingsSection
      eyebrow="Local preferences"
      title="General"
      description="These settings only affect how the application appears on this device."
    >
      <SettingsGroup
        title="Appearance"
        description="Customize the local interface."
        icon={<DisplayIcon />}
      >
        <SettingsRow
          label="Theme"
          description="Choose the application color theme."
        >
          <select
            name="appearance"
            value={settings.appearance}
            onChange={onChange}
          >
            <option value="dark">
              Dark
            </option>

            <option value="light">
              Light
            </option>

            <option value="system">
              System
            </option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="Language"
          description="Select the interface language."
        >
          <select
            name="language"
            value={settings.language}
            onChange={onChange}
          >
            <option value="en">
              English
            </option>

            <option value="zh-TW">
              Traditional Chinese
            </option>
          </select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Display"
        description="Configure default pages and table behavior."
        icon={<LayoutIcon />}
      >
        <SettingsRow
          label="Default landing page"
          description="The page shown after login."
        >
          <select
            name="defaultPage"
            value={settings.defaultPage}
            onChange={onChange}
          >
            <option value="overview">
              Overview
            </option>

            <option value="submissions">
              Submissions
            </option>

            <option value="solutions">
              Solutions
            </option>

            <option value="leaderboard">
              Leaderboard
            </option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="Rows per page"
          description="Default number of table rows."
        >
          <select
            name="rowsPerPage"
            value={settings.rowsPerPage}
            onChange={onChange}
          >
            <option value="10">
              10
            </option>

            <option value="20">
              20
            </option>

            <option value="50">
              50
            </option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="Auto refresh"
          description="Refresh read-only server data automatically."
        >
          <select
            name="autoRefresh"
            value={settings.autoRefresh}
            onChange={onChange}
          >
            <option value="0">
              Disabled
            </option>

            <option value="10">
              Every 10 seconds
            </option>

            <option value="30">
              Every 30 seconds
            </option>

            <option value="60">
              Every minute
            </option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="Validation details"
          description="Show detailed validation steps and messages."
        >
          <SwitchField
            name="showValidationDetails"
            checked={
              settings.showValidationDetails
            }
            onChange={onChange}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

function ConnectionSettings({
  settings,
  connectionState,
  testMessage,
  onChange,
  onTestConnection,
}) {
  return (
    <SettingsSection
      eyebrow="Network configuration"
      title="Connection"
      description="Connect this application to the central server computer."
    >
      <SettingsGroup
        title="Server Connection"
        description="The address used to communicate with the central computer."
        icon={<ConnectionIcon />}
      >
        <SettingsRow
          label="Server address"
          description="Enter the central server URL or local network address."
          vertical
        >
          <div className="settings-input-action">
            <input
              type="text"
              name="serverAddress"
              value={
                settings.serverAddress
              }
              placeholder="http://192.168.1.100:8000"
              onChange={onChange}
            />

            <button
              className="settings-secondary-button"
              type="button"
              disabled={
                connectionState ===
                "checking"
              }
              onClick={
                onTestConnection
              }
            >
              {connectionState ===
              "checking"
                ? "Testing..."
                : "Test Connection"}
            </button>
          </div>

          {testMessage && (
            <p className="settings-inline-message">
              {testMessage}
            </p>
          )}
        </SettingsRow>
      </SettingsGroup>

    </SettingsSection>
  );
}

function ValidationSettings({
  settings,
  testMessage,
  onChange,
  onBrowsePath,
  onTestGmat,
}) {
  return (
    <SettingsSection
      eyebrow="Local execution"
      title="Validation"
      description="Configure how this device runs and stores local GMAT validation results."
    >
      <SettingsGroup
        title="GMAT Installation"
        description="Each Electron Client runs its own local GMAT Console installation."
        icon={<ValidationIcon />}
      >
        <PathSetting
          label="GMAT installation / API folder"
          description="Select the GMAT installation folder or its api folder. The app finds GmatConsole automatically."
          name="gmatExecutablePath"
          value={
            settings.gmatExecutablePath
          }
          placeholder="Select GMAT installation or api folder"
          onChange={onChange}
          onBrowse={() =>
            onBrowsePath(
              "gmatExecutablePath",
            )
          }
        />

        <SettingsRow
          label="Validation timeout"
          description="Maximum allowed runtime for one validation."
        >
          <div className="settings-unit-input">
            <input
              type="text"
              inputMode="numeric"
              name="validationTimeout"
              value={
                settings.validationTimeout
              }
              onChange={onChange}
            />

            <span>seconds</span>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Test GMAT installation"
          description="Check whether this application can start GMAT."
        >
          <button
            className="settings-secondary-button"
            type="button"
            onClick={onTestGmat}
          >
            <PlayIcon />
            Run Test
          </button>
        </SettingsRow>

        {testMessage && (
          <div className="settings-group-message">
            <InfoIcon />
            <span>{testMessage}</span>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Temporary files"
        description="Keep generated GMAT scripts and reports for debugging."
        icon={<FolderIcon />}
      >
        <SettingsRow
          label="Keep temporary files"
          description="Preserve generated scripts and temporary validation files."
        >
          <SwitchField
            name="keepTemporaryFiles"
            checked={
              settings.keepTemporaryFiles
            }
            onChange={onChange}
          />
        </SettingsRow>
      </SettingsGroup>

    </SettingsSection>
  );
}

function AccountSettings({
  user,
  device,
  onSignOut,
}) {
  return (
    <SettingsSection
      eyebrow="Authentication"
      title="Account"
      description="View the currently authenticated user and device permissions."
    >
      <SettingsGroup
        title="Current User"
        description="Account currently signed into this application."
        icon={<UserIcon />}
      >
        <div className="settings-account-profile">
          <div className="settings-account-avatar">
            {user.name
              .slice(0, 1)
              .toUpperCase()}
          </div>

          <div>
            <strong>{user.name}</strong>

            <span>@{user.username}</span>
          </div>

          <span className="settings-role-badge">
            {user.role}
          </span>
        </div>

        <ReadOnlyRow
          label="User ID"
          value={user.id}
        />

        <ReadOnlyRow
          label="Account role"
          value={user.role}
        />

        <ReadOnlyRow
          label="Device role"
          value={device.role}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Security"
        description="Manage this login session."
        icon={<LockIcon />}
      >
        <SettingsRow
          label="Change password"
          description="Update the password used to sign in."
        >
          <button
            className="settings-secondary-button"
            type="button"
          >
            Change Password
          </button>
        </SettingsRow>

        <SettingsRow
          label="Sign out"
          description="Remove the current session from this device."
        >
          <button
            className="settings-danger-button"
            type="button"
            onClick={onSignOut}
          >
            Sign Out
          </button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

function ServerSettings({
  scenarios,
  scenarioForm,
  scenarioMessage,
  isCreatingScenario,
  isUploadingScenarioPackage,
  onScenarioChange,
  onCreateScenario,
  onScenarioPackageUpload,
}) {
  return (
    <SettingsSection
      eyebrow="Server only"
      title="Server Administration"
      description="Publish competition scenarios to connected clients."
    >
      <SettingsGroup
        title="Scenario Management"
        description="Publish competition scenarios so connected devices can select them and submit solutions."
        icon={<ValidationIcon />}
      >
        <div className="scenario-package-upload">
          <div>
            <strong>Upload Scenario Package</strong>
            <p>
              Publish a JSON package from the Server device. The package definition will be available to all connected clients.
            </p>
          </div>

          <label className="settings-secondary-button">
            <input
              className="scenario-package-file-input"
              type="file"
              accept="application/json,.json"
              disabled={isUploadingScenarioPackage}
              onChange={onScenarioPackageUpload}
            />
            {isUploadingScenarioPackage
              ? "Uploading..."
              : "Upload JSON Package"}
          </label>
        </div>

        <div className="scenario-package-contract">
          <code>{'{ scenarioId, name, description, definition }'}</code>
          <span>
            JSON only in this phase. GMAT scripts and ZIP bundles will be added when the real validation provider is defined.
          </span>
        </div>

        <form
          className="scenario-management-form"
          onSubmit={onCreateScenario}
        >
          <div className="scenario-form-grid">
            <label>
              <span>Scenario ID</span>
              <input
                name="scenarioId"
                value={scenarioForm.scenarioId}
                placeholder="SC-003"
                pattern="[Ss][Cc]-[0-9]{3,}"
                required
                onChange={onScenarioChange}
              />
            </label>

            <label>
              <span>Scenario name</span>
              <input
                name="name"
                value={scenarioForm.name}
                placeholder="Lunar Transfer Challenge"
                required
                onChange={onScenarioChange}
              />
            </label>

            <label className="scenario-form-wide">
              <span>Description</span>
              <textarea
                name="description"
                value={scenarioForm.description}
                placeholder="Describe the mission objective shown to participating devices."
                rows="3"
                onChange={onScenarioChange}
              />
            </label>

            <label className="scenario-form-wide">
              <span>Scenario definition (JSON)</span>
              <textarea
                className="scenario-definition-input"
                name="definition"
                value={scenarioForm.definition}
                placeholder='{"frame":"EarthMJ2000Eq","units":{"distance":"km","time":"s"}}'
                rows="5"
                onChange={onScenarioChange}
              />
              <small>
                Reserved for coordinate frames, initial states, targets and constraints required by the future GMAT validator.
              </small>
            </label>
          </div>

          <div className="scenario-form-actions">
            <span>{scenarioMessage}</span>
            <button
              className="settings-primary-button"
              type="submit"
              disabled={isCreatingScenario}
            >
              {isCreatingScenario ? "Publishing..." : "Publish Scenario"}
            </button>
          </div>
        </form>

        <div className="scenario-admin-list">
          {scenarios.map((scenario) => (
            <article key={scenario.scenarioId}>
              <div>
                <strong>{scenario.scenarioId}</strong>
                <span>{scenario.name}</span>
              </div>
              <span className="registered-device-status is-approved">
                Active
              </span>
            </article>
          ))}
        </div>
      </SettingsGroup>

    </SettingsSection>
  );
}

function SettingsSection({
  eyebrow,
  title,
  description,
  children,
}) {
  return (
    <div className="settings-section">
      <header className="settings-section-header">
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </header>

      <div className="settings-section-body">
        {children}
      </div>
    </div>
  );
}

function SettingsGroup({
  title,
  description,
  icon,
  children,
}) {
  return (
    <section className="settings-group">
      <header className="settings-group-header">
        <span className="settings-group-icon">
          {icon}
        </span>

        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>

      <div className="settings-group-content">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  vertical = false,
  children,
}) {
  return (
    <div
      className={[
        "settings-row",
        vertical
          ? "settings-row-vertical"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="settings-row-label">
        <strong>{label}</strong>

        <span>{description}</span>
      </div>

      <div className="settings-row-control">
        {children}
      </div>
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  status,
}) {
  return (
    <div className="settings-readonly-row">
      <span>{label}</span>

      <strong
        className={
          status
            ? `settings-value-${status}`
            : ""
        }
      >
        {status && (
          <i aria-hidden="true" />
        )}

        {value}
      </strong>
    </div>
  );
}

function PathSetting({
  label,
  description,
  name,
  value,
  placeholder,
  onChange,
  onBrowse,
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      vertical
    >
      <div className="settings-input-action">
        <input
          type="text"
          name={name}
          value={value}
          placeholder={placeholder}
          onChange={onChange}
        />

        <button
          className="settings-secondary-button"
          type="button"
          onClick={onBrowse}
        >
          Browse
        </button>
      </div>
    </SettingsRow>
  );
}

function SwitchField({
  name,
  checked,
  onChange,
}) {
  return (
    <label className="settings-switch">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={onChange}
      />

      <span className="settings-switch-track">
        <span />
      </span>
    </label>
  );
}

function DisplayIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="12"
        rx="2"
      />
      <path d="M9 20h6M12 16.5V20" />
    </svg>
  );
}

function ConnectionIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        d="M5 9.5a10 10 0 0 1 14 0M8 13a5.75 5.75 0 0 1 8 0M11 16.5a1.5 1.5 0 0 1 2 0"
      />
    </svg>
  );
}

function ValidationIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.5 19 6v5.5c0 4.25-2.75 7.25-7 9-4.25-1.75-7-4.75-7-9V6l7-2.5Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m8.75 12 2.1 2.1 4.4-4.6"
      />
    </svg>
  );
}

function UserIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="8" r="3.25" />
      <path
        strokeLinecap="round"
        d="M5.5 19c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5"
      />
    </svg>
  );
}

function ServerIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="4"
        y="4"
        width="16"
        height="6"
        rx="1.5"
      />
      <rect
        x="4"
        y="14"
        width="16"
        height="6"
        rx="1.5"
      />
      <path d="M8 7h.01M8 17h.01M12 7h5M12 17h5" />
    </svg>
  );
}

function ShieldIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.5 19 6v5.5c0 4.25-2.75 7.25-7 9-4.25-1.75-7-4.75-7-9V6l7-2.5Z"
      />
    </svg>
  );
}

function ChevronRightIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 6 6 6-6 6"
      />
    </svg>
  );
}

function LayoutIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="3.5"
        y="4"
        width="17"
        height="16"
        rx="2"
      />
      <path d="M9 4v16M9 10h11" />
    </svg>
  );
}

function DeviceIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="5"
        y="3.5"
        width="14"
        height="17"
        rx="2"
      />
      <path d="M9 17.5h6" />
    </svg>
  );
}

function FolderIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 7.5A2 2 0 0 1 5.5 5.5H10l2 2h6.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z"
      />
    </svg>
  );
}

function LockIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <rect
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2"
      />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  );
}

function DatabaseIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
      <path d="M4.5 5.5v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3v-6M4.5 11.5v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3v-6" />
    </svg>
  );
}

function SaveIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 4h11l3 3v13H5V4Z"
      />
      <path d="M8 4v6h8V4M8.5 20v-6h7v6" />
    </svg>
  );
}

function PlayIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 6 9 6-9 6V6Z"
      />
    </svg>
  );
}

function InfoIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.5v5M12 7.5h.01" />
    </svg>
  );
}

function MoreIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

function DownloadIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4v11m0 0-4-4m4 4 4-4M5 19.5h14"
      />
    </svg>
  );
}
