import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Pages.css";
import "./Leaderboard.css";

import PageHeader from "../components/PageHeader.jsx";
import useScenarios from "../hooks/useScenarios.js";
import { deleteSolution, getLeaderboard, getSolutionDetail } from "../services/api.js";

import { Table, pixel } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";

const detailTabs = [
  ["summary", "Summary"],
  ["final", "Decision Variables"],
];

export default function Leaderboard() {
  const {
    scenarioOptions,
    scenarioError,
    scenariosLoaded,
  } = useScenarios();
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const [scenarioId, setScenarioId] = useState(
    query.get("scenarioId") ?? "SC-001",
  );
  const [selectedSolutionId, setSelectedSolutionId] = useState(
    query.get("solutionId"),
  );
  const [selectedSolution, setSelectedSolution] = useState(null);
  const [selectedTab, setSelectedTab] = useState("summary");
  const [leaderboard, setLeaderboard] = useState({ items: [], total: 0 });
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showRemovePassword, setShowRemovePassword] = useState(false);
  const [removePassword, setRemovePassword] = useState("");
  const detailRef = useRef(null);
  const skipAutoSelectionRef = useRef(false);

  useEffect(() => {
    if (
      scenariosLoaded &&
      scenarioOptions.length > 0 &&
      !scenarioOptions.some((scenario) => scenario.id === scenarioId)
    ) {
      setScenarioId(scenarioOptions[0].id);
      setSelectedSolutionId(null);
    }
  }, [scenarioId, scenarioOptions, scenariosLoaded]);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setError("");

    getLeaderboard(scenarioId, {
      page: "1",
      pageSize: "100",
      ...(search ? { search } : {}),
    })
      .then((result) => {
        if (!isCurrent) return;
        setLeaderboard(result);
        if (!selectedSolutionId && result.items.length > 0 && !skipAutoSelectionRef.current) {
          setSelectedSolutionId(result.items[0].solutionId);
        }
        skipAutoSelectionRef.current = false;
      })
      .catch((requestError) => {
        if (isCurrent) setError(requestError.message);
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [scenarioId, search, selectedSolutionId, refreshVersion]);

  useEffect(() => {
    if (!selectedSolutionId) {
      setSelectedSolution(null);
      return undefined;
    }

    let isCurrent = true;
    setDetailError("");
    getSolutionDetail(selectedSolutionId)
      .then((result) => {
        if (isCurrent) setSelectedSolution(result);
      })
      .catch((requestError) => {
        if (isCurrent) setDetailError(requestError.message);
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedSolutionId]);

  const handleSelectSolution = useCallback((solutionId) => {
    setSelectedSolutionId(solutionId);
    setSelectedTab("summary");
    const params = new URLSearchParams(window.location.search);
    params.set("page", "leaderboard");
    params.set("scenarioId", scenarioId);
    params.set("solutionId", solutionId);
    window.history.replaceState({}, "", `?${params.toString()}`);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [scenarioId]);

  const selectionPlugin = useMemo(
    () => ({
      transformBodyRow(props, item) {
        const isSelected = item.solutionId === selectedSolutionId;
        return {
          ...props,
          htmlProps: {
            ...props.htmlProps,
            className: isSelected ? "leaderboard-row is-selected" : "leaderboard-row",
            tabIndex: 0,
            "aria-selected": isSelected,
            onClick: () => handleSelectSolution(item.solutionId),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleSelectSolution(item.solutionId);
              }
            },
          },
        };
      },
    }),
    [handleSelectSolution, selectedSolutionId],
  );

  const columns = useMemo(
    () => [
      { key: "rank", header: "Rank", width: pixel(70) },
      {
        key: "solutionName",
        header: "Solution",
        width: pixel(260),
        renderCell: (item) => (
          <span className="leaderboard-solution-cell">
            <strong>{item.solutionId}</strong>
            <small>{item.solutionName}</small>
          </span>
        ),
      },
      {
        key: "officialScore",
        header: "Local Score",
        width: pixel(130),
        renderCell: (item) => item.officialScore.toFixed(2),
      },
      {
        key: "finalDistance",
        header: "Distance (km)",
        width: pixel(135),
        renderCell: (item) => item.finalDistance.toFixed(4),
      },
      {
        key: "totalDeltaV",
        header: "Delta-V (km/s)",
        width: pixel(145),
        renderCell: (item) => item.totalDeltaV.toFixed(4),
      },
      {
        key: "totalTime",
        header: "Time (s)",
        width: pixel(125),
        renderCell: (item) => item.totalTime.toFixed(2),
      },
      { key: "burnCount", header: "Burns", width: pixel(75) },
      { key: "status", header: "Status", width: pixel(110) },
    ],
    [],
  );

  function handleScenarioChange(event) {
    setScenarioId(event.target.value);
    setSelectedSolutionId(null);
    setSelectedSolution(null);
  }

  function removeSelectedSolution() {
    if (!selectedSolution || isRemoving) return;
    if (!window.confirm(
      `Remove ${selectedSolution.solutionId} from the Leaderboard? Its Solution and Submission data remain stored for export and Machine Learning.`,
    )) return;
    setRemovePassword("");
    setShowRemovePassword(true);
  }

  async function confirmRemoveSelectedSolution(event) {
    event.preventDefault();
    if (!selectedSolution || isRemoving) return;
    setIsRemoving(true);
    setDetailError("");
    try {
      await deleteSolution(selectedSolution.solutionId, removePassword);
      skipAutoSelectionRef.current = true;
      setShowRemovePassword(false);
      setRemovePassword("");
      setSelectedSolutionId(null);
      setSelectedSolution(null);
      const params = new URLSearchParams(window.location.search);
      params.delete("solutionId");
      window.history.replaceState({}, "", `?${params.toString()}`);
      setRefreshVersion((value) => value + 1);
    } catch (requestError) {
      setDetailError(requestError.message);
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <section className="leaderboard-page">
      <PageHeader
        className="leaderboard-page-header"
        title="Leaderboard"
        description="Rank validated solutions and inspect the complete solution record."
        scenarioId={scenarioId}
        scenarioOptions={scenarioOptions}
        onScenarioChange={handleScenarioChange}
      />

      <section className="leaderboard-panel leaderboard-table-panel">
        <header className="leaderboard-panel-header">
          <div>
            <span className="ranking-mode-label">Locally validated ranking</span>
            <h2>Validated Solutions</h2>
          </div>
          <span className="live-status"><span className="live-status-dot" />{leaderboard.total} solutions</span>
        </header>

        <div className="leaderboard-filters">
          <label>
            <span>Search</span>
            <input value={search} placeholder="Solution ID or name" onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>

        {scenarioError ? <div className="leaderboard-request-state is-error">Scenario list is temporarily unavailable.</div> : null}
        {error ? <div className="leaderboard-request-state is-error">{error}</div> : null}
        {isLoading ? <div className="leaderboard-request-state">Loading leaderboard…</div> : null}

        {!error && !isLoading ? (
          <div className="leaderboard-table-scroll">
            <Table
              data={leaderboard.items}
              columns={columns}
              idKey="solutionId"
              hasHover
              textOverflow="wrap"
              plugins={{ selection: selectionPlugin }}
            />
          </div>
        ) : null}
      </section>

      <section ref={detailRef} className="leaderboard-panel solution-detail-panel">
        <header className="solution-detail-header">
          <div>
            <p className="submission-panel-eyebrow">Selected solution</p>
            <h2>{selectedSolution?.solutionId ?? "Solution Details"}</h2>
          </div>
          {selectedSolution ? (
            <div className="solution-detail-actions">
              <span className="solution-detail-status">Validated</span>
              <button className="solution-remove-button" type="button" onClick={removeSelectedSolution} disabled={isRemoving}>
                {isRemoving ? "Removing…" : "Remove"}
              </button>
            </div>
          ) : null}
        </header>

        {detailError ? <div className="leaderboard-request-state is-error">{detailError}</div> : null}
        {!selectedSolution && !detailError ? (
          <div className="leaderboard-empty-state">Select a solution from the leaderboard to view its details.</div>
        ) : null}

        {selectedSolution ? (
          <>
            <TabList value={selectedTab} onChange={setSelectedTab} layout="fill" hasDivider>
              {detailTabs.map(([value, label]) => <Tab key={value} value={value} label={label} />)}
            </TabList>
            <div className="solution-detail-content">
              <SolutionDetailTab tab={selectedTab} detail={selectedSolution} />
            </div>
          </>
        ) : null}
      </section>

      {showRemovePassword ? (
        <div className="leaderboard-dialog-backdrop" role="presentation">
          <form
            className="leaderboard-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-solution-title"
            onSubmit={confirmRemoveSelectedSolution}
          >
            <p className="submission-panel-eyebrow">Protected action</p>
            <h2 id="remove-solution-title">Enter administration password</h2>
            <p>Remove {selectedSolution?.solutionId} from the Leaderboard. Its dataset record will remain archived.</p>
            <input
              type="password"
              autoComplete="current-password"
              value={removePassword}
              onChange={(event) => setRemovePassword(event.target.value)}
              autoFocus
              required
            />
            {detailError ? <p className="leaderboard-dialog-error">{detailError}</p> : null}
            <div className="leaderboard-dialog-actions">
              <button
                type="button"
                onClick={() => { setShowRemovePassword(false); setRemovePassword(""); }}
                disabled={isRemoving}
              >
                Cancel
              </button>
              <button className="solution-remove-button" type="submit" disabled={isRemoving}>
                {isRemoving ? "Removing…" : "Confirm Remove"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function SolutionDetailTab({ tab, detail }) {
  if (tab === "summary") {
    return (
      <div className="solution-detail-grid">
        <DetailCard title="Summary">
          <MetadataList>
            <MetadataListItem label="Solution ID">{detail.solutionId}</MetadataListItem>
            <MetadataListItem label="Solution name">{detail.solution.name}</MetadataListItem>
            <MetadataListItem label="Scenario">{detail.scenarioId}</MetadataListItem>
            <MetadataListItem label="Submission ID">{detail.submissionId}</MetadataListItem>
            <MetadataListItem label="Status">{detail.status}</MetadataListItem>
          </MetadataList>
        </DetailCard>
        <DetailCard title="Local GMAT Results">
          <MetadataList>
            <MetadataListItem label="Local rank">{detail.officialResults.rank ?? "—"}</MetadataListItem>
            <MetadataListItem label="Local score"><strong className="official-score-value">{detail.officialResults.officialScore.toFixed(2)}</strong></MetadataListItem>
            <MetadataListItem label="Final distance">{detail.officialResults.finalDistance.toFixed(4)} km</MetadataListItem>
            <MetadataListItem label="Total Delta-V">{detail.officialResults.totalDeltaV.toFixed(4)} km/s</MetadataListItem>
            <MetadataListItem label="Total time">{detail.officialResults.totalTime.toFixed(2)} s</MetadataListItem>
            <MetadataListItem label="Burn count">{detail.officialResults.burnCount}</MetadataListItem>
          </MetadataList>
        </DetailCard>
      </div>
    );
  }

  return <DecisionVariables variables={detail.finalDecisionVariables} title="Decision Variables" />;
}

function DecisionVariables({ variables, title }) {
  return (
    <DetailCard title={title}>
      <div className="decision-summary"><span>Initial wait</span><strong>{variables.tWait} s</strong><span>Final coast</span><strong>{variables.finalCoastTime} s</strong></div>
      <div className="burn-list">
        {variables.burns.map((burn, index) => (
          <div key={burn.index ?? index} className="burn-card">
            <strong>Burn {burn.index ?? index + 1}</strong>
            <span>ΔV X: {burn.deltaV[0]} km/s</span>
            <span>ΔV Y: {burn.deltaV[1]} km/s</span>
            <span>ΔV Z: {burn.deltaV[2]} km/s</span>
            {burn.timeToNextBurn != null ? <span>Next burn: {burn.timeToNextBurn} s</span> : null}
          </div>
        ))}
      </div>
    </DetailCard>
  );
}

function DetailCard({ title, children }) {
  return <section className="solution-detail-card"><h3>{title}</h3>{children}</section>;
}
