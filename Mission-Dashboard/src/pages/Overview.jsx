import { useEffect, useMemo, useState } from "react";
import "./Overview.css";
import "./Pages.css";

import PageHeader from "../components/PageHeader.jsx";
import useScenarios from "../hooks/useScenarios.js";
import { getLeaderboard } from "../services/api.js";

import {
  Table,
  proportional,
  pixel,
} from "@astryxdesign/core/Table";

import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";

const recentSolutionColumns = [
  {
    key: "id",
    header: "ID",
    width: proportional(1.15),
  },
  {
    key: "score",
    header: "Score",
    width: proportional(0.8),
  },
  {
    key: "minimumDistance",
    header: "Min. Distance",
    width: proportional(1.15),
  },
  {
    key: "totalTime",
    header: "Total Time",
    width: proportional(1.15),
  },
  {
    key: "deltaV",
    header: "Delta-V",
    width: proportional(1.1),
  },
  {
    key: "burns",
    header: "Burns",
    width: pixel(90),
  },
  {
    key: "status",
    header: "Status",
    width: proportional(1),
  },
];

export default function Overview({ onNavigate }) {
  const {
    scenarioOptions,
    scenarioError,
    scenariosLoaded,
  } = useScenarios();
  const [scenarioId, setScenarioId] =
    useState("SC-001");
  const [recentSolutions, setRecentSolutions] = useState([]);
  const [leaderboardError, setLeaderboardError] = useState("");

  useEffect(() => {
    if (
      scenariosLoaded &&
      scenarioOptions.length > 0 &&
      !scenarioOptions.some((scenario) => scenario.id === scenarioId)
    ) {
      setScenarioId(scenarioOptions[0].id);
    }
  }, [scenarioId, scenarioOptions, scenariosLoaded]);

  useEffect(() => {
    let isCurrent = true;
    getLeaderboard(scenarioId, { page: "1", pageSize: "3" })
      .then((result) => {
        if (isCurrent) {
          setRecentSolutions(result.items);
          setLeaderboardError("");
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setRecentSolutions([]);
          setLeaderboardError(error.message);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [scenarioId]);

  const tableData = useMemo(() => {
    return recentSolutions.map(
      (solution) => ({
        id: solution.solutionId,
        score: solution.officialScore.toFixed(2),
        minimumDistance: `${solution.finalDistance.toFixed(3)} km`,
        totalTime: `${solution.totalTime.toLocaleString()} s`,
        deltaV: `${solution.totalDeltaV.toFixed(4)} km/s`,
        burns: solution.burnCount,
        status: "Validated",
      }),
    );
  }, [recentSolutions]);

  const bestSolution = recentSolutions[0] ?? null;

  const recentSolutionPlugin = useMemo(
    () => ({
      transformBodyRow(props, item) {
        return {
          ...props,
          htmlProps: {
            ...props.htmlProps,
            className: "overview-solution-row",
            tabIndex: 0,
            onClick: () => onNavigate?.("leaderboard", {
              scenarioId,
              solutionId: item.id,
            }),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onNavigate?.("leaderboard", {
                  scenarioId,
                  solutionId: item.id,
                });
              }
            },
          },
        };
      },
    }),
    [onNavigate, scenarioId],
  );

  function handleScenarioChange(event) {
    setScenarioId(event.target.value);
  }

  return (
    <section className="overview-page">
      <PageHeader
        title="Overview"
        description="Monitor the current competition scenario, best validated solution and recent submissions."
      >
        <div className="overview-scenario-field">
          <label htmlFor="overview-scenario">
            Scenario
          </label>

          <select
            id="overview-scenario"
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
        </div>
      </PageHeader>

      <div className="overview-primary-layout">
        <section className="overview-panel trajectory-overview-panel">
          <header className="overview-panel-header">
            <div>
              <p className="overview-panel-eyebrow">
                Current scenario
              </p>

              <h2>Trajectory Overview</h2>
            </div>

            <span className="overview-active-status">
              <span className="overview-active-dot" />
              Active
            </span>
          </header>

          <div className="trajectory-image-container">
            <div className="trajectory-image-placeholder">
              <div className="trajectory-placeholder-icon">
                <ImageIcon />
              </div>

              <h3>GMAT Trajectory Result</h3>

              <p>
                The screenshot from the best validated
                submission will appear here.
              </p>

              <span>
                GMAT validation is not connected yet.
              </span>
            </div>
          </div>
        </section>

        <aside className="overview-panel mission-summary-panel">
          <header className="overview-panel-header">
            <div>
              <p className="overview-panel-eyebrow">
                Best solution
              </p>

              <h2>Mission Summary</h2>
            </div>
          </header>

          <div className="mission-summary-content">
            {bestSolution ? (
            <MetadataList>
              <MetadataListItem
                label={
                  <MetadataLabel
                    icon={<TrophyIcon />}
                    text="Best score"
                  />
                }
              >
                <span className="overview-highlight-value">
                  {bestSolution.officialScore.toFixed(2)}
                </span>
              </MetadataListItem>

              <MetadataListItem
                label={
                  <MetadataLabel
                    icon={<TargetIcon />}
                    text="Minimum distance"
                  />
                }
              >
                <span className="overview-highlight-value">
                  {bestSolution.finalDistance.toFixed(3)}{" "}
                  km
                </span>
              </MetadataListItem>

              <MetadataListItem
                label={
                  <MetadataLabel
                    icon={<ClockIcon />}
                    text="Total time"
                  />
                }
              >
                {bestSolution.totalTime.toLocaleString()}{" "}
                s
              </MetadataListItem>

              <MetadataListItem
                label={
                  <MetadataLabel
                    icon={<DeltaVIcon />}
                    text="Total Delta-V"
                  />
                }
              >
                {bestSolution.totalDeltaV.toFixed(4)}{" "}
                km/s
              </MetadataListItem>

              <MetadataListItem
                label={
                  <MetadataLabel
                    icon={<BurnIcon />}
                    text="Burns"
                  />
                }
              >
                {bestSolution.burnCount}
              </MetadataListItem>

              <MetadataListItem
                label={
                  <MetadataLabel
                    icon={<ValidationIcon />}
                    text="Validation status"
                  />
                }
              >
                <span className="overview-validation-status">
                  <span className="overview-validation-dot" />

                  Validated
                </span>
              </MetadataListItem>
            </MetadataList>
            ) : (
              <div className="overview-summary-empty">
                {scenarioError || leaderboardError
                  ? "Unable to load this scenario."
                  : "No validated solution is available for this scenario yet."}
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="overview-panel recent-solutions-panel">
        <header className="overview-panel-header">
          <div>
            <p className="overview-panel-eyebrow">
              Latest validated entries
            </p>

            <h2>Recent Solutions</h2>
          </div>

          <span className="recent-solutions-count">
            {tableData.length} solutions
          </span>
        </header>

        <div className="recent-solutions-table">
          <Table
            data={tableData}
            columns={recentSolutionColumns}
            idKey="id"
            hasHover
            plugins={{ navigation: recentSolutionPlugin }}
          />
        </div>
      </section>
    </section>
  );
}

function MetadataLabel({ icon, text }) {
  return (
    <span className="overview-metadata-label">
      <span className="overview-metadata-icon">
        {icon}
      </span>

      <span>{text}</span>
    </span>
  );
}

function ImageIcon(props) {
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
        x="3.75"
        y="4.5"
        width="16.5"
        height="15"
        rx="2"
      />

      <circle
        cx="9"
        cy="9"
        r="1.5"
      />

      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m5.5 17 4.25-4.25 2.75 2.75 2.25-2.25L18.5 17"
      />
    </svg>
  );
}

function TrophyIcon(props) {
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
        d="M8.25 4.5h7.5v3.75A3.75 3.75 0 0 1 12 12a3.75 3.75 0 0 1-3.75-3.75V4.5Z"
      />

      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 6H5.75A2 2 0 0 0 3.75 8v.25A3.75 3.75 0 0 0 7.5 12M15.75 6h2.5a2 2 0 0 1 2 2v.25A3.75 3.75 0 0 1 16.5 12M12 12v4.5M8.5 19.5h7M9.75 16.5h4.5"
      />
    </svg>
  );
}

function TargetIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />

      <path
        strokeLinecap="round"
        d="M12 2.25v3M12 18.75v3M2.25 12h3M18.75 12h3"
      />
    </svg>
  );
}

function ClockIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="8.25" />

      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 7.5V12l3 1.75"
      />
    </svg>
  );
}

function DeltaVIcon(props) {
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
        d="M3.75 17.5 8.25 6.5l4.5 11 4.5-8.25 3 8.25"
      />

      <path
        strokeLinecap="round"
        d="M3 19.5h18"
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
