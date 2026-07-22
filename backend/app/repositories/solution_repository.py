from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Solution


def create(session: Session, solution: Solution) -> Solution:
    session.add(solution)
    session.flush()
    return solution


def find_by_id(
    session: Session,
    solution_id: str,
    *,
    include_deleted: bool = False,
) -> Solution | None:
    solution = session.get(Solution, solution_id)
    if solution is None or (solution.deleted_at is not None and not include_deleted):
        return None
    return solution


def find_all(
    session: Session,
    *,
    scenario_id: str | None = None,
    include_deleted: bool = False,
) -> list[Solution]:
    query = select(Solution)
    if scenario_id:
        query = query.where(Solution.scenario_id == scenario_id)
    if not include_deleted:
        query = query.where(Solution.deleted_at.is_(None))
    return list(session.scalars(query.order_by(Solution.created_at.desc())).all())
