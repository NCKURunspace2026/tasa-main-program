import { useMemo, useRef, useState } from "react";
import "./Pages.css";
import "./Solutions.css";
import PageHeader from "../components/PageHeader.jsx";

import {
  Table,
  useTableSortable,
  useTableSortableState,
  proportional,
  pixel,
} from "@astryxdesign/core/Table";

import {
  TabList,
  Tab,
} from "@astryxdesign/core/TabList";

import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";

/*
  目前先使用前端測試資料。

  未來接後端後，可以移除這些資料，
  改成透過 fetch 或其他 API client 取得。
*/
const scenarioOptions = [
  {
    id: "scenario-1",
    label: "SC-001: LEO Interception",
  },
  {
    id: "scenario-2",
    label: "SC-002: Orbital Rendezvous",
  },
];

const solutionData = [
  {
    id: "SOL-012",
    scenarioId: "scenario-1",
    score: 76.42,
    minDistance: 4.981,
    totalTime: 5079.24,
    deltaV: 0.5392,
    burns: 2,
    feasible: "Yes",
    validated: "Yes",
    generatedAt: "May 16, 2025 14:32:10 UTC",
  },
  {
    id: "SOL-011",
    scenarioId: "scenario-1",
    score: 72.18,
    minDistance: 4.765,
    totalTime: 5100.32,
    deltaV: 0.6123,
    burns: 2,
    feasible: "Yes",
    validated: "Yes",
    generatedAt: "May 16, 2025 13:18:22 UTC",
  },
  {
    id: "SOL-010",
    scenarioId: "scenario-1",
    score: 65.37,
    minDistance: 4.892,
    totalTime: 5400.11,
    deltaV: 0.4967,
    burns: 3,
    feasible: "Yes",
    validated: "Yes",
    generatedAt: "May 16, 2025 12:47:08 UTC",
  },
  {
    id: "SOL-009",
    scenarioId: "scenario-1",
    score: 63.05,
    minDistance: 5.21,
    totalTime: 5678.9,
    deltaV: 0.6725,
    burns: 3,
    feasible: "Yes",
    validated: "No",
    generatedAt: "May 16, 2025 11:56:31 UTC",
  },
  {
    id: "SOL-008",
    scenarioId: "scenario-1",
    score: 60.11,
    minDistance: 5.632,
    totalTime: 5890.44,
    deltaV: 0.7214,
    burns: 4,
    feasible: "Yes",
    validated: "No",
    generatedAt: "May 16, 2025 10:42:17 UTC",
  },
  {
    id: "SOL-021",
    scenarioId: "scenario-2",
    score: 68.94,
    minDistance: 3.942,
    totalTime: 4821.6,
    deltaV: 0.5814,
    burns: 2,
    feasible: "Yes",
    validated: "Yes",
    generatedAt: "May 17, 2025 09:12:46 UTC",
  },
  {
    id: "SOL-020",
    scenarioId: "scenario-2",
    score: 64.28,
    minDistance: 4.126,
    totalTime: 5012.48,
    deltaV: 0.6341,
    burns: 3,
    feasible: "Yes",
    validated: "Yes",
    generatedAt: "May 17, 2025 08:51:20 UTC",
  },
];

const columns = [
  {
    key: "id",
    header: "ID",
    width: proportional(1),
    sortable: true,
  },
  {
    key: "score",
    header: "Score",
    width: pixel(100),
    sortable: true,
  },
  {
    key: "minDistance",
    header: "Min. Distance",
    width: pixel(150),
    sortable: true,
  },
  {
    key: "totalTime",
    header: "Total Time",
    width: pixel(140),
    sortable: true,
  },
  {
    key: "deltaV",
    header: "Delta-V",
    width: pixel(130),
    sortable: true,
  },
  {
    key: "burns",
    header: "Burns",
    width: pixel(80),
    sortable: true,
  },
  {
    key: "feasible",
    header: "Feasible",
    width: pixel(100),
    sortable: true,
  },
  {
    key: "validated",
    header: "Validated",
    width: pixel(110),
    sortable: true,
  },
];

export default function Solutions() {
  const [scenarioId, setScenarioId] = useState("scenario-1");
  const [selectedSolutionId, setSelectedSolutionId] =
    useState("SOL-012");

  const [selectedTab, setSelectedTab] = useState("summary");
  const [tableHeight, setTableHeight] = useState(350);

  const pageRef = useRef(null);
  const headerRef = useRef(null);

  /*
    未來接 API 後，可以把 solutionData 換成：

    const [solutions, setSolutions] = useState([]);

    然後由後端取得資料。
  */
  const scenarioSolutions = useMemo(() => {
    return solutionData.filter(
      (solution) => solution.scenarioId === scenarioId,
    );
  }, [scenarioId]);

  const { sortedData, sortConfig } = useTableSortableState({
    data: scenarioSolutions,
    defaultSort: [
      {
        sortKey: "score",
        direction: "descending",
      },
    ],
  });

  const sortablePlugin = useTableSortable(sortConfig);

  const selectedSolution =
    scenarioSolutions.find(
      (solution) => solution.id === selectedSolutionId,
    ) ?? scenarioSolutions[0];

  function handleScenarioChange(event) {
    const nextScenarioId = event.target.value;

    const nextScenarioSolutions = solutionData.filter(
      (solution) =>
        solution.scenarioId === nextScenarioId,
    );

    setScenarioId(nextScenarioId);

    setSelectedSolutionId(
      nextScenarioSolutions[0]?.id ?? null,
    );

    setSelectedTab("summary");
  }

  function handleResizeStart(event) {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight = tableHeight;

    function handlePointerMove(moveEvent) {
      const pageHeight =
        pageRef.current?.getBoundingClientRect().height ?? 0;

      const headerHeight =
        headerRef.current?.getBoundingClientRect().height ?? 0;

      const minimumTableHeight = 220;
      const minimumDetailsHeight = 320;
      const dividerHeight = 16;
      const headerSpacing = 20;

      const availablePanelHeight =
        pageHeight -
        headerHeight -
        dividerHeight -
        headerSpacing;

      const maximumTableHeight = Math.max(
        minimumTableHeight,
        availablePanelHeight - minimumDetailsHeight,
      );

      const pointerDifference =
        moveEvent.clientY - startY;

      const nextHeight =
        startHeight + pointerDifference;

      const clampedHeight = Math.min(
        Math.max(nextHeight, minimumTableHeight),
        maximumTableHeight,
      );

      setTableHeight(clampedHeight);
    }

    function handlePointerUp() {
      document.body.classList.remove(
        "is-resizing-solutions",
      );

      window.removeEventListener(
        "pointermove",
        handlePointerMove,
      );

      window.removeEventListener(
        "pointerup",
        handlePointerUp,
      );
    }

    document.body.classList.add(
      "is-resizing-solutions",
    );

    window.addEventListener(
      "pointermove",
      handlePointerMove,
    );

    window.addEventListener(
      "pointerup",
      handlePointerUp,
    );
  }

  function handleResizeKeyDown(event) {
    const resizeAmount = event.shiftKey ? 40 : 16;

    if (event.key === "ArrowUp") {
      event.preventDefault();

      setTableHeight((previousHeight) =>
        Math.max(
          220,
          previousHeight - resizeAmount,
        ),
      );
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      setTableHeight(
        (previousHeight) =>
          previousHeight + resizeAmount,
      );
    }
  }

  return (
    <section
      ref={pageRef}
      className="solutions-page"
      style={{
        "--solutions-table-height": `${tableHeight}px`,
      }}
    >
      <PageHeader
        ref={headerRef}
        className="solutions-page-header"
        title="Solutions"
        description="Review validated trajectory solutions and inspect their detailed results."
        scenarioId={scenarioId}
        scenarioOptions={scenarioOptions}
        onScenarioChange={handleScenarioChange}
      />

      <section className="solutions-panel solutions-table-panel">
        <header className="panel-header">
          <div>
            <p className="panel-eyebrow">
              Current scenario
            </p>

            <h2>Solutions</h2>
          </div>

          <span className="solution-count">
            {scenarioSolutions.length} solutions
          </span>
        </header>

        <div className="solutions-table-scroll">
          <Table
            data={sortedData}
            columns={columns}
            idKey="id"
            plugins={{
              sortable: sortablePlugin,
            }}
          />
        </div>
      </section>

      <div
        className="solutions-resizer"
        role="separator"
        aria-label="Resize solution table and detail panels"
        aria-orientation="horizontal"
        aria-valuemin={220}
        aria-valuenow={Math.round(tableHeight)}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
      >
        <span className="solutions-resizer-handle" />
      </div>

      <section className="solutions-panel solution-details-panel">
        <header className="selected-solution-header">
          <div>
            <p className="panel-eyebrow">
              Selected solution
            </p>

            <div className="selected-solution-title">
              <h2>
                {selectedSolution?.id ??
                  "No solution"}
              </h2>

              {selectedSolution && (
                <span
                  className={
                    selectedSolution.validated === "Yes"
                      ? "validation-badge is-valid"
                      : "validation-badge is-pending"
                  }
                >
                  {selectedSolution.validated ===
                  "Yes"
                    ? "Validated"
                    : "Not validated"}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="solution-tabs">
          <TabList
            value={selectedTab}
            onChange={setSelectedTab}
            layout="fill"
            hasDivider
          >
            <Tab
              value="summary"
              label="Summary"
            />

            <Tab
              value="maneuvers"
              label="Maneuvers"
            />

            <Tab
              value="charts"
              label="Charts"
            />

            <Tab
              value="validation"
              label="Validation"
            />
          </TabList>
        </div>

        <div className="solution-tab-content">
          {selectedTab === "summary" && (
            <SolutionSummary
              solution={selectedSolution}
            />
          )}

          {selectedTab === "maneuvers" && (
            <ManeuversPanel
              solution={selectedSolution}
            />
          )}

          {selectedTab === "charts" && (
            <ChartsPanel
              solution={selectedSolution}
            />
          )}

          {selectedTab === "validation" && (
            <ValidationPanel
              solution={selectedSolution}
            />
          )}
        </div>
      </section>
    </section>
  );
}

function SolutionSummary({ solution }) {
  if (!solution) {
    return (
      <div className="solution-empty-state">
        No solution is available for this
        scenario.
      </div>
    );
  }

  return (
    <div className="solution-summary-layout">
      <section className="solution-metadata">
        <h3>Metrics</h3>

        <MetadataList>
          <MetadataListItem label="Score">
            {solution.score.toFixed(2)}
          </MetadataListItem>

          <MetadataListItem label="Min. distance">
            {solution.minDistance.toFixed(3)} km
          </MetadataListItem>

          <MetadataListItem label="Total time">
            {solution.totalTime.toLocaleString()} s
          </MetadataListItem>

          <MetadataListItem label="Delta-V">
            {solution.deltaV.toFixed(4)} km/s
          </MetadataListItem>

          <MetadataListItem label="Burns">
            {solution.burns}
          </MetadataListItem>

          <MetadataListItem label="Feasible">
            {solution.feasible}
          </MetadataListItem>

          <MetadataListItem label="Validated">
            {solution.validated}
          </MetadataListItem>

          <MetadataListItem label="Generated">
            {solution.generatedAt}
          </MetadataListItem>
        </MetadataList>
      </section>

      <section className="trajectory-preview">
        <header className="trajectory-preview-header">
          <h3>Trajectory Preview</h3>
        </header>

        <div className="trajectory-placeholder">
          <p>Trajectory visualization</p>
        </div>
      </section>
    </div>
  );
}

function ManeuversPanel({ solution }) {
  return (
    <div className="detail-placeholder">
      <h3>Maneuvers</h3>

      <p>
        Maneuver details for{" "}
        {solution?.id ?? "this solution"} will
        appear here.
      </p>
    </div>
  );
}

function ChartsPanel({ solution }) {
  return (
    <div className="detail-placeholder">
      <h3>Charts</h3>

      <p>
        Trajectory, distance and objective charts
        for{" "}
        {solution?.id ?? "this solution"} will
        appear here.
      </p>
    </div>
  );
}

function ValidationPanel({ solution }) {
  return (
    <div className="detail-placeholder">
      <h3>Validation</h3>

      <p>
        Validation results for{" "}
        {solution?.id ?? "this solution"} will
        appear here.
      </p>
    </div>
  );
}
