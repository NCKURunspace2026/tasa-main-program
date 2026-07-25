from __future__ import annotations

from datetime import datetime, timezone
import math

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Scenario, Solution, Submission, SyncEvent
from ..models.entities import utc_now
from ..repositories.solution_repository import find_by_id
from ..schemas.submission import SolutionRevalidationInput
from .validation_result_service import recompute_submission_result


def get_solution_detail(
    session: Session,
    solution_id: str,
    include_deleted: bool = False,
) -> dict | None:
    solution = find_by_id(session, solution_id, include_deleted=include_deleted)
    if solution is None:
        return None
    submission = session.scalar(
        select(Submission).where(Submission.solution_id == solution.id)
    )
    if submission is None:
        return None
    rank = None
    if submission.status == "passed":
        rank = 1 + session.scalar(
            select(func.count(Submission.id))
            .join(Solution, Solution.id == Submission.solution_id)
            .where(
                Solution.scenario_id == solution.scenario_id,
                Solution.deleted_at.is_(None),
                Submission.status == "passed",
                Submission.total_score > submission.total_score,
            )
        )
    return {
        "solutionId": solution.id,
        "submissionId": submission.id,
        "scenarioId": solution.scenario_id,
        "solution": {"name": solution.name},
        "deletedAt": solution.deleted_at.isoformat() if solution.deleted_at else None,
        "finalDecisionVariables": solution.decision_variables_json,
        "status": submission.status,
        "officialResults": {
            "rank": rank,
            "officialScore": submission.total_score,
            "minimumDistance": submission.server_min_distance_km,
            "minimumDistanceTime": submission.server_min_distance_time_sec,
            "totalDeltaV": submission.total_delta_v_kmps,
            "totalTime": submission.mission_time_sec,
            "burnCount": len(solution.decision_variables_json.get("burns", [])),
            "distanceScore": submission.distance_score,
            "timeScore": submission.time_score,
            "deltaVScore": submission.delta_v_score,
            "penaltyScore": submission.penalty_score,
        },
    }


def set_solution_deleted(
    session: Session,
    solution_id: str,
    deleted: bool,
) -> dict | None:
    solution = find_by_id(session, solution_id, include_deleted=True)
    if solution is None:
        return None
    solution.deleted_at = datetime.now(timezone.utc) if deleted else None
    solution.updated_at = utc_now()
    session.commit()
    return {
        "solutionId": solution.id,
        "deletedAt": solution.deleted_at.isoformat() if solution.deleted_at else None,
    }


def update_solution_validation(
    session: Session,
    solution_id: str,
    payload: SolutionRevalidationInput,
) -> dict | None:
    solution = find_by_id(session, solution_id)
    if solution is None:
        return None
    submission = session.scalar(
        select(Submission).where(Submission.solution_id == solution.id)
    )
    if submission is None:
        return None
    scenario = session.get(Scenario, solution.scenario_id)
    if scenario is None:
        raise ValueError("Solution Scenario does not exist.")
    expected_time = (
        payload.decisionVariables.tWait
        + payload.decisionVariables.finalCoastTime
        + sum(burn.timeToNextBurn or 0 for burn in payload.decisionVariables.burns)
    )
    expected_delta_v = sum(math.hypot(*burn.deltaV) for burn in payload.decisionVariables.burns)
    if not math.isclose(
        payload.clientValidation.missionTimeSec,
        expected_time,
        rel_tol=1e-9,
        abs_tol=1e-6,
    ):
        raise ValueError("Local GMAT mission time does not match the repaired decision variables.")
    if not math.isclose(
        payload.clientValidation.totalDeltaVKmPerSec,
        expected_delta_v,
        rel_tol=1e-9,
        abs_tol=1e-9,
    ):
        raise ValueError("Local GMAT Delta-V does not match the repaired decision variables.")
    result = recompute_submission_result(
        scenario.scenario_json,
        payload.decisionVariables.model_dump(mode="json"),
        payload.clientValidation.minimumDistanceKm,
        payload.clientValidation.missionTimeSec,
        payload.clientValidation.totalDeltaVKmPerSec,
        0,
    )
    if result.scores is None:
        raise ValueError(result.error_message or "Score was not produced.")
    scores = result.scores

    now = utc_now()
    solution.decision_variables_json = payload.decisionVariables.model_dump(mode="json")
    solution.updated_at = now
    submission.client_validation_json = payload.clientValidation.model_dump(mode="json")
    submission.status = "passed"
    submission.server_min_distance_km = payload.clientValidation.minimumDistanceKm
    submission.server_min_distance_time_sec = payload.clientValidation.minimumDistanceTimeSec
    submission.mission_time_sec = payload.clientValidation.missionTimeSec
    submission.total_delta_v_kmps = payload.clientValidation.totalDeltaVKmPerSec
    submission.distance_score = scores["distanceScore"]
    submission.time_score = scores["timeScore"]
    submission.delta_v_score = scores["deltaVScore"]
    submission.penalty_score = scores["penaltyScore"]
    submission.total_score = scores["totalScore"]
    submission.error_message = None
    submission.updated_at = now
    submission.validated_at = now
    session.add(SyncEvent(record_type="solution", record_id=solution.id))
    session.commit()
    return get_solution_detail(session, solution.id)
