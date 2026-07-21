from __future__ import annotations

from uuid import uuid4

from sqlalchemy.orm import Session

from ..models import Solution, Submission
from ..repositories import scenario_repository, solution_repository, submission_repository
from ..schemas.submission import SubmissionInput


class ScenarioNotFoundError(ValueError):
    pass


def create_submission(session: Session, payload: SubmissionInput) -> dict:
    scenario = scenario_repository.find_by_id(session, payload.scenarioId)
    if scenario is None or scenario.status != "active":
        raise ScenarioNotFoundError(f"Active scenario {payload.scenarioId} does not exist.")

    solution = Solution(
        id=f"SOL-{uuid4().hex[:12].upper()}",
        scenario_id=payload.scenarioId,
        name=payload.solution.name.strip(),
        decision_variables_json=payload.solution.decisionVariables.model_dump(mode="json"),
    )
    submission = Submission(
        id=f"SUB-{uuid4().hex[:12].upper()}",
        solution_id=solution.id,
        client_validation_json=payload.clientValidation.model_dump(mode="json"),
        status="pending",
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
        "status": "accepted",
        "queueStatus": "pending",
        "message": "Saved by FastAPI Cloud and queued for official GMAT validation.",
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
