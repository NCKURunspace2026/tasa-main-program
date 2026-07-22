from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Solution, Submission
from ..repositories.solution_repository import find_all, find_by_id


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
            "finalDistance": submission.server_min_distance_km,
            "totalDeltaV": submission.total_delta_v_kmps,
            "totalTime": submission.mission_time_sec,
            "burnCount": len(solution.decision_variables_json.get("burns", [])),
            "distanceScore": submission.distance_score,
            "timeScore": submission.time_score,
            "deltaVScore": submission.delta_v_score,
            "penaltyScore": submission.penalty_score,
        },
    }


def list_solutions(
    session: Session,
    scenario_id: str | None = None,
    include_deleted: bool = False,
) -> list[dict]:
    items = []
    for solution in find_all(
        session,
        scenario_id=scenario_id,
        include_deleted=include_deleted,
    ):
        submission = session.scalar(
            select(Submission).where(Submission.solution_id == solution.id)
        )
        items.append({
            "solutionId": solution.id,
            "scenarioId": solution.scenario_id,
            "name": solution.name,
            "status": submission.status if submission else None,
            "officialScore": submission.total_score if submission else None,
            "createdAt": solution.created_at.isoformat() if solution.created_at else None,
            "deletedAt": solution.deleted_at.isoformat() if solution.deleted_at else None,
        })
    return items


def set_solution_deleted(
    session: Session,
    solution_id: str,
    deleted: bool,
) -> dict | None:
    solution = find_by_id(session, solution_id, include_deleted=True)
    if solution is None:
        return None
    solution.deleted_at = datetime.now(timezone.utc) if deleted else None
    session.commit()
    return {
        "solutionId": solution.id,
        "deletedAt": solution.deleted_at.isoformat() if solution.deleted_at else None,
    }
