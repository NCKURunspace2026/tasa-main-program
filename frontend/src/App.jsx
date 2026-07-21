import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import MainContent from "./components/MainContent";
import "./App.css";

export default function App() {
  const requestedPage = new URLSearchParams(window.location.search).get("page");
  const initialPage = ["submissions", "leaderboard", "settings"].includes(requestedPage)
    ? requestedPage
    : "submissions";
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [gmatConfig, setGmatConfig] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);

  useEffect(() => {
    const runtimeParams = new URLSearchParams(window.location.search);
    const fallbackRuntime = {
      role: runtimeParams.get("desktopRole") === "server" ? "server" : "client",
      localServerAddress: null,
    };
    window.missionDashboardDesktop?.getRuntimeConfig?.()
      .then(setRuntimeConfig)
      .catch(() => setRuntimeConfig(fallbackRuntime));
    if (!window.missionDashboardDesktop?.getGmatConfig) {
      setGmatConfig({ executablePath: "browser-preview" });
      setRuntimeConfig(fallbackRuntime);
      return;
    }
    window.missionDashboardDesktop.getGmatConfig()
      .then(setGmatConfig)
      .catch(() => setGmatConfig({ executablePath: "" }));
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

  if (gmatConfig && !gmatConfig.executablePath) {
    return <GmatFirstRunSetup onComplete={setGmatConfig} />;
  }

  return (
    <div className="app">
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        runtimeRole={runtimeConfig?.role ?? "client"}
      />

      <MainContent
        currentPage={currentPage}
        onNavigate={handleNavigate}
        runtimeConfig={runtimeConfig}
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
        <p className="first-run-help">The central Server address is configured separately in Settings → Connection.</p>
      </form>
    </main>
  );
}
