from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import Solution, Submission


def create(session: Session, submission: Submission) -> Submission:
    session.add(submission)
    session.flush()
    return submission


def find_by_id(session: Session, submission_id: str) -> Submission | None:
    return session.get(Submission, submission_id)


def _passed_solution_query(scenario_id: str, search: str | None = None):
    query = (
        select(Submission, Solution)
        .join(Solution, Solution.id == Submission.solution_id)
        .where(
            Solution.scenario_id == scenario_id,
            Solution.deleted_at.is_(None),
            Submission.status == "passed",
        )
    )
    if search:
        pattern = f"%{search}%"
        query = query.where(or_(Solution.id.ilike(pattern), Solution.name.ilike(pattern)))
    return query


def find_passed_by_scenario(
    session: Session,
    scenario_id: str,
    *,
    offset: int,
    limit: int,
    search: str | None = None,
):
    query = _passed_solution_query(scenario_id, search).order_by(
        Submission.total_score.desc(), Submission.created_at.asc()
    )
    return session.execute(query.offset(offset).limit(limit)).all()


def count_passed_by_scenario(
    session: Session,
    scenario_id: str,
    search: str | None = None,
) -> int:
    query = _passed_solution_query(scenario_id, search).with_only_columns(
        func.count(Submission.id)
    ).order_by(None)
    return int(session.scalar(query) or 0)
