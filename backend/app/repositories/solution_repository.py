from __future__ import annotations

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
