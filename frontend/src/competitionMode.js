export const SINGLE_TEAM_MODE = "single-team-interception";
export const TWO_TEAM_MODE = "two-team-pursuit";

export function normalizeCompetitionMode(mode) {
  return mode === TWO_TEAM_MODE ? TWO_TEAM_MODE : SINGLE_TEAM_MODE;
}

export function scenarioCompetitionMode(scenario) {
  return normalizeCompetitionMode(scenario?.scenarioJson?.competitionMode ?? scenario?.competitionMode);
}

export function competitionModeLabel(mode) {
  return normalizeCompetitionMode(mode) === TWO_TEAM_MODE
    ? "Two-team pursuit"
    : "Single-team interception";
}
