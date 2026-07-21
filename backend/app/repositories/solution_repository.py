from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Solution


def create(session: Session, solution: Solution) -> Solution:
    session.add(solution)
    session.flush()
    return solution


def find_by_id(session: Session, solution_id: str) -> Solution | None:
    return session.get(Solution, solution_id)
