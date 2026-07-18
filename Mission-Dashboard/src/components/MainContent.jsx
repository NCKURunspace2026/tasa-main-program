import "./MainContent.css";

import Leaderboard from "../pages/Leaderboard.jsx";
import Overview from "../pages/Overview.jsx";
import Submissions from "../pages/Submissions.jsx";
import Settings from "../pages/Settings.jsx";

const pages = {
  overview: Overview,
  submissions: Submissions,
  leaderboard: Leaderboard,
  settings: Settings,
};

export default function MainContent({ currentPage, onNavigate }) {
  const CurrentPageComponent = pages[currentPage] ?? Overview;

  return (
    <main className="main-content">
      <CurrentPageComponent onNavigate={onNavigate} />
    </main>
  );
}
