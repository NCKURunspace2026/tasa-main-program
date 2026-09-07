from __future__ import annotations

import math
import re
from uuid import uuid4

from sqlalchemy.orm import Session

from ..models import Scenario, SyncEvent
from ..models.entities import utc_now
from ..repositories import scenario_repository
from ..schemas.scenario import ScenarioCreate, ScenarioUpdate
from .validation_result_service import (
    mark_scenario_submissions_for_repair,
    recompute_scenario_submissions,
    scenario_dynamics_changed,
)


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
COMPETITION_MODES = {"single-team-interception", "two-team-pursuit"}


def _finite_number(value: object, label: str, *, minimum: float | None = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise InvalidScenarioError(f"{label} must be numeric.") from error
    if not math.isfinite(number) or (minimum is not None and number < minimum):
        qualifier = f" and at least {minimum}" if minimum is not None else ""
        raise InvalidScenarioError(f"{label} must be finite{qualifier}.")
    return number


def _normalize_spacecraft(value: object, role: str) -> dict:
    if not isinstance(value, dict):
        raise InvalidScenarioError(f"spacecraft.{role} must be a JSON object.")
    position = value.get("positionKm")
    velocity = value.get("velocityKmPerSec")
    if position is None or velocity is None:
        legacy = value.get("initialState", {})
        position = legacy.get("position") if isinstance(legacy, dict) else None
        velocity = legacy.get("velocity") if isinstance(legacy, dict) else None
    vectors = ((position, "positionKm"), (velocity, "velocityKmPerSec"))
    for vector, label in vectors:
        if not isinstance(vector, list) or len(vector) != 3:
            raise InvalidScenarioError(f"spacecraft.{role}.{label} must contain three values.")
        for index, component in enumerate(vector):
            _finite_number(component, f"spacecraft.{role}.{label}[{index}]")
    properties = value.get("physicalProperties", {})
    if not isinstance(properties, dict):
        raise InvalidScenarioError(f"spacecraft.{role}.physicalProperties must be an object.")
    defaults = {
        "dryMassKg": 850.0,
        "dragAreaM2": 15.0,
        "srpAreaM2": 1.0,
        "coefficientOfDrag": 2.2,
        "coefficientOfReflectivity": 1.8,
    }
    normalized_properties = {
        key: _finite_number(
            properties.get(key, default),
            f"spacecraft.{role}.physicalProperties.{key}",
            minimum=0,
        )
        for key, default in defaults.items()
    }
    if any(value <= 0 for value in normalized_properties.values()):
        raise InvalidScenarioError(f"spacecraft.{role} physical properties must be positive.")
    return {**value, "physicalProperties": normalized_properties}


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
    if not isinstance(definition, dict):
        raise InvalidScenarioError("Scenario JSON must be an object.")
    required = (
        "epoch", "coordinateSystem", "spacecraft", "forceModel",
        "propagator", "validation", "scoreConfig",
    )
    missing = [field for field in required if field not in definition]
    if missing:
        raise InvalidScenarioError(f"Scenario JSON is missing: {', '.join(missing)}.")
    spacecraft = definition.get("spacecraft", {})
    if not isinstance(spacecraft, dict) or not all(role in spacecraft for role in ("target", "chaser")):
        raise InvalidScenarioError("Scenario must define target and chaser spacecraft.")
    normalized_spacecraft = {
        "target": _normalize_spacecraft(spacecraft["target"], "target"),
        "chaser": _normalize_spacecraft(spacecraft["chaser"], "chaser"),
    }
    epoch = definition.get("epoch")
    epoch_value = epoch.get("value") if isinstance(epoch, dict) else epoch
    if not isinstance(epoch_value, str) or not epoch_value.strip():
        raise InvalidScenarioError("Scenario epoch must contain a non-empty UTC value.")
    coordinate_system = definition.get("coordinateSystem")
    if not isinstance(coordinate_system, str) or not re.fullmatch(
        r"[A-Za-z][A-Za-z0-9_]*", coordinate_system
    ):
        raise InvalidScenarioError("Scenario coordinateSystem is invalid.")
    normalized = dict(definition)
    try:
        schema_version = int(float(definition.get("schemaVersion", 1)))
    except (TypeError, ValueError) as error:
        raise InvalidScenarioError("schemaVersion must be an integer.") from error
    if schema_version < 1:
        raise InvalidScenarioError("schemaVersion must be at least 1.")
    normalized["schemaVersion"] = schema_version
    competition_mode = definition.get("competitionMode", "single-team-interception")
    if competition_mode not in COMPETITION_MODES:
        raise InvalidScenarioError(f"Unsupported competitionMode: {competition_mode}.")
    normalized["competitionMode"] = competition_mode
    normalized["spacecraft"] = normalized_spacecraft
    normalized["forceModel"] = _normalize_force_model(definition["forceModel"])
    propagator = definition.get("propagator")
    if not isinstance(propagator, dict):
        raise InvalidScenarioError("propagator must be a JSON object.")
    integrator = propagator.get("integrator", "RungeKutta89")
    if integrator not in INTEGRATORS:
        raise InvalidScenarioError(f"Unsupported propagator integrator: {integrator}.")
    initial_step = _finite_number(
        propagator.get("initialStepSec", 1), "propagator.initialStepSec", minimum=0,
    )
    max_step = _finite_number(
        propagator.get("maxStepSec", initial_step), "propagator.maxStepSec", minimum=0,
    )
    min_step = _finite_number(
        propagator.get("minStepSec", min(initial_step, max_step)),
        "propagator.minStepSec",
        minimum=0,
    )
    accuracy = _finite_number(
        propagator.get("accuracy", 1e-12), "propagator.accuracy", minimum=0,
    )
    if min(initial_step, max_step, min_step, accuracy) <= 0:
        raise InvalidScenarioError("Propagator step sizes and accuracy must be greater than zero.")
    if not min_step <= initial_step <= max_step:
        raise InvalidScenarioError(
            "Propagator steps must satisfy minStepSec <= initialStepSec <= maxStepSec."
        )
    normalized["propagator"] = {
        **propagator,
        "integrator": integrator,
        "initialStepSec": initial_step,
        "maxStepSec": max_step,
        "minStepSec": min_step,
        "accuracy": accuracy,
    }

    validation = definition.get("validation")
    if not isinstance(validation, dict):
        raise InvalidScenarioError("validation must be a JSON object.")
    if "maximumDeltaVPerBurn" not in validation and "maximumTotalDeltaV" in validation:
        validation["maximumDeltaVPerBurn"] = validation["maximumTotalDeltaV"]
    validation.pop("maximumTotalDeltaV", None)
    validation.pop("minimumBurnCount", None)
    validation.pop("maximumBurnCount", None)
    validation["requiredFinalDistanceKm"] = 5.0
    normalized["validation"] = validation
    for key in ("requiredFinalDistanceKm", "maximumDeltaVPerBurn", "maximumMissionTimeSec"):
        _finite_number(validation.get(key), f"validation.{key}", minimum=0)
    _finite_number(
        validation.get("minimumBurnSeparationSec"),
        "validation.minimumBurnSeparationSec",
        minimum=0,
    )

    score_config = definition.get("scoreConfig")
    if not isinstance(score_config, dict):
        raise InvalidScenarioError("scoreConfig must be a JSON object.")
    for key in (
        "timeReferenceSec", "timeSlope", "deltaVReferenceKmPerSec", "deltaVSlope",
    ):
        value = _finite_number(score_config.get(key), f"scoreConfig.{key}", minimum=0)
        if key in {"timeSlope", "deltaVSlope"} and value <= 0:
            raise InvalidScenarioError(f"scoreConfig.{key} must be greater than zero.")
    normalized["scoreConfig"] = {
        key: score_config[key]
        for key in ("timeReferenceSec", "timeSlope", "deltaVReferenceKmPerSec", "deltaVSlope")
    }
    return normalized


def list_scenarios(session: Session) -> list[dict]:
    scenarios = scenario_repository.find_all(session)
    return [_serialize(scenario) for scenario in scenarios]


def get_scenario(session: Session, scenario_id: str) -> dict | None:
    scenario = scenario_repository.find_by_id(session, scenario_id)
    return _serialize(scenario) if scenario else None


def create_scenario(session: Session, payload: ScenarioCreate) -> dict:
    scenario_id = payload.scenarioId or _next_scenario_id(session)
    if scenario_repository.find_by_id(session, scenario_id, include_inactive=True) is not None:
        raise ScenarioAlreadyExistsError(f"Scenario {scenario_id} already exists.")
    definition = normalize_scenario(payload.scenarioJson)
    scenario = Scenario(
        id=scenario_id,
        name=payload.name.strip(),
        description=payload.description.strip(),
        scenario_json=definition,
        schema_version=definition["schemaVersion"],
        status="active",
    )
    scenario_repository.create(session, scenario)
    session.add(SyncEvent(record_type="scenario", record_id=scenario.id))
    session.commit()
    return _serialize(scenario)


def _next_scenario_id(session: Session) -> str:
    while True:
        scenario_id = f"SC-{uuid4().int % 1_000_000_000_000:012d}"
        if scenario_repository.find_by_id(session, scenario_id, include_inactive=True) is None:
            return scenario_id


def set_scenario_inactive(session: Session, scenario_id: str) -> dict | None:
    scenario = scenario_repository.find_by_id(session, scenario_id, include_inactive=True)
    if scenario is None:
        return None
    scenario.status = "inactive"
    scenario.updated_at = utc_now()
    scenario_repository.update(session, scenario)
    session.add(SyncEvent(record_type="scenario", record_id=scenario.id))
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
    dynamics_changed = scenario_dynamics_changed(
        normalize_scenario(scenario.scenario_json), definition,
    )
    scenario.name = payload.name.strip()
    scenario.description = payload.description.strip()
    scenario.scenario_json = definition
    scenario.schema_version = definition["schemaVersion"]
    scenario.updated_at = utc_now()
    scenario_repository.update(session, scenario)
    session.add(SyncEvent(record_type="scenario", record_id=scenario.id))
    if dynamics_changed:
        mark_scenario_submissions_for_repair(
            session, scenario, updated_at=scenario.updated_at,
        )
    else:
        recompute_scenario_submissions(session, scenario, updated_at=scenario.updated_at)
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
