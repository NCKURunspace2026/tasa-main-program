from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Scenario, Solution, Submission, SyncEvent
from .score_service import InvalidScoreConfigError, calculate_score


@dataclass(frozen=True)
class RecomputedSubmission:
    status: str
    scores: dict | None
    error_message: str | None


def recompute_submission_result(
    scenario_json: dict,
    decision_variables: dict,
    minimum_distance_km: float | None,
    mission_time_sec: float | None,
    total_delta_v_kmps: float | None,
    penalty_score: float = 0,
    minimum_chaser_radius_km: float | None = None,
    minimum_target_radius_km: float | None = None,
) -> RecomputedSubmission:
    error_message = _validation_error(
        scenario_json,
        decision_variables,
        minimum_distance_km,
        mission_time_sec,
        total_delta_v_kmps,
        minimum_chaser_radius_km,
        minimum_target_radius_km,
    )
    if error_message is not None:
        return RecomputedSubmission("failed", None, error_message)
    try:
        scores = calculate_score(
            scenario_json.get("scoreConfig", {}),
            float(minimum_distance_km),
            float(mission_time_sec),
            float(total_delta_v_kmps),
            penalty_score,
        )
    except InvalidScoreConfigError as error:
        return RecomputedSubmission("failed", None, f"Score was not produced: {error}")
    return RecomputedSubmission("passed", scores, None)


def apply_recomputed_submission(
    submission: Submission,
    result: RecomputedSubmission,
    *,
    updated_at,
) -> bool:
    before = (
        submission.status,
        submission.distance_score,
        submission.time_score,
        submission.delta_v_score,
        submission.penalty_score,
        submission.total_score,
        submission.error_message,
    )
    submission.status = result.status
    submission.error_message = result.error_message
    if result.scores is None:
        submission.distance_score = None
        submission.time_score = None
        submission.delta_v_score = None
        submission.penalty_score = None
        submission.total_score = None
    else:
        submission.distance_score = result.scores["distanceScore"]
        submission.time_score = result.scores["timeScore"]
        submission.delta_v_score = result.scores["deltaVScore"]
        submission.penalty_score = result.scores["penaltyScore"]
        submission.total_score = result.scores["totalScore"]
    after = (
        submission.status,
        submission.distance_score,
        submission.time_score,
        submission.delta_v_score,
        submission.penalty_score,
        submission.total_score,
        submission.error_message,
    )
    changed = before != after
    if changed:
        submission.updated_at = updated_at
    return changed


def recompute_scenario_submissions(
    session: Session,
    scenario: Scenario,
    *,
    updated_at,
    emit_sync_events: bool = True,
) -> int:
    rows = session.execute(
        select(Submission, Solution)
        .join(Solution, Solution.id == Submission.solution_id)
        .where(Solution.scenario_id == scenario.id)
    ).all()
    changed = 0
    for submission, solution in rows:
        result = recompute_submission_result(
            scenario.scenario_json,
            solution.decision_variables_json,
            submission.server_min_distance_km,
            submission.mission_time_sec,
            submission.total_delta_v_kmps,
            float(submission.penalty_score or 0),
            submission.server_min_chaser_radius_km,
            submission.server_min_target_radius_km,
        )
        if apply_recomputed_submission(submission, result, updated_at=updated_at):
            changed += 1
            if emit_sync_events:
                session.add(SyncEvent(record_type="solution", record_id=solution.id))
    return changed


def _validation_error(
    scenario_json: dict,
    decision_variables: dict,
    minimum_distance_km: float | None,
    mission_time_sec: float | None,
    total_delta_v_kmps: float | None,
    minimum_chaser_radius_km: float | None,
    minimum_target_radius_km: float | None,
) -> str | None:
    metrics = (minimum_distance_km, mission_time_sec, total_delta_v_kmps)
    if any(value is None or not math.isfinite(float(value)) for value in metrics):
        return "Stored GMAT metrics are incomplete or invalid. Re-run GMAT repair."
    limits = scenario_json.get("validation", {})
    if _exceeds(minimum_distance_km, limits.get("requiredFinalDistanceKm")):
        return "Closest approach is outside the Scenario required distance."
    if _exceeds(mission_time_sec, limits.get("maximumMissionTimeSec")):
        return "Mission time exceeds the Scenario limit."

    minimum_radius = limits.get("minimumSpacecraftRadiusKm")
    if minimum_radius is None and _central_body(scenario_json) == "Earth":
        minimum_radius = 6378.1363
    if minimum_radius is not None:
        if minimum_chaser_radius_km is None or minimum_target_radius_km is None:
            return "Stored GMAT spacecraft radius metrics are missing. Re-run GMAT repair."
        if not math.isfinite(float(minimum_chaser_radius_km)) or not math.isfinite(float(minimum_target_radius_km)):
            return "Stored GMAT spacecraft radius metrics are invalid. Re-run GMAT repair."
        if float(minimum_chaser_radius_km) < float(minimum_radius):
            return "Chaser trajectory intersects the central body."
        if float(minimum_target_radius_km) < float(minimum_radius):
            return "Target trajectory intersects the central body."

    burns = decision_variables.get("burns", []) if isinstance(decision_variables, dict) else []
    maximum_burns = limits.get("maximumBurnCount")
    if maximum_burns is not None and len(burns) > int(maximum_burns):
        return "Burn count exceeds the Scenario maximum."
    minimum_burns = limits.get("minimumBurnCount")
    if minimum_burns is not None and len(burns) < int(minimum_burns):
        return "Burn count is below the Scenario minimum."

    delta_v_per_burn_limit = limits.get("maximumDeltaVPerBurn", limits.get("maximumTotalDeltaV"))
    if delta_v_per_burn_limit is not None and any(
        math.hypot(*burn.get("deltaV", ())) > float(delta_v_per_burn_limit) for burn in burns
    ):
        return "A burn Delta-V exceeds the Scenario per-burn limit."
    separation = limits.get("minimumBurnSeparationSec")
    if separation is not None and any(
        float(burn.get("timeToNextBurn") or 0) < float(separation) for burn in burns[:-1]
    ):
        return "A burn interval is below the Scenario minimum separation."
    return None


def _exceeds(value: float | None, limit) -> bool:
    return limit is not None and float(value) > float(limit)


def _central_body(scenario_json: dict) -> str | None:
    force_model = scenario_json.get("forceModel", {}) if isinstance(scenario_json, dict) else {}
    return force_model.get("centralBody") or scenario_json.get("centralBody")
