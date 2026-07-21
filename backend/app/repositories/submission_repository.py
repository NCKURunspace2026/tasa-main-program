from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import Submission


def create(session: Session, submission: Submission) -> Submission:
    session.add(submission)
    session.flush()
    return submission


def find_by_id(session: Session, submission_id: str) -> Submission | None:
    return session.get(Submission, submission_id)


def find_passed_by_scenario(session: Session, scenario_id: str):
    from ..models import Solution

    return session.execute(
        select(Submission, Solution)
        .join(Solution, Solution.id == Submission.solution_id)
        .where(Solution.scenario_id == scenario_id, Submission.status == "passed")
        .order_by(Submission.total_score.desc(), Submission.created_at.asc())
    ).all()


def claim_next_pending(session: Session) -> Submission | None:
    candidate_id = session.scalar(
        select(Submission.id)
        .where(Submission.status == "pending")
        .order_by(Submission.created_at.asc())
        .limit(1)
    )
    if candidate_id is None:
        return None
    claimed = session.execute(
        update(Submission)
        .where(Submission.id == candidate_id, Submission.status == "pending")
        .values(status="validating")
    )
    if claimed.rowcount != 1:
        session.rollback()
        return None
    session.commit()
    return session.get(Submission, candidate_id)
