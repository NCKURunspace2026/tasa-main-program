import { competitionModeLabel, TWO_TEAM_MODE } from "../competitionMode.js";
import "./CompetitionModeBanner.css";

export default function CompetitionModeBanner({ mode, scenarioCount }) {
  const isReserved = mode === TWO_TEAM_MODE;
  return (
    <div className={`competition-mode-banner${isReserved ? " is-reserved" : ""}`} role="status">
      <span>Active competition mode</span>
      <strong>{competitionModeLabel(mode)}</strong>
      <small>
        {isReserved ? "Two spacecraft, two different teams. Rules reserved." : "One team controls the chaser spacecraft."}
        {Number.isInteger(scenarioCount) ? ` ${scenarioCount} matching Scenario${scenarioCount === 1 ? "" : "s"}.` : ""}
      </small>
    </div>
  );
}
