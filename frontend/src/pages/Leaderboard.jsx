import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Pages.css";
import "./Leaderboard.css";

import PageHeader from "../components/PageHeader.jsx";
import CompetitionModeBanner from "../components/CompetitionModeBanner.jsx";
import useScenarios from "../hooks/useScenarios.js";
import { scenarioCompetitionMode, TWO_TEAM_MODE } from "../competitionMode.js";
import { deleteSolution, downloadDataExport, getLeaderboard, getSolutionDetail, renameSolution, revalidateSolution, runDataSync } from "../services/api.js";

import { Table, pixel } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";

const detailTabs = [
  ["summary", "Summary"],
  ["final", "Decision Variables"],
];

export default function Leaderboard({ competitionMode }) {
  const {
    scenarioOptions: allScenarioOptions,
    scenarioError,
    scenariosLoaded,
  } = useScenarios();
  const scenarioOptions = useMemo(
    () => allScenarioOptions.filter((scenario) => scenarioCompetitionMode(scenario) === competitionMode),
    [allScenarioOptions, competitionMode],
  );
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
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [detailRequestVersion, setDetailRequestVersion] = useState(0);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [isDownloadingScript, setIsDownloadingScript] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [solutionName, setSolutionName] = useState("");
  const [showRemoveConfirmation, setShowRemoveConfirmation] = useState(false);
  const [removeConfirmation, setRemoveConfirmation] = useState("");
  const removeConfirmationRef = useRef(null);
  const solutionNameRef = useRef(null);
  const detailRef = useRef(null);
  const skipAutoSelectionRef = useRef(false);

  useEffect(() => {
    if (scenariosLoaded && scenarioOptions.length === 0) {
      setScenarioId("");
      setSelectedSolutionId(null);
      setSelectedSolution(null);
      return;
    }
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
    if (!scenarioId) {
      setLeaderboard({ items: [], total: 0 });
      setIsLoading(false);
      setError("");
      return undefined;
    }
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
        const skipAutoSelection = skipAutoSelectionRef.current;
        skipAutoSelectionRef.current = false;
        if (!skipAutoSelection) {
          setSelectedSolutionId((currentSolutionId) => (
            result.items.some((item) => item.solutionId === currentSolutionId)
            ? currentSolutionId
            : result.items[0]?.solutionId ?? null
          ));
        }
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
  }, [scenarioId, search, refreshVersion]);

  useEffect(() => {
    if (!selectedSolutionId) {
      setSelectedSolution(null);
      setIsDetailLoading(false);
      return undefined;
    }

    let isCurrent = true;
    setSelectedSolution(null);
    setIsDetailLoading(true);
    setDetailError("");
    getSolutionDetail(selectedSolutionId)
      .then((result) => {
        if (isCurrent) setSelectedSolution(result);
      })
      .catch((requestError) => {
        if (isCurrent) setDetailError(requestError.message);
      })
      .finally(() => {
        if (isCurrent) setIsDetailLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [detailRequestVersion, refreshVersion, selectedSolutionId]);

  const handleSelectSolution = useCallback((solutionId) => {
    setSelectedSolution(null);
    if (solutionId === selectedSolutionId) {
      setDetailRequestVersion((value) => value + 1);
    } else {
      setSelectedSolutionId(solutionId);
    }
    setSelectedTab("summary");
    const params = new URLSearchParams(window.location.search);
    params.set("page", "leaderboard");
    params.set("scenarioId", scenarioId);
    params.set("solutionId", solutionId);
    window.history.replaceState({}, "", `?${params.toString()}`);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [scenarioId, selectedSolutionId]);

  const handleTableInteraction = useCallback((event) => {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-solution-id]");
    if (!row) return;
    if (event.type === "keydown") event.preventDefault();
    handleSelectSolution(row.dataset.solutionId);
  }, [handleSelectSolution]);

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
            "data-solution-id": item.solutionId,
          },
        };
      },
    }),
    [selectedSolutionId],
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
        renderCell: (item) => item.officialScore == null ? "—" : item.officialScore.toFixed(2),
      },
      {
        key: "minimumDistance",
        header: "Closest distance (km)",
        width: pixel(135),
        renderCell: (item) => item.minimumDistance.toFixed(4),
      },
      {
        key: "totalDeltaV",
        header: "Delta-V (km/s)",
        width: pixel(145),
        renderCell: (item) => item.totalDeltaV.toFixed(4),
      },
      {
        key: "minimumDistanceTime",
        header: "Completion time (s)",
        width: pixel(125),
        renderCell: (item) => item.minimumDistanceTime == null ? "—" : item.minimumDistanceTime.toFixed(2),
      },
      { key: "burnCount", header: "Burns", width: pixel(75) },
      { key: "status", header: "Status", width: pixel(110) },
    ],
    [],
  );

  function handleScenarioChange(event) {
    const nextScenarioId = event.target.value;
    skipAutoSelectionRef.current = false;
    setScenarioId(nextScenarioId);
    setSearch("");
    setLeaderboard({ items: [], total: 0 });
    setSelectedSolutionId(null);
    setSelectedSolution(null);
    setDetailError("");
    const params = new URLSearchParams(window.location.search);
    params.set("page", "leaderboard");
    params.set("scenarioId", nextScenarioId);
    params.delete("solutionId");
    window.history.replaceState({}, "", `?${params.toString()}`);
  }

  function removeSelectedSolution() {
    if (!selectedSolution || isRemoving) return;
    setDetailError("");
    setRemoveConfirmation("");
    setShowRemoveConfirmation(true);
  }

  useEffect(() => {
    if (showRemoveConfirmation) {
      window.setTimeout(() => removeConfirmationRef.current?.focus(), 0);
    }
  }, [showRemoveConfirmation]);

  useEffect(() => {
    if (showRenameDialog) {
      window.setTimeout(() => solutionNameRef.current?.focus(), 0);
    }
  }, [showRenameDialog]);

  function editSelectedSolutionName() {
    if (!selectedSolution || isRenaming) return;
    setDetailError("");
    setSolutionName(selectedSolution.solution.name);
    setShowRenameDialog(true);
  }

  async function confirmSolutionRename(event) {
    event.preventDefault();
    if (!selectedSolution || isRenaming) return;
    setIsRenaming(true);
    setDetailError("");
    try {
      const renamed = await renameSolution(selectedSolution.solutionId, solutionName);
      setSelectedSolution(renamed);
      setShowRenameDialog(false);
      setSolutionName("");
      setRefreshVersion((value) => value + 1);
      runDataSync().catch(() => {});
    } catch (requestError) {
      setDetailError(requestError.message);
    } finally {
      setIsRenaming(false);
    }
  }

  async function confirmRemoveSelectedSolution(event) {
    event.preventDefault();
    if (!selectedSolution || isRemoving || removeConfirmation !== "Delete") return;
    setIsRemoving(true);
    setDetailError("");
    try {
      await deleteSolution(selectedSolution.solutionId);
      skipAutoSelectionRef.current = true;
      setShowRemoveConfirmation(false);
      setRemoveConfirmation("");
      setSelectedSolutionId(null);
      setSelectedSolution(null);
      const params = new URLSearchParams(window.location.search);
      params.delete("solutionId");
      window.history.replaceState({}, "", `?${params.toString()}`);
      setRefreshVersion((value) => value + 1);
      runDataSync().catch(() => {});
    } catch (requestError) {
      setDetailError(requestError.message);
    } finally {
      setIsRemoving(false);
    }
  }

  async function repairSelectedSolution() {
    if (!selectedSolution || isRepairing) return;
    setIsRepairing(true);
    setDetailError("");
    try {
      const scenario = scenarioOptions.find((item) => item.id === selectedSolution.scenarioId);
      if (scenario?.scenarioJson?.competitionMode === "two-team-pursuit") {
        throw new Error("Two-team pursuit repair is reserved until its ruleset is defined.");
      }
      if (!window.missionDashboardDesktop?.validateWithLocalGmat) {
        throw new Error("Repair requires the Electron Client app with local GMAT configured.");
      }
      if (!scenario?.scenarioJson || Object.keys(scenario.scenarioJson).length === 0) {
        throw new Error("The selected Scenario has no simulation definition.");
      }
      const localResult = await window.missionDashboardDesktop.validateWithLocalGmat({
        scenario,
        finalDecisionVariables: selectedSolution.finalDecisionVariables,
      });
      if (localResult.status !== "validated") {
        throw new Error("Local GMAT repair did not pass validation.");
      }
      const repaired = await revalidateSolution(selectedSolution.solutionId, {
        decisionVariables: localResult.adjustedDecisionVariables ?? selectedSolution.finalDecisionVariables,
        clientValidation: {
          passed: true,
          provider: localResult.provider,
          minimumDistanceKm: localResult.minimumDistance,
          minimumDistanceTimeSec: localResult.firstRequiredDistanceTime,
          minimumChaserRadiusKm: localResult.artifacts?.minimumChaserRadiusKm,
          minimumTargetRadiusKm: localResult.artifacts?.minimumTargetRadiusKm,
          missionTimeSec: localResult.totalTime,
          totalDeltaVKmPerSec: localResult.totalDeltaV,
        },
      });
      setSelectedSolution(repaired);
      setRefreshVersion((value) => value + 1);
      runDataSync().catch(() => {});
    } catch (requestError) {
      setDetailError(requestError.message);
    } finally {
      setIsRepairing(false);
    }
  }

  async function downloadSelectedSolutionScript() {
    if (!selectedSolution || isDownloadingScript) return;
    const scenario = scenarioOptions.find((item) => item.id === selectedSolution.scenarioId);
    if (scenario?.scenarioJson?.competitionMode === "two-team-pursuit") {
      setDetailError("Two-team pursuit GMAT export is reserved until its ruleset is defined.");
      return;
    }
    if (!scenario?.scenarioJson || Object.keys(scenario.scenarioJson).length === 0) {
      setDetailError("The selected Scenario has no simulation definition.");
      return;
    }
    if (!window.missionDashboardDesktop?.downloadGmatScript) {
      setDetailError("GMAT script downloads require the Electron Client app.");
      return;
    }
    setIsDownloadingScript(true);
    setDetailError("");
    try {
      await window.missionDashboardDesktop.downloadGmatScript({
        scenarioId: selectedSolution.scenarioId,
        solutionId: selectedSolution.solutionId,
        submissionId: selectedSolution.submissionId,
        scenario,
        finalDecisionVariables: selectedSolution.finalDecisionVariables,
      });
    } catch (requestError) {
      setDetailError(requestError.message);
    } finally {
      setIsDownloadingScript(false);
    }
  }

  async function exportMachineLearningData() {
    if (isExporting) return;
    setIsExporting(true);
    setError("");
    try {
      await downloadDataExport("jsonl", { scope: "ml", scenarioId });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsExporting(false);
    }
  }

  const isTwoTeamPursuit = competitionMode === TWO_TEAM_MODE;

  return (
    <section className="leaderboard-page">
      <PageHeader
        className="leaderboard-page-header"
        title="Leaderboard"
        description="Rank validated solutions and inspect the complete solution record."
        scenarioId={scenarioId}
        scenarioOptions={scenarioOptions}
        onScenarioChange={handleScenarioChange}
      >
        <button
          className="solution-download-button"
          type="button"
          title="Download selected Scenario ML dataset"
          aria-label="Download selected Scenario ML dataset"
          disabled={isExporting || !scenarioId}
          onClick={exportMachineLearningData}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2" />
          </svg>
        </button>
      </PageHeader>

      <CompetitionModeBanner mode={competitionMode} scenarioCount={scenarioOptions.length} />

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
          <div className="leaderboard-table-scroll" onClick={handleTableInteraction} onKeyDown={handleTableInteraction}>
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
              <span className={`solution-detail-status${selectedSolution.status === "needs_repair" ? " is-warning" : ""}`}>
                {selectedSolution.status === "needs_repair" ? "Needs repair" : "Validated"}
              </span>
              <button
                className="solution-download-button"
                type="button"
                title="Download GMAT validation script"
                aria-label="Download GMAT validation script"
                onClick={downloadSelectedSolutionScript}
                disabled={isTwoTeamPursuit || isDownloadingScript || isRenaming || isRepairing || isRemoving}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2" />
                </svg>
              </button>
              <button className="solution-rename-button" type="button" onClick={editSelectedSolutionName} disabled={isRenaming || isRepairing || isRemoving}>
                Rename
              </button>
              <button className="solution-repair-button" type="button" onClick={repairSelectedSolution} disabled={isTwoTeamPursuit || isRepairing || isRemoving}>
                {isRepairing ? "Repairing..." : "Repair GMAT metrics"}
              </button>
              <button className="solution-remove-button" type="button" onClick={removeSelectedSolution} disabled={isRemoving}>
                {isRemoving ? "Removing…" : "Remove"}
              </button>
            </div>
          ) : null}
        </header>

        {detailError ? <div className="leaderboard-request-state is-error">{detailError}</div> : null}
        {isDetailLoading ? <div className="leaderboard-empty-state">Loading solution details…</div> : null}
        {!selectedSolution && !detailError && !isDetailLoading ? (
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

      {showRenameDialog ? (
        <div className="leaderboard-dialog-backdrop" role="presentation">
          <form
            className="leaderboard-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-solution-title"
            onSubmit={confirmSolutionRename}
          >
            <p className="submission-panel-eyebrow">Solution metadata</p>
            <h2 id="rename-solution-title">Rename solution</h2>
            <p>Only the display name can be changed. Decision variables and validated GMAT results remain locked.</p>
            <label className="leaderboard-name-field">
              <span>Solution name</span>
              <input
                ref={solutionNameRef}
                type="text"
                maxLength={180}
                value={solutionName}
                onChange={(event) => setSolutionName(event.target.value)}
                placeholder="Enter solution name"
                required
              />
            </label>
            {detailError ? <p className="leaderboard-dialog-error">{detailError}</p> : null}
            <div className="leaderboard-dialog-actions">
              <button
                type="button"
                onClick={() => { setShowRenameDialog(false); setSolutionName(""); setDetailError(""); }}
                disabled={isRenaming}
              >
                Cancel
              </button>
              <button className="solution-rename-button" type="submit" disabled={isRenaming || !solutionName.trim()}>
                {isRenaming ? "Saving…" : "Save name"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showRemoveConfirmation ? (
        <div className="leaderboard-dialog-backdrop" role="presentation">
          <form
            className="leaderboard-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-solution-title"
            onSubmit={confirmRemoveSelectedSolution}
          >
            <p className="submission-panel-eyebrow">Protected action</p>
            <h2 id="remove-solution-title">Confirm removal</h2>
            <p>Type <strong>Delete</strong> to remove {selectedSolution?.solutionId} from the Leaderboard. Its dataset record remains archived.</p>
            <label className="leaderboard-name-field">
              <span>Confirmation</span>
              <input
                ref={removeConfirmationRef}
                type="text"
                autoComplete="off"
                value={removeConfirmation}
                onChange={(event) => setRemoveConfirmation(event.target.value)}
                placeholder="Delete"
                required
              />
            </label>
            {detailError ? <p className="leaderboard-dialog-error">{detailError}</p> : null}
            <div className="leaderboard-dialog-actions">
              <button
                type="button"
                onClick={() => { setShowRemoveConfirmation(false); setRemoveConfirmation(""); }}
                disabled={isRemoving}
              >
                Cancel
              </button>
              <button className="solution-remove-button" type="submit" disabled={isRemoving || removeConfirmation !== "Delete"}>
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
            <MetadataListItem label="Local score"><strong className="official-score-value">{detail.officialResults.officialScore == null ? "—" : detail.officialResults.officialScore.toFixed(2)}</strong></MetadataListItem>
            <MetadataListItem label="Closest distance">{detail.officialResults.minimumDistance.toFixed(4)} km</MetadataListItem>
            <MetadataListItem label="Completion time">{detail.officialResults.minimumDistanceTime == null ? "—" : `${detail.officialResults.minimumDistanceTime.toFixed(6)} s`}</MetadataListItem>
            <MetadataListItem label="Total Delta-V">{detail.officialResults.totalDeltaV.toFixed(4)} km/s</MetadataListItem>
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
