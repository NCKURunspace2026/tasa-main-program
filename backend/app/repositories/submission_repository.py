from __future__ import annotations

from datetime import datetime, timedelta, timezone
from secrets import token_hex

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


def claim_next_pending(
    session: Session,
    worker_id: str,
    lease_seconds: int = 180,
) -> Submission | None:
    now = datetime.now(timezone.utc)
    session.execute(
        update(Submission)
        .where(
            Submission.status == "validating",
            Submission.lease_expires_at.is_not(None),
            Submission.lease_expires_at < now,
        )
        .values(
            status="pending",
            claimed_at=None,
            lease_expires_at=None,
            claimed_by_worker_id=None,
            claim_token=None,
        )
    )

    query = (
        select(Submission)
        .where(Submission.status == "pending")
        .order_by(Submission.created_at.asc())
        .limit(1)
    )
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        query = query.with_for_update(skip_locked=True)

    candidate = session.scalar(query)
    if candidate is None:
        session.commit()
        return None

    claim_token = token_hex(24)
    lease_expires_at = now + timedelta(seconds=lease_seconds)
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        candidate.status = "validating"
        candidate.claimed_at = now
        candidate.lease_expires_at = lease_expires_at
        candidate.claimed_by_worker_id = worker_id
        candidate.claim_token = claim_token
        candidate.attempt_count += 1
    else:
        claimed = session.execute(
            update(Submission)
            .where(Submission.id == candidate.id, Submission.status == "pending")
            .values(
                status="validating",
                claimed_at=now,
                lease_expires_at=lease_expires_at,
                claimed_by_worker_id=worker_id,
                claim_token=claim_token,
                attempt_count=Submission.attempt_count + 1,
            )
        )
        if claimed.rowcount != 1:
            session.rollback()
            return None
    session.commit()
    return session.get(Submission, candidate.id)
