import { useEffect, useRef, useState } from "react";
import "./Pages.css";
import "./Submissions.css";

import PageHeader from "../components/PageHeader.jsx";
import useScenarios from "../hooks/useScenarios.js";
import { createSubmission, getSubmission } from "../services/api.js";

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
    title: "Local GMAT validation",
    description:
      "The submitted trajectory is checked locally.",
  },
  {
    id: "result",
    title: "Validation result",
    description:
      "The result is ready to upload to the central computer.",
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

    const hasMissingGeneralField =
      manualValues.team.trim() === "";

    const hasInvalidFinalCoastTime =
      !isValidNumber(
        manualValues.finalCoastTime,
      ) ||
      Number(manualValues.finalCoastTime) < 0;

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
      tWait: 0,
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
        throw new Error("Local GMAT validation did not pass. The solution was not uploaded.");
      }
      const localValidationSeconds = (performance.now() - localValidationStartedAt) / 1000;
      const executionEvidence = localResult.artifacts?.execution ?? null;
      const result = await createSubmission({
        ...submission,
        clientValidation: {
          passed: true,
          provider: localResult.provider,
          minimumDistanceKm: localResult.minimumDistance,
          missionTimeSec: localResult.totalTime,
          totalDeltaVKmPerSec: localResult.totalDeltaV,
        },
      });
      if (validationRunRef.current !== currentRun) return;
      setValidationState({
        status: result.status === "accepted" ? "queued" : "failed",
        currentStep: 4,
        message: result.status === "accepted"
          ? `Local GMAT passed in ${localValidationSeconds.toFixed(2)} s via ${localResult.provider}. ${result.submissionId} is waiting for central GMAT.`
          : result.message ?? "Submission was not accepted.",
        checkedAt: new Date(),
        submissionId: result.submissionId,
        solutionId: null,
        executionEvidence,
      });
      if (result.status !== "accepted") return;

      const officialResult = await waitForOfficialResult(result.submissionId, currentRun);
      if (!officialResult || validationRunRef.current !== currentRun) return;
      if (officialResult.status === "passed") {
        setValidationState({
          status: "passed",
          currentStep: 4,
          message: `Central GMAT passed. Official minimum distance: ${officialResult.officialResults.minimumDistanceKm.toFixed(6)} km.`,
          checkedAt: new Date(),
          submissionId: result.submissionId,
          solutionId: officialResult.solutionId,
          executionEvidence,
        });
        return;
      }
      setValidationState({
        status: "failed",
        currentStep: 4,
        message: officialResult.errorMessage ?? "Central GMAT validation failed.",
        checkedAt: new Date(),
        submissionId: result.submissionId,
        solutionId: officialResult.solutionId,
        executionEvidence,
      });
    } catch (error) {
      if (validationRunRef.current !== currentRun) return;
      setValidationState({
        status: "failed",
        currentStep: 2,
        message: error.message,
        checkedAt: new Date(),
        submissionId: null,
        solutionId: null,
        executionEvidence: null,
      });
    }
  }

  async function waitForOfficialResult(submissionId, currentRun) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (validationRunRef.current !== currentRun) return null;
      const result = await getSubmission(submissionId);
      if (result.status === "passed" || result.status === "failed") return result;
      setValidationState((state) => ({
        ...state,
        status: "queued",
        currentStep: 4,
        message: result.status === "validating"
          ? `Central GMAT is validating ${submissionId}.`
          : `${submissionId} is queued for central GMAT validation.`,
      }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Central GMAT did not finish within 120 seconds.");
  }

  function resetValidation() {
    validationRunRef.current += 1;

    setValidationState(
      initialValidationState,
    );
  }

  return (
    <section className="submissions-page">
      <PageHeader
        title="Submissions"
        description="Enter the trajectory decision variables. The application runs local GMAT before uploading to the central computer."
      >
        <div className="submission-scenario-field">
          <label htmlFor="submission-scenario">
            Scenario
          </label>

          <select
            id="submission-scenario"
            value={scenarioId}
            onChange={handleScenarioChange}
          >
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

function ManualSubmission({
  values,
  burns,
  onChange,
  onBurnChange,
  onAddBurn,
  onRemoveBurn,
  onSubmit,
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

              {index < burns.length - 1 ? (
                <NumericField
                  label="Time to next burn"
                  value={burn.coastTime}
                  placeholder="0.00"
                  suffix="s"
                  onChange={(value) =>
                    onBurnChange(burn.id, "coastTime", value)
                  }
                />
              ) : null}
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
        >
          <ValidationIcon />
          Validate Manual Input
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

  const isQueued =
    validationState.status === "queued";

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
              (isRunning || isQueued || isFailed);

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
          isRunning || isQueued ? "is-running" : "",
          isPassed ? "is-passed" : "",
          isFailed ? "is-failed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="validation-message-icon">
          {(isRunning || isQueued) && <LoadingIcon />}
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
          <span>Upload status</span>

          <strong>
            {isPassed
              ? "Officially validated"
              : isQueued
                ? "Central validation pending"
                : "Waiting for validation"}
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
    queued: "Central check",
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
    queued: "Waiting for central GMAT",
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
