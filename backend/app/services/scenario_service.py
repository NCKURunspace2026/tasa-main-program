from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Scenario
from ..models.entities import utc_now
from ..repositories import scenario_repository
from ..schemas.scenario import ScenarioCreate, ScenarioUpdate


class ScenarioAlreadyExistsError(ValueError):
    pass


class InvalidScenarioError(ValueError):
    pass


CELESTIAL_BODIES = {
    "Earth", "Luna", "Sun", "Mercury", "Venus", "Mars", "Jupiter",
    "Saturn", "Uranus", "Neptune",
}
ATMOSPHERE_MODELS = {"JacchiaRoberts", "MSISE90"}
INTEGRATORS = {"RungeKutta89", "PrinceDormand78", "RungeKutta68", "RungeKutta56"}


def _normalize_force_model(value: object) -> dict:
    if not isinstance(value, dict):
        raise InvalidScenarioError("forceModel must be a JSON object.")
    central_body = value.get("centralBody", "Earth")
    if not isinstance(central_body, str) or central_body not in CELESTIAL_BODIES:
        raise InvalidScenarioError(f"Unsupported forceModel centralBody: {central_body}.")

    gravity_value = value.get("gravityField", value.get("gravity", {}))
    if not isinstance(gravity_value, dict):
        raise InvalidScenarioError("forceModel.gravity must be a JSON object.")
    gravity_enabled = bool(gravity_value.get("enabled", bool(gravity_value)))
    try:
        degree_value = float(gravity_value.get("degree", 0)) if gravity_enabled else 0.0
        order_value = float(gravity_value.get("order", 0)) if gravity_enabled else 0.0
    except (TypeError, ValueError) as error:
        raise InvalidScenarioError("Gravity degree and order must be integers.") from error
    if not degree_value.is_integer() or not order_value.is_integer():
        raise InvalidScenarioError("Gravity degree and order must be integers.")
    gravity_degree = int(degree_value)
    gravity_order = int(order_value)
    if gravity_degree < 0 or gravity_order < 0 or gravity_order > gravity_degree:
        raise InvalidScenarioError(
            "Gravity degree and order must be non-negative, with order no greater than degree."
        )

    point_masses = value.get("pointMasses", [])
    if not isinstance(point_masses, list) or any(
        not isinstance(body, str) or body not in CELESTIAL_BODIES for body in point_masses
    ):
        raise InvalidScenarioError("forceModel.pointMasses contains an unsupported body.")
    point_masses = list(dict.fromkeys(point_masses))
    if central_body in point_masses:
        raise InvalidScenarioError("The central body cannot also be a point-mass perturbation.")

    drag_value = value.get("drag", {})
    if not isinstance(drag_value, dict):
        raise InvalidScenarioError("forceModel.drag must be a JSON object.")
    drag_enabled = bool(drag_value.get("enabled", False))
    drag_model = drag_value.get("model") or "JacchiaRoberts"
    if drag_enabled and central_body != "Earth":
        raise InvalidScenarioError("The available atmosphere models currently support Earth only.")
    if drag_enabled and drag_model not in ATMOSPHERE_MODELS:
        raise InvalidScenarioError(f"Unsupported atmosphere model: {drag_model}.")

    srp_value = value.get("solarRadiationPressure", {})
    if not isinstance(srp_value, dict):
        raise InvalidScenarioError("forceModel.solarRadiationPressure must be a JSON object.")
    relativity_value = value.get("relativisticCorrection", {})
    if not isinstance(relativity_value, dict):
        raise InvalidScenarioError("forceModel.relativisticCorrection must be a JSON object.")

    return {
        "centralBody": central_body,
        "gravity": {
            "type": "spherical-harmonic",
            "enabled": gravity_enabled,
            "degree": gravity_degree,
            "order": gravity_order,
        },
        "pointMasses": point_masses,
        "drag": {"enabled": drag_enabled, "model": drag_model if drag_enabled else None},
        "solarRadiationPressure": {
            "enabled": bool(srp_value.get("enabled", False)),
        },
        "relativisticCorrection": {
            "enabled": bool(relativity_value.get("enabled", False)),
        },
    }


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
    normalized["forceModel"] = _normalize_force_model(definition["forceModel"])
    propagator = definition.get("propagator")
    if not isinstance(propagator, dict):
        raise InvalidScenarioError("propagator must be a JSON object.")
    integrator = propagator.get("integrator", "RungeKutta89")
    if integrator not in INTEGRATORS:
        raise InvalidScenarioError(f"Unsupported propagator integrator: {integrator}.")
    normalized["propagator"] = {**propagator, "integrator": integrator}
    return normalized


def list_scenarios(session: Session, include_inactive: bool = False) -> list[dict]:
    # Scenarios are permanent simulation definitions. Unlike Solutions, they
    # are never hidden because an empty active list creates an unusable client.
    scenarios = scenario_repository.find_all(session)
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
    scenario.updated_at = utc_now()
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
    scenario.updated_at = utc_now()
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
