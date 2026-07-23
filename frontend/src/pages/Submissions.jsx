import { useEffect, useRef, useState } from "react";
import "./Pages.css";
import "./Submissions.css";

import PageHeader from "../components/PageHeader.jsx";
import useScenarios from "../hooks/useScenarios.js";
import { createSubmission, runDataSync } from "../services/api.js";

const validationDefinitions = [
  {
    id: "received",
    title: "Submission received",
    description:
      "The manual trajectory input has been received.",
  },
  {
    id: "format",
    title: "Input format check",
    description:
      "Required fields and numeric values are valid.",
  },
  {
    id: "gmat",
    title: "GMAT validation",
    description:
      "The submitted trajectory is checked locally.",
  },
  {
    id: "result",
    title: "Local result saved",
    description:
      "The locally validated result is scored and stored in this device's database.",
  },
];

function createEmptyBurn() {
  return {
    id: crypto.randomUUID(),
    deltaVX: "",
    deltaVY: "",
    deltaVZ: "",
    coastTime: "",
  };
}

const initialManualValues = {
  team: "",
  initialCoastTime: "",
  finalCoastTime: "",
  notes: "",
};

const initialValidationState = {
  status: "idle",
  currentStep: 0,
  message: "Waiting for a submission.",
  checkedAt: null,
  submissionId: null,
  solutionId: null,
  executionEvidence: null,
  validationMetrics: null,
};

function isValidNumber(value) {
  if (typeof value !== "string") {
    return false;
  }

  if (value.trim() === "") {
    return false;
  }

  return Number.isFinite(Number(value));
}

export default function Submissions({ onNavigate }) {
  const {
    scenarioOptions,
    scenarioError,
    scenariosLoaded,
  } = useScenarios();
  const [scenarioId, setScenarioId] =
    useState("SC-001");

  const [manualValues, setManualValues] =
    useState(initialManualValues);

  const [burns, setBurns] = useState([
    createEmptyBurn(),
  ]);

  const [validationState, setValidationState] =
    useState(initialValidationState);

  const validationRunRef = useRef(0);

  useEffect(() => {
    if (
      scenariosLoaded &&
      scenarioOptions.length > 0 &&
      !scenarioOptions.some((scenario) => scenario.id === scenarioId)
    ) {
      setScenarioId(scenarioOptions[0].id);
    }
  }, [scenarioId, scenarioOptions, scenariosLoaded]);

  function handleScenarioChange(event) {
    setScenarioId(event.target.value);
    resetValidation();
  }

  function handleManualValueChange(event) {
    const { name, value } = event.target;

    setManualValues((previousValues) => ({
      ...previousValues,
      [name]: value,
    }));
  }

  function addBurn() {
    setBurns((previousBurns) => [
      ...previousBurns,
      createEmptyBurn(),
    ]);

    resetValidation();
  }

  function removeBurn(burnId) {
    setBurns((previousBurns) => {
      if (previousBurns.length === 1) {
        return previousBurns;
      }

      return previousBurns.filter(
        (burn) => burn.id !== burnId,
      );
    });

    resetValidation();
  }

  function handleBurnChange(
    burnId,
    fieldName,
    value,
  ) {
    setBurns((previousBurns) =>
      previousBurns.map((burn) =>
        burn.id === burnId
          ? {
              ...burn,
              [fieldName]: value,
            }
          : burn,
      ),
    );
  }

  function handleManualSubmit(event) {
    event.preventDefault();

    if (!scenariosLoaded || scenarioOptions.length === 0) {
      setValidationState({
        status: "failed",
        currentStep: 1,
        message: scenariosLoaded
          ? "No Scenario is available. Publish one in Settings."
          : "Scenario definitions are still loading.",
        checkedAt: new Date(),
        submissionId: null,
        solutionId: null,
        executionEvidence: null,
      });
      return;
    }

    const hasMissingGeneralField =
      manualValues.team.trim() === "";

    const hasInvalidFinalCoastTime =
      !isValidNumber(
        manualValues.finalCoastTime,
      ) ||
      Number(manualValues.finalCoastTime) < 0;

    const hasInvalidInitialCoastTime =
      !isValidNumber(manualValues.initialCoastTime) ||
      Number(manualValues.initialCoastTime) < 0;

    const hasInvalidBurn = burns.some(
      (burn, index) =>
        !isValidNumber(burn.deltaVX) ||
        !isValidNumber(burn.deltaVY) ||
        !isValidNumber(burn.deltaVZ) ||
        (index < burns.length - 1 &&
          (!isValidNumber(burn.coastTime) ||
            Number(burn.coastTime) < 0)),
    );

    if (
      hasMissingGeneralField ||
      hasInvalidInitialCoastTime ||
      hasInvalidFinalCoastTime ||
      hasInvalidBurn
    ) {
      setValidationState({
        status: "failed",
        currentStep: 2,
        message:
          "Please enter valid numeric values. Coast times must be zero or greater.",
        checkedAt: new Date(),
      });

      return;
    }

    const finalDecisionVariables = {
      tWait: Number(manualValues.initialCoastTime),
      burns: burns.map((burn, index) => ({
        deltaV: [
          Number(burn.deltaVX),
          Number(burn.deltaVY),
          Number(burn.deltaVZ),
        ],
        ...(index < burns.length - 1
          ? { timeToNextBurn: Number(burn.coastTime) }
          : {}),
      })),
      finalCoastTime: Number(manualValues.finalCoastTime),
    };

    runValidation(
      {
        schemaVersion: 2,
        scenarioId,
        solution: {
          name: manualValues.team.trim(),
          decisionVariables: finalDecisionVariables,
        },
      },
    );
  }

  async function runValidation(submission) {
    validationRunRef.current += 1;

    const currentRun =
      validationRunRef.current;
    let failedStep = 2;

    setValidationState({
      status: "running",
      currentStep: 1,
      message: "Submission received.",
      checkedAt: null,
      submissionId: null,
      solutionId: null,
    });

    try {
      const scenario = scenarioOptions.find((item) => item.id === scenarioId);
      if (!window.missionDashboardDesktop?.validateWithLocalGmat) {
        throw new Error("Physical local GMAT validation requires the Electron Client app.");
      }
      if (!scenario?.scenarioJson || Object.keys(scenario.scenarioJson).length === 0) {
        throw new Error("The selected Scenario has no simulation definition.");
      }
      failedStep = 3;
      setValidationState((state) => ({
        ...state,
        currentStep: 3,
        message: "Running local GMAT validation.",
      }));
      const localValidationStartedAt = performance.now();
      const localResult = await window.missionDashboardDesktop.validateWithLocalGmat({
        scenario,
        finalDecisionVariables: submission.solution.decisionVariables,
      });
      if (localResult.status !== "validated") {
        throw new Error(formatValidationFailure(localResult));
      }
      failedStep = 4;
      const localValidationSeconds = (performance.now() - localValidationStartedAt) / 1000;
      const executionEvidence = localResult.artifacts?.execution ?? null;
      const result = await createSubmission({
        ...submission,
        clientValidation: {
          passed: true,
          provider: localResult.provider,
          minimumDistanceKm: localResult.minimumDistance,
          minimumDistanceTimeSec: localResult.minimumDistanceTime,
          missionTimeSec: localResult.totalTime,
          totalDeltaVKmPerSec: localResult.totalDeltaV,
        },
      });
      if (validationRunRef.current !== currentRun) return;
      if (result.status !== "passed") {
        throw new Error(result.message ?? "The locally validated Solution was not saved.");
      }
      setValidationState({
        status: "passed",
        currentStep: 4,
        message: `Local GMAT passed in ${localValidationSeconds.toFixed(2)} s via ${localResult.provider}. The scored Solution was saved locally and will be synchronized.`,
        checkedAt: new Date(),
        submissionId: result.submissionId,
        solutionId: result.solutionId,
        executionEvidence,
        validationMetrics: {
          minimumDistanceKm: localResult.minimumDistance,
          minimumDistanceTimeSec: localResult.minimumDistanceTime,
          finalDistanceKm: localResult.finalDistance,
          totalTimeSec: localResult.totalTime,
          totalDeltaVKmPerSec: localResult.totalDeltaV,
        },
      });
      runDataSync().catch(() => {});
    } catch (error) {
      if (validationRunRef.current !== currentRun) return;
      setValidationState({
        status: "failed",
        currentStep: failedStep,
        message: error.message,
        checkedAt: new Date(),
        submissionId: null,
        solutionId: null,
        executionEvidence: null,
        validationMetrics: null,
      });
    }
  }

  function resetValidation() {
    validationRunRef.current += 1;

    setValidationState(
      initialValidationState,
    );
  }

  const selectedScenario = scenarioOptions.find((item) => item.id === scenarioId);

  return (
    <section className="submissions-page">
      <PageHeader
        title="Submissions"
        description="Enter the trajectory decision variables. This device runs one local GMAT validation, scores the result, and saves it to the local dataset."
      >
        <div className="submission-scenario-field">
          <label htmlFor="submission-scenario">
            Scenario
          </label>

          <select
            id="submission-scenario"
            value={scenarioId}
            onChange={handleScenarioChange}
            disabled={!scenariosLoaded || scenarioOptions.length === 0}
          >
            {scenarioOptions.length === 0 ? (
              <option value="">
                {scenariosLoaded ? "No active Scenario" : "Loading Scenarios…"}
              </option>
            ) : null}
            {scenarioOptions.map((scenario) => (
              <option
                key={scenario.id}
                value={scenario.id}
              >
                {scenario.label}
              </option>
            ))}
          </select>

          {scenarioError ? (
            <span className="submission-scenario-error">
              Scenario list is temporarily unavailable.
            </span>
          ) : null}
        </div>
      </PageHeader>

      <SubmissionScenarioSummary scenario={selectedScenario} />

      <div className="submission-main-layout">
        <section className="submission-panel submission-workspace-panel">
          <header className="submission-panel-header">
            <div>
              <p className="submission-panel-eyebrow">
                Solution input
              </p>

              <h2>Submission Workspace</h2>
            </div>
          </header>

          <div className="submission-workspace-content">
            <ManualSubmission
              values={manualValues}
              burns={burns}
              onChange={handleManualValueChange}
              onBurnChange={handleBurnChange}
              onAddBurn={addBurn}
              onRemoveBurn={removeBurn}
              onSubmit={handleManualSubmit}
              canSubmit={scenariosLoaded && scenarioOptions.length > 0}
            />
          </div>
        </section>

        <ValidationPanel
          scenarioId={scenarioId}
          validationState={validationState}
          onViewSolution={() =>
            onNavigate?.("leaderboard", {
              scenarioId,
              solutionId: validationState.solutionId,
            })
          }
        />
      </div>
    </section>
  );
}

function formatValidationFailure(result) {
  const failed = (result.constraints ?? []).filter((constraint) => !constraint.satisfied);
  if (failed.length === 0) return "Local GMAT validation did not pass. The solution was not uploaded.";
  return `Validation failed: ${failed.map((constraint) => `${constraint.name} ${formatMetric(constraint.value)} ${constraint.operator} ${formatMetric(constraint.limit)} was not satisfied`).join("; ")}.`;
}

function formatMetric(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(6) : String(value);
}

function SubmissionScenarioSummary({ scenario }) {
  if (!scenario?.scenarioJson) return null;
  const definition = scenario.scenarioJson;
  const target = readSummaryScenarioState(definition, "target");
  const chaser = readSummaryScenarioState(definition, "chaser");
  const validation = definition.validation ?? {};
  const initialDistance = scenarioVectorDistance(target.positionKm, chaser.positionKm);
  return (
    <section className="submission-scenario-summary">
      <div>
        <span>Selected Scenario</span>
        <strong>{scenario.id}: {scenario.label.replace(`${scenario.id}: `, "")}</strong>
      </div>
      <div><span>Epoch</span><strong>{definition.epoch?.value ?? definition.epoch ?? "Not set"}</strong></div>
      <div><span>Initial distance</span><strong>{initialDistance == null ? "Unknown" : `${initialDistance.toFixed(6)} km`}</strong></div>
      <div><span>Target r0</span><strong>{formatScenarioVector(target.positionKm, "km")}</strong></div>
      <div><span>Chaser r0</span><strong>{formatScenarioVector(chaser.positionKm, "km")}</strong></div>
      <div><span>Required distance</span><strong>{validation.requiredFinalDistanceKm ?? "?"} km</strong></div>
      <div><span>Max Delta-V per burn</span><strong>{validation.maximumDeltaVPerBurn ?? validation.maximumTotalDeltaV ?? "?"} km/s</strong></div>
    </section>
  );
}

function formatScenarioVector(values, unit) {
  if (!Array.isArray(values) || values.length !== 3) return "Unknown";
  return `[${values.map((value) => Number(value).toFixed(6)).join(", ")}] ${unit}`;
}

function readSummaryScenarioState(definition, role) {
  const spacecraft = definition.spacecraft?.[role] ?? {};
  const legacyState = definition[`${role}InitialState`] ?? {};
  return {
    positionKm: spacecraft.positionKm ?? spacecraft.initialState?.position ?? legacyState.positionKm,
    velocityKmPerSec: spacecraft.velocityKmPerSec ?? spacecraft.velocityKmPerS ?? spacecraft.initialState?.velocity ?? legacyState.velocityKmPerS,
  };
}

function scenarioVectorDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 3 || right.length !== 3) return null;
  return Math.hypot(...left.map((value, index) => Number(value) - Number(right[index])));
}

function ManualSubmission({
  values,
  burns,
  onChange,
  onBurnChange,
  onAddBurn,
  onRemoveBurn,
  onSubmit,
  canSubmit,
}) {
  return (
    <form
      className="manual-submission-form"
      onSubmit={onSubmit}
    >
      <div className="manual-form-grid manual-form-grid-primary">
        <TextField
          label="Team / Method"
          name="team"
          value={values.team}
          placeholder="Apex Trajectory"
          required
          onChange={onChange}
        />

        <NumericField
          label="Initial coast time"
          value={values.initialCoastTime}
          placeholder="0.00"
          suffix="s"
          onChange={(value) => onChange({
            target: { name: "initialCoastTime", value },
          })}
        />

      </div>

      <div className="manual-burn-list">
        {burns.map((burn, index) => (
          <section
            className="manual-burn-section"
            key={burn.id}
          >
            <header>
              <div className="manual-burn-title">
                <BurnIcon />

                <h3>Burn {index + 1}</h3>
              </div>

              <button
                className="remove-burn-button"
                type="button"
                disabled={burns.length === 1}
                onClick={() =>
                  onRemoveBurn(burn.id)
                }
              >
                Remove
              </button>
            </header>

            <div className="manual-vector-grid">
              <NumericField
                label="Delta-V X"
                value={burn.deltaVX}
                placeholder="0.0000"
                suffix="km/s"
                allowNegative
                onChange={(value) =>
                  onBurnChange(
                    burn.id,
                    "deltaVX",
                    value,
                  )
                }
              />

              <NumericField
                label="Delta-V Y"
                value={burn.deltaVY}
                placeholder="0.0000"
                suffix="km/s"
                allowNegative
                onChange={(value) =>
                  onBurnChange(
                    burn.id,
                    "deltaVY",
                    value,
                  )
                }
              />

              <NumericField
                label="Delta-V Z"
                value={burn.deltaVZ}
                placeholder="0.0000"
                suffix="km/s"
                allowNegative
                onChange={(value) =>
                  onBurnChange(
                    burn.id,
                    "deltaVZ",
                    value,
                  )
                }
              />

              <NumericField
                label="Time to next burn"
                value={index < burns.length - 1 ? burn.coastTime : ""}
                placeholder={index < burns.length - 1 ? "0.00" : "Use final coast time"}
                suffix="s"
                disabled={index === burns.length - 1}
                onChange={(value) =>
                  onBurnChange(burn.id, "coastTime", value)
                }
              />
            </div>
          </section>
        ))}
      </div>

      <button
        className="add-burn-button"
        type="button"
        onClick={onAddBurn}
      >
        <PlusIcon />
        Add Burn
      </button>

      <div className="manual-final-coast">
        <NumericField
          label="Final coast time"
          value={values.finalCoastTime}
          placeholder="0.00"
          suffix="s"
          onChange={(value) =>
            onChange({
              target: {
                name: "finalCoastTime",
                value,
              },
            })
          }
        />
      </div>

      <label className="manual-notes-field">
        <span>Notes</span>

        <textarea
          name="notes"
          value={values.notes}
          maxLength={250}
          placeholder="Optional notes about this submission."
          onChange={onChange}
        />

        <small>
          {values.notes.length} / 250
        </small>
      </label>

      <div className="submission-actions">
        <button
          className="submission-primary-button"
          type="submit"
          disabled={!canSubmit}
        >
          <ValidationIcon />
          {canSubmit ? "Validate Manual Input" : "No Active Scenario"}
        </button>
      </div>
    </form>
  );
}

function TextField({
  label,
  name,
  value,
  placeholder,
  required = false,
  onChange,
}) {
  return (
    <label className="manual-form-field">
      <span>
        {label}

        {required && (
          <strong aria-hidden="true">
            *
          </strong>
        )}
      </span>

      <div className="manual-input-wrapper">
        <input
          type="text"
          name={name}
          value={value}
          placeholder={placeholder}
          required={required}
          onChange={onChange}
        />
      </div>
    </label>
  );
}

function NumericField({
  label,
  value,
  placeholder,
  suffix,
  allowNegative = false,
  disabled = false,
  onChange,
}) {
  function handleChange(event) {
    const nextValue = event.target.value;

    const allowedPattern = allowNegative
      ? /^-?(?:\d+\.?\d*|\.\d*)?(?:[eE][+-]?\d*)?$/
      : /^(?:\d+\.?\d*|\.\d*)?(?:[eE][+-]?\d*)?$/;

    if (
      nextValue === "" ||
      allowedPattern.test(nextValue)
    ) {
      onChange(nextValue);
    }
  }

  return (
    <label className="manual-form-field">
      <span>
        {label}
        <strong aria-hidden="true">
          *
        </strong>
      </span>

      <div className="manual-input-wrapper">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          required
          autoComplete="off"
          disabled={disabled}
          onChange={handleChange}
        />

        <span className="manual-input-suffix">
          {suffix}
        </span>
      </div>
    </label>
  );
}

function ValidationPanel({
  scenarioId,
  validationState,
  onViewSolution,
}) {
  const isIdle =
    validationState.status === "idle";

  const isRunning =
    validationState.status === "running";

  const isPassed =
    validationState.status === "passed";

  const isFailed =
    validationState.status === "failed";

  return (
    <aside className="submission-panel validation-panel">
      <header className="submission-panel-header validation-panel-header">
        <div>
          <p className="submission-panel-eyebrow">
            Automatic check
          </p>

          <h2>Validation Status</h2>
        </div>

        <ValidationBadge
          status={validationState.status}
        />
      </header>

      <div className="validation-progress">
        {validationDefinitions.map(
          (step, index) => {
            const stepNumber = index + 1;

            const isComplete =
              validationState.currentStep >
                stepNumber ||
              isPassed;

            const isCurrent =
              validationState.currentStep ===
                stepNumber &&
              (isRunning || isFailed);

            return (
              <div
                key={step.id}
                className={[
                  "validation-step",
                  isComplete
                    ? "is-complete"
                    : "",
                  isCurrent
                    ? "is-current"
                    : "",
                  isFailed && isCurrent
                    ? "is-failed"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="validation-step-marker">
                  {isComplete ? (
                    <CheckIcon />
                  ) : isFailed &&
                    isCurrent ? (
                    <ErrorIcon />
                  ) : (
                    <span>{stepNumber}</span>
                  )}
                </div>

                <div className="validation-step-content">
                  <strong>
                    {step.title}
                  </strong>

                  <p>{step.description}</p>
                </div>
              </div>
            );
          },
        )}
      </div>

      <div
        className={[
          "validation-message",
          isRunning ? "is-running" : "",
          isPassed ? "is-passed" : "",
          isFailed ? "is-failed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="validation-message-icon">
          {isRunning && <LoadingIcon />}
          {isPassed && <CheckIcon />}
          {isFailed && <ErrorIcon />}
          {isIdle && <ValidationIcon />}
        </div>

        <div>
          <strong>
            {getValidationTitle(
              validationState.status,
            )}
          </strong>

          <p>{validationState.message}</p>
        </div>
      </div>

      <div className="validation-metadata">
        <div>
          <span>Scenario</span>
          <strong>{scenarioId}</strong>
        </div>

        <div>
          <span>Validation engine</span>
          <strong>
            {validationState.executionEvidence?.mode ?? "Local GMAT runner"}
          </strong>
        </div>

        <div>
          <span>Last checked</span>

          <strong>
            {validationState.checkedAt
              ? formatDateTime(
                  validationState.checkedAt,
                )
              : "Not checked"}
          </strong>
        </div>

        <div>
          <span>Dataset status</span>

          <strong>
            {isPassed
              ? "Saved locally"
              : "Waiting for local validation"}
          </strong>
        </div>

        {validationState.executionEvidence ? (
          <div>
            <span>GMAT process proof</span>
            <strong>
              Exit {validationState.executionEvidence.exitCode}
              {" · "}
              {(validationState.executionEvidence.durationMs / 1000).toFixed(2)} s
              {" · "}
              {validationState.executionEvidence.reportBytes} bytes
            </strong>
          </div>
        ) : null}

        {validationState.validationMetrics ? (
          <div>
            <span>Minimum distance</span>
            <strong>
              {validationState.validationMetrics.minimumDistanceKm.toFixed(6)} km
            </strong>
          </div>
        ) : null}

        {validationState.validationMetrics ? (
          <div>
            <span>Time at minimum distance</span>
            <strong>
              {formatOptionalSeconds(validationState.validationMetrics.minimumDistanceTimeSec)}
            </strong>
          </div>
        ) : null}

        {validationState.executionEvidence ? (
          <div>
            <span>Report SHA-256</span>
            <strong title={validationState.executionEvidence.reportSha256}>
              {validationState.executionEvidence.reportSha256.slice(0, 16)}…
            </strong>
          </div>
        ) : null}
      </div>

      {isPassed && validationState.solutionId ? (
        <button
          className="submission-primary-button validation-view-button"
          type="button"
          onClick={onViewSolution}
        >
          View in Leaderboard
        </button>
      ) : null}
    </aside>
  );
}

function ValidationBadge({ status }) {
  const labels = {
    idle: "Waiting",
    running: "Checking",
    passed: "Validated",
    failed: "Failed",
  };

  return (
    <span
      className={`validation-badge validation-badge-${status}`}
    >
      <span />
      {labels[status]}
    </span>
  );
}

function getValidationTitle(status) {
  const titles = {
    idle: "Ready for submission",
    running: "Validation in progress",
    passed: "Validation passed",
    failed: "Validation failed",
  };

  return titles[status];
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat(
    undefined,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    },
  ).format(date);
}

function formatOptionalSeconds(value) {
  if (value == null || value === "") return "Not reported";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue.toFixed(6)} s` : "Not reported";
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

function BurnIcon(props) {
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
        d="M13.5 3.75c.5 3-1 4.5-2.5 6.25-1.25 1.5-2.25 3-1 5.25.75 1.25 2 2 3.5 2 2.25 0 4-1.75 4-4 0-1.75-.75-3.25-2.25-4.75.25 2-.5 3-1.5 3.75.25-2.75-1-5.5-.25-8.5Z"
      />

      <path
        strokeLinecap="round"
        d="M12 20.25c-3.75 0-6.75-2.75-6.75-6.5 0-2.5 1.25-4.75 3.25-6.25"
      />
    </svg>
  );
}

function PlusIcon(props) {
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
        d="M12 5v14M5 12h14"
      />
    </svg>
  );
}

function CheckIcon(props) {
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
        d="m6.5 12.25 3.5 3.5 7.5-8"
      />
    </svg>
  );
}

function ErrorIcon(props) {
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
        d="M12 7.5v5"
      />

      <circle
        cx="12"
        cy="16"
        r=".75"
        fill="currentColor"
        stroke="none"
      />

      <circle
        cx="12"
        cy="12"
        r="8.25"
      />
    </svg>
  );
}

function LoadingIcon(props) {
  return (
    <svg
      className="validation-loading-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        d="M20 12a8 8 0 1 1-2.35-5.65"
      />
    </svg>
  );
}
