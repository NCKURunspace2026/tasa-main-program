from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models import Solution, Submission
from ..repositories import scenario_repository, submission_repository
from ..schemas.validation import CentralValidationResult
from .score_service import InvalidScoreConfigError, calculate_score


class SubmissionStateError(ValueError):
    pass


def claim_next_submission(session: Session, worker_id: str) -> dict | None:
    submission = submission_repository.claim_next_pending(session, worker_id)
    if submission is None:
        return None
    solution = session.get(Solution, submission.solution_id)
    scenario = scenario_repository.find_by_id(session, solution.scenario_id)
    return {
        "submissionId": submission.id,
        "claimToken": submission.claim_token,
        "leaseExpiresAt": submission.lease_expires_at,
        "solutionId": solution.id,
        "scenario": {
            "scenarioId": scenario.id,
            "name": scenario.name,
            "scenarioJson": scenario.scenario_json,
        },
        "decisionVariables": solution.decision_variables_json,
    }


def complete_submission(
    session: Session,
    submission_id: str,
    result: CentralValidationResult,
) -> dict:
    submission = submission_repository.find_by_id(session, submission_id)
    if submission is None:
        raise SubmissionStateError("Submission not found.")
    if submission.status != "validating":
        raise SubmissionStateError(
            f"Submission {submission_id} is {submission.status}, not validating."
        )
    if (
        submission.claimed_by_worker_id != result.workerId
        or submission.claim_token != result.claimToken
    ):
        raise SubmissionStateError("The validation claim is missing, stale, or owned by another worker.")

    submission.validated_at = datetime.now(timezone.utc)
    submission.lease_expires_at = None
    submission.claim_token = None
    if result.status == "failed":
        submission.status = "failed"
        submission.error_message = result.errorMessage
        session.commit()
        return {"submissionId": submission.id, "status": submission.status}

    solution = session.get(Solution, submission.solution_id)
    scenario = scenario_repository.find_by_id(session, solution.scenario_id)
    try:
        scores = calculate_score(
            scenario.scenario_json.get("scoreConfig", {}),
            result.minimumDistanceKm,
            result.missionTimeSec,
            result.totalDeltaVKmPerSec,
            result.penaltyScore,
        )
    except InvalidScoreConfigError as error:
        submission.status = "failed"
        submission.error_message = f"Official score was not produced: {error}"
        session.commit()
        return {"submissionId": submission.id, "status": submission.status}

    submission.status = "passed"
    submission.server_min_distance_km = result.minimumDistanceKm
    submission.mission_time_sec = result.missionTimeSec
    submission.total_delta_v_kmps = result.totalDeltaVKmPerSec
    submission.distance_score = scores["distanceScore"]
    submission.time_score = scores["timeScore"]
    submission.delta_v_score = scores["deltaVScore"]
    submission.penalty_score = scores["penaltyScore"]
    submission.total_score = scores["totalScore"]
    submission.error_message = None
    session.commit()
    return {
        "submissionId": submission.id,
        "status": submission.status,
        "totalScore": submission.total_score,
    }
