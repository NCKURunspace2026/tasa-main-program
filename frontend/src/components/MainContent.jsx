import "./MainContent.css";

import Leaderboard from "../pages/Leaderboard.jsx";
import Submissions from "../pages/Submissions.jsx";
import Settings from "../pages/Settings.jsx";

const pages = {
  submissions: Submissions,
  leaderboard: Leaderboard,
  settings: Settings,
};

export default function MainContent({ currentPage, onNavigate, runtimeConfig }) {
  const CurrentPageComponent = pages[currentPage] ?? Submissions;

  return (
    <main className="main-content">
      <CurrentPageComponent onNavigate={onNavigate} runtimeConfig={runtimeConfig} />
    </main>
  );
}
