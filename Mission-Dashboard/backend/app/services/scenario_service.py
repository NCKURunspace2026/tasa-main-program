from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Scenario
from ..schemas.scenario import ScenarioCreate


class ScenarioAlreadyExistsError(ValueError):
    pass


def list_scenarios(session: Session) -> list[dict]:
    scenarios = session.scalars(
        select(Scenario)
        .where(Scenario.is_active.is_(True))
        .order_by(Scenario.id.asc())
    ).all()
    return [_serialize_scenario(scenario) for scenario in scenarios]


def create_scenario(session: Session, payload: ScenarioCreate) -> dict:
    if session.get(Scenario, payload.scenarioId) is not None:
        raise ScenarioAlreadyExistsError(
            f"Scenario {payload.scenarioId} already exists."
        )
    scenario = Scenario(
        id=payload.scenarioId,
        name=payload.name.strip(),
        description=payload.description.strip(),
        definition_json=payload.definition,
        is_active=True,
    )
    session.add(scenario)
    session.commit()
    session.refresh(scenario)
    return _serialize_scenario(scenario)


def _serialize_scenario(scenario: Scenario) -> dict:
    return {
        "scenarioId": scenario.id,
        "name": scenario.name,
        "description": scenario.description or "",
        "definition": scenario.definition_json or {},
        "isActive": scenario.is_active,
        "createdAt": scenario.created_at.isoformat() if scenario.created_at else None,
    }
