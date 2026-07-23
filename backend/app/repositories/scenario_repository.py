from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Scenario


def find_all(session: Session, *, include_inactive: bool = False) -> list[Scenario]:
    query = select(Scenario).order_by(Scenario.id)
    if not include_inactive:
        query = query.where(Scenario.status == "active")
    return list(session.scalars(query).all())


def find_by_id(
    session: Session,
    scenario_id: str,
    *,
    include_inactive: bool = False,
) -> Scenario | None:
    scenario = session.get(Scenario, scenario_id)
    if scenario is None or (scenario.status != "active" and not include_inactive):
        return None
    return scenario


def create(session: Session, scenario: Scenario) -> Scenario:
    session.add(scenario)
    session.flush()
    return scenario


def update(session: Session, scenario: Scenario) -> Scenario:
    session.add(scenario)
    session.flush()
    return scenario
