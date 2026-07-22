from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Scenario


def find_all(session: Session) -> list[Scenario]:
    return list(session.scalars(select(Scenario).order_by(Scenario.id)).all())


def find_by_id(session: Session, scenario_id: str) -> Scenario | None:
    return session.get(Scenario, scenario_id)


def create(session: Session, scenario: Scenario) -> Scenario:
    session.add(scenario)
    session.flush()
    return scenario


def update(session: Session, scenario: Scenario) -> Scenario:
    session.add(scenario)
    session.flush()
    return scenario
