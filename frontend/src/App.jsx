import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import "./App.css";
import { normalizeCompetitionMode } from "./competitionMode.js";

const COMPETITION_MODE_STORAGE_KEY = "mission-dashboard-competition-mode";

function initialCompetitionMode() {
  return normalizeCompetitionMode(window.localStorage.getItem(COMPETITION_MODE_STORAGE_KEY));
}

export default function App() {
  const requestedPage = new URLSearchParams(window.location.search).get("page");
  const initialPage = ["submissions", "leaderboard", "settings"].includes(requestedPage)
    ? requestedPage
    : "submissions";
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [gmatConfig, setGmatConfig] = useState(null);
  const [competitionMode, setCompetitionMode] = useState(initialCompetitionMode);

  useEffect(() => {
    if (!window.missionDashboardDesktop?.getGmatConfig) {
      setGmatConfig({ executablePath: "browser-preview" });
      return;
    }
    window.missionDashboardDesktop.getGmatConfig()
      .then(setGmatConfig)
      .catch(() => setGmatConfig({ executablePath: "" }));
  }, []);

  useEffect(() => {
    function handlePopState() {
      const page = new URLSearchParams(window.location.search).get("page");
      setCurrentPage(["submissions", "leaderboard", "settings"].includes(page) ? page : "submissions");
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function handleNavigate(page, parameters = {}) {
    const searchParams = new URLSearchParams({ page });

    Object.entries(parameters).forEach(([key, value]) => {
      if (value) {
        searchParams.set(key, value);
      }
    });

    window.history.pushState({}, "", `?${searchParams.toString()}`);
    setCurrentPage(page);
  }

  function handleCompetitionModeChange(mode) {
    const normalizedMode = normalizeCompetitionMode(mode);
    window.localStorage.setItem(COMPETITION_MODE_STORAGE_KEY, normalizedMode);
    setCompetitionMode(normalizedMode);
  }

  if (gmatConfig && !gmatConfig.executablePath) {
    return <GmatFirstRunSetup onComplete={setGmatConfig} />;
  }

  return (
    <div className="app">
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        competitionMode={competitionMode}
        onCompetitionModeChange={handleCompetitionModeChange}
      />

      <MainContent
        currentPage={currentPage}
        onNavigate={handleNavigate}
        competitionMode={competitionMode}
      />
    </div>
  );
}

function GmatFirstRunSetup({ onComplete }) {
  const [installationPath, setInstallationPath] = useState("");
  const [message, setMessage] = useState("");

  async function browse() {
    const config = await window.missionDashboardDesktop.selectGmatInstallation();
    if (config.gmatInstallationPath) setInstallationPath(config.gmatInstallationPath);
  }

  async function save(event) {
    event.preventDefault();
    if (!installationPath.trim()) {
      setMessage("Paste a GMAT installation or api folder path, or select it with Browse.");
      return;
    }
    const config = await window.missionDashboardDesktop.saveGmatConfig({
      gmatInstallationPath: installationPath.trim(),
      timeoutMs: 120000,
      keepTemporaryFiles: false,
    });
    onComplete(config);
  }

  return (
    <main className="first-run-setup">
      <form className="first-run-card" onSubmit={save}>
        <p className="eyebrow">First-time setup</p>
        <h1>Choose local GMAT</h1>
        <p>Each Client validates trajectories with its own GMAT installation. Select the local GMAT installation folder or its <code>api</code> folder; this path is saved only on this computer.</p>
        <label htmlFor="gmat-installation-path">GMAT installation / API folder</label>
        <div className="first-run-input-action">
          <input id="gmat-installation-path" value={installationPath} onChange={(event) => setInstallationPath(event.target.value)} placeholder="…/GMAT R2026a/api" autoFocus />
          <button type="button" onClick={browse}>Browse…</button>
        </div>
        {message ? <p className="first-run-message">{message}</p> : null}
        <button className="first-run-primary" type="submit">Save and continue</button>
        <p className="first-run-help">Submissions are saved in this device's local SQLite database first.</p>
      </form>
    </main>
  );
}
