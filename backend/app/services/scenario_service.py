from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Scenario
from ..repositories import scenario_repository
from ..schemas.scenario import ScenarioCreate, ScenarioUpdate


class ScenarioAlreadyExistsError(ValueError):
    pass


class InvalidScenarioError(ValueError):
    pass


def normalize_scenario(definition: dict) -> dict:
    required = (
        "epoch", "coordinateSystem", "spacecraft", "forceModel",
        "propagator", "validation", "scoreConfig",
    )
    missing = [field for field in required if field not in definition]
    if missing:
        raise InvalidScenarioError(f"Scenario JSON is missing: {', '.join(missing)}.")
    spacecraft = definition.get("spacecraft", {})
    if not all(role in spacecraft for role in ("target", "chaser")):
        raise InvalidScenarioError("Scenario must define target and chaser spacecraft.")
    normalized = dict(definition)
    normalized["schemaVersion"] = int(float(definition.get("schemaVersion", 1)))
    return normalized


def list_scenarios(session: Session, include_inactive: bool = False) -> list[dict]:
    scenarios = (
        scenario_repository.find_all(session)
        if include_inactive
        else scenario_repository.find_all_active(session)
    )
    return [_serialize(scenario) for scenario in scenarios]


def get_scenario(session: Session, scenario_id: str) -> dict | None:
    scenario = scenario_repository.find_by_id(session, scenario_id)
    return _serialize(scenario) if scenario else None


def create_scenario(session: Session, payload: ScenarioCreate) -> dict:
    if scenario_repository.find_by_id(session, payload.scenarioId) is not None:
        raise ScenarioAlreadyExistsError(f"Scenario {payload.scenarioId} already exists.")
    definition = normalize_scenario(payload.scenarioJson)
    scenario = Scenario(
        id=payload.scenarioId,
        name=payload.name.strip(),
        description=payload.description.strip(),
        original_script=payload.originalScript,
        scenario_json=definition,
        schema_version=definition["schemaVersion"],
        status="active",
    )
    scenario_repository.create(session, scenario)
    session.commit()
    return _serialize(scenario)


def update_scenario(
    session: Session,
    scenario_id: str,
    payload: ScenarioUpdate,
) -> dict | None:
    scenario = scenario_repository.find_by_id(session, scenario_id)
    if scenario is None:
        return None
    definition = normalize_scenario(payload.scenarioJson)
    scenario.name = payload.name.strip()
    scenario.description = payload.description.strip()
    scenario.scenario_json = definition
    scenario.schema_version = definition["schemaVersion"]
    scenario_repository.update(session, scenario)
    session.commit()
    return _serialize(scenario)


def set_scenario_status(
    session: Session,
    scenario_id: str,
    status: str,
) -> dict | None:
    scenario = scenario_repository.find_by_id(session, scenario_id)
    if scenario is None:
        return None
    scenario.status = status
    scenario_repository.update(session, scenario)
    session.commit()
    return _serialize(scenario)


def _serialize(scenario: Scenario) -> dict:
    return {
        "scenarioId": scenario.id,
        "name": scenario.name,
        "description": scenario.description,
        "scenarioJson": scenario.scenario_json,
        "schemaVersion": scenario.schema_version,
        "status": scenario.status,
        "createdAt": scenario.created_at.isoformat() if scenario.created_at else None,
    }
