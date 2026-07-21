from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Solution, Submission
from ..repositories.solution_repository import find_by_id


def get_solution_detail(session: Session, solution_id: str) -> dict | None:
    solution = find_by_id(session, solution_id)
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
                Submission.status == "passed",
                Submission.total_score > submission.total_score,
            )
        )
    return {
        "solutionId": solution.id,
        "submissionId": submission.id,
        "scenarioId": solution.scenario_id,
        "solution": {"name": solution.name},
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
