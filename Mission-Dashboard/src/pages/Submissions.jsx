import { useEffect, useRef, useState } from "react";
import "./Pages.css";
import "./Submissions.css";

import PageHeader from "../components/PageHeader.jsx";
import useScenarios from "../hooks/useScenarios.js";
import { createSubmission } from "../services/api.js";

import {
  Tab,
  TabList,
} from "@astryxdesign/core/TabList";

const validationDefinitions = [
  {
    id: "received",
    title: "Submission received",
    description:
      "The file or manual input has been received.",
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

  const [submissionMode, setSubmissionMode] =
    useState("file");

  const [selectedFile, setSelectedFile] =
    useState(null);

  const [isDragging, setIsDragging] =
    useState(false);

  const [manualValues, setManualValues] =
    useState(initialManualValues);

  const [burns, setBurns] = useState([
    createEmptyBurn(),
  ]);

  const [validationState, setValidationState] =
    useState(initialValidationState);

  const validationRunRef = useRef(0);
  const fileInputRef = useRef(null);

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

  function handleSubmissionModeChange(nextMode) {
    setSubmissionMode(nextMode);
    resetValidation();
  }

  function handleFileInputChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    acceptFile(file);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();

    if (
      event.currentTarget.contains(
        event.relatedTarget,
      )
    ) {
      return;
    }

    setIsDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (!file) {
      return;
    }

    acceptFile(file);
  }

  function acceptFile(file) {
    setSelectedFile(file);
    resetValidation();
  }

  function removeSelectedFile() {
    validationRunRef.current += 1;

    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

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
        schemaVersion: "1.1",
        scenarioId,
        solution: {
          name: manualValues.team.trim(),
          type: "manual",
          notes: manualValues.notes.trim() || null,
        },
        optimization: null,
        finalDecisionVariables,
      },
      "manual",
    );
  }

  async function handleFileValidation() {
    if (!selectedFile) return;
    try {
      const payload = JSON.parse(await selectedFile.text());
      await runValidation({ ...payload, scenarioId }, "file");
    } catch (error) {
      setValidationState({
        status: "failed",
        currentStep: 2,
        message: error instanceof SyntaxError
          ? "The selected file is not valid JSON."
          : error.message,
        checkedAt: new Date(),
        submissionId: null,
        solutionId: null,
      });
    }
  }

  async function runValidation(submission, inputType) {
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
      setValidationState((state) => ({
        ...state,
        currentStep: 3,
        message: "Running submission validation.",
      }));
      const result = await createSubmission(submission, inputType);
      if (validationRunRef.current !== currentRun) return;
      const isMock = result.validationProvider === "mock-validation-not-physical";
      setValidationState({
        status: result.status === "validated" && !isMock ? "passed" : "failed",
        currentStep: 4,
        message: isMock
          ? "Development Mock validation only: no physical GMAT result was produced. Do not treat this as a competition submission."
          : result.status === "validated"
          ? `Validation passed. Solution ${result.solutionId} was created.`
          : result.errorMessage ?? "Validation failed.",
        checkedAt: new Date(),
        submissionId: result.submissionId,
        solutionId: isMock ? null : result.solutionId,
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
      });
    }
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
        description="Upload a solution file or enter the solution manually. The application validates the input before uploading it to the central computer."
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

          <div className="submission-mode-tabs">
            <TabList
              value={submissionMode}
              onChange={
                handleSubmissionModeChange
              }
              layout="fill"
            >
              <Tab
                value="file"
                label="File Upload"
              />

              <Tab
                value="manual"
                label="Manual Entry"
              />
            </TabList>
          </div>

          <div className="submission-workspace-content">
            {submissionMode === "file" && (
              <FileSubmission
                selectedFile={selectedFile}
                isDragging={isDragging}
                fileInputRef={fileInputRef}
                onFileInputChange={
                  handleFileInputChange
                }
                onBrowse={() =>
                  fileInputRef.current?.click()
                }
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onRemove={removeSelectedFile}
                onValidate={handleFileValidation}
              />
            )}

            {submissionMode === "manual" && (
              <ManualSubmission
                values={manualValues}
                burns={burns}
                onChange={
                  handleManualValueChange
                }
                onBurnChange={
                  handleBurnChange
                }
                onAddBurn={addBurn}
                onRemoveBurn={removeBurn}
                onSubmit={handleManualSubmit}
              />
            )}
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

function FileSubmission({
  selectedFile,
  isDragging,
  fileInputRef,
  onFileInputChange,
  onBrowse,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemove,
  onValidate,
}) {
  return (
    <div className="file-submission">
      <input
        ref={fileInputRef}
        className="submission-file-input"
        type="file"
        accept=".json,.csv,.txt,.zip,.py"
        onChange={onFileInputChange}
      />

      <div
        className={[
          "submission-drop-zone",
          isDragging ? "is-dragging" : "",
          selectedFile ? "has-file" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {selectedFile ? (
          <div className="selected-file">
            <div className="selected-file-icon">
              <FileIcon />
            </div>

            <div className="selected-file-information">
              <span className="selected-file-label">
                Selected file
              </span>

              <strong>
                {selectedFile.name}
              </strong>

              <span>
                {formatFileSize(
                  selectedFile.size,
                )}
              </span>
            </div>

            <button
              className="remove-file-button"
              type="button"
              onClick={onRemove}
              aria-label="Remove selected file"
            >
              <CloseIcon />
            </button>
          </div>
        ) : (
          <>
            <div className="submission-upload-icon">
              <UploadIcon />
            </div>

            <h3>Drop submission file here</h3>

            <p>
              Supported formats: JSON, CSV, TXT,
              ZIP and Python files.
            </p>

            <button
              className="submission-secondary-button"
              type="button"
              onClick={onBrowse}
            >
              Browse Files
            </button>
          </>
        )}
      </div>

      <div className="file-submission-information">
        <div>
          <span>Validation method</span>
          <strong>Local GMAT check</strong>
        </div>

        <div>
          <span>Upload destination</span>
          <strong>
            Central collection computer
          </strong>
        </div>
      </div>

      <div className="submission-actions">
        {selectedFile && (
          <button
            className="submission-secondary-button"
            type="button"
            onClick={onBrowse}
          >
            Replace File
          </button>
        )}

        <button
          className="submission-primary-button"
          type="button"
          disabled={!selectedFile}
          onClick={onValidate}
        >
          <ValidationIcon />
          Run Validation
        </button>
      </div>
    </div>
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
          <strong>Local GMAT runner</strong>
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
              ? "Ready to upload"
              : "Waiting for validation"}
          </strong>
        </div>
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

function formatFileSize(sizeInBytes) {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  if (sizeInBytes < 1024 * 1024) {
    return `${(
      sizeInBytes / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    sizeInBytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
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

function UploadIcon(props) {
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
        d="M12 15V4.5m0 0-4 4m4-4 4 4M5.25 13.5v4.25A1.75 1.75 0 0 0 7 19.5h10a1.75 1.75 0 0 0 1.75-1.75V13.5"
      />
    </svg>
  );
}

function FileIcon(props) {
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
        d="M7.5 3.75h5.25l4.5 4.5v12H7.5a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z"
      />

      <path d="M12.75 3.75v4.5h4.5" />

      <path
        strokeLinecap="round"
        d="M8.75 13h5.5M8.75 16h5.5"
      />
    </svg>
  );
}

function CloseIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <path
        strokeLinecap="round"
        d="m7 7 10 10M17 7 7 17"
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
