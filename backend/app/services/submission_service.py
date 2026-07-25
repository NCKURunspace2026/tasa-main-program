from __future__ import annotations

from datetime import datetime, timezone
import math
from uuid import uuid4

from sqlalchemy.orm import Session

from ..models import Solution, Submission
from ..repositories import scenario_repository, solution_repository, submission_repository
from ..schemas.submission import SubmissionInput
from .validation_result_service import recompute_submission_result


class ScenarioNotFoundError(ValueError):
    pass


def _check_local_validation(payload: SubmissionInput, scenario_json: dict) -> None:
    decision = payload.solution.decisionVariables
    validation = payload.clientValidation
    expected_time = decision.tWait + decision.finalCoastTime + sum(
        burn.timeToNextBurn or 0 for burn in decision.burns
    )
    expected_delta_v = sum(math.hypot(*burn.deltaV) for burn in decision.burns)
    if not math.isclose(validation.missionTimeSec, expected_time, rel_tol=1e-9, abs_tol=1e-6):
        raise ValueError("Local GMAT mission time does not match the submitted decision variables.")
    if not math.isclose(
        validation.totalDeltaVKmPerSec, expected_delta_v, rel_tol=1e-9, abs_tol=1e-9
    ):
        raise ValueError("Local GMAT Delta-V does not match the submitted decision variables.")

    limits = scenario_json.get("validation", {})
    checks = (
        (validation.minimumDistanceKm, limits.get("requiredFinalDistanceKm"), "distance"),
        (validation.missionTimeSec, limits.get("maximumMissionTimeSec"), "mission time"),
        (len(decision.burns), limits.get("maximumBurnCount"), "burn count"),
    )
    for value, limit, label in checks:
        if limit is not None and value > float(limit):
            raise ValueError(f"Local GMAT {label} exceeds the Scenario limit.")
    minimum_burns = limits.get("minimumBurnCount")
    if minimum_burns is not None and len(decision.burns) < int(minimum_burns):
        raise ValueError("Local GMAT burn count is below the Scenario minimum.")
    delta_v_per_burn_limit = limits.get("maximumDeltaVPerBurn", limits.get("maximumTotalDeltaV"))
    if delta_v_per_burn_limit is not None and any(
        math.hypot(*burn.deltaV) > float(delta_v_per_burn_limit) for burn in decision.burns
    ):
        raise ValueError("A burn Delta-V exceeds the Scenario per-burn limit.")
    separation = limits.get("minimumBurnSeparationSec")
    if separation is not None and any(
        (burn.timeToNextBurn or 0) < float(separation) for burn in decision.burns[:-1]
    ):
        raise ValueError("A burn interval is below the Scenario minimum separation.")


def create_submission(session: Session, payload: SubmissionInput) -> dict:
    scenario = scenario_repository.find_by_id(session, payload.scenarioId)
    if scenario is None or scenario.status != "active":
        raise ScenarioNotFoundError(f"Active scenario {payload.scenarioId} does not exist.")
    _check_local_validation(payload, scenario.scenario_json)

    solution = Solution(
        id=f"SOL-{uuid4().hex[:12].upper()}",
        scenario_id=payload.scenarioId,
        name=payload.solution.name.strip(),
        decision_variables_json=payload.solution.decisionVariables.model_dump(mode="json"),
    )
    result = recompute_submission_result(
        scenario.scenario_json,
        payload.solution.decisionVariables.model_dump(mode="json"),
        payload.clientValidation.minimumDistanceKm,
        payload.clientValidation.missionTimeSec,
        payload.clientValidation.totalDeltaVKmPerSec,
        0,
        payload.clientValidation.minimumChaserRadiusKm,
        payload.clientValidation.minimumTargetRadiusKm,
    )
    if result.scores is None:
        raise ValueError(result.error_message or "Score was not produced.")
    scores = result.scores

    now = datetime.now(timezone.utc)
    submission = Submission(
        id=f"SUB-{uuid4().hex[:12].upper()}",
        solution_id=solution.id,
        client_validation_json=payload.clientValidation.model_dump(mode="json"),
        status="passed",
        server_min_distance_km=payload.clientValidation.minimumDistanceKm,
        server_min_distance_time_sec=payload.clientValidation.minimumDistanceTimeSec,
        server_min_chaser_radius_km=payload.clientValidation.minimumChaserRadiusKm,
        server_min_target_radius_km=payload.clientValidation.minimumTargetRadiusKm,
        mission_time_sec=payload.clientValidation.missionTimeSec,
        total_delta_v_kmps=payload.clientValidation.totalDeltaVKmPerSec,
        distance_score=scores["distanceScore"],
        time_score=scores["timeScore"],
        delta_v_score=scores["deltaVScore"],
        penalty_score=scores["penaltyScore"],
        total_score=scores["totalScore"],
        validated_at=now,
        updated_at=now,
    )

    try:
        solution_repository.create(session, solution)
        submission_repository.create(session, submission)
        session.commit()
    except Exception:
        session.rollback()
        raise

    return {
        "submissionId": submission.id,
        "solutionId": solution.id,
        "status": "passed",
        "message": "Local GMAT validation passed and the scored Solution was saved on this device.",
        "officialResults": {
            "minimumDistanceKm": submission.server_min_distance_km,
            "minimumDistanceTimeSec": submission.server_min_distance_time_sec,
            "minimumChaserRadiusKm": submission.server_min_chaser_radius_km,
            "minimumTargetRadiusKm": submission.server_min_target_radius_km,
            "missionTimeSec": submission.mission_time_sec,
            "totalDeltaVKmPerSec": submission.total_delta_v_kmps,
            "distanceScore": submission.distance_score,
            "timeScore": submission.time_score,
            "deltaVScore": submission.delta_v_score,
            "penaltyScore": submission.penalty_score,
            "totalScore": submission.total_score,
        },
    }


def get_submission(session: Session, submission_id: str) -> dict | None:
    submission = submission_repository.find_by_id(session, submission_id)
    if submission is None:
        return None
    return {
        "submissionId": submission.id,
        "solutionId": submission.solution_id,
        "status": submission.status,
        "officialResults": {
                "minimumDistanceKm": submission.server_min_distance_km,
                "minimumDistanceTimeSec": submission.server_min_distance_time_sec,
                "minimumChaserRadiusKm": submission.server_min_chaser_radius_km,
                "minimumTargetRadiusKm": submission.server_min_target_radius_km,
                "missionTimeSec": submission.mission_time_sec,
            "totalDeltaVKmPerSec": submission.total_delta_v_kmps,
            "distanceScore": submission.distance_score,
            "timeScore": submission.time_score,
            "deltaVScore": submission.delta_v_score,
            "penaltyScore": submission.penalty_score,
            "totalScore": submission.total_score,
        } if submission.status == "passed" else None,
        "errorMessage": submission.error_message,
        "createdAt": submission.created_at,
        "validatedAt": submission.validated_at,
    }
