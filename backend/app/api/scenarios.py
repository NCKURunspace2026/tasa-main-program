from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.scenario import ScenarioCreate, ScenarioParseRequest, ScenarioUpdate
from ..services.scenario_service import (
    ScenarioAlreadyExistsError,
    InvalidScenarioError,
    create_scenario,
    get_scenario,
    list_scenarios,
    normalize_scenario,
    set_scenario_status,
    update_scenario,
)

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("")
def read_scenarios(
    include_inactive: bool = Query(default=False, alias="includeInactive"),
    session: Session = Depends(get_db),
):
    return {"items": list_scenarios(session, include_inactive)}


@router.post("/parse")
def parse_scenario(payload: ScenarioParseRequest):
    try:
        return {"scenarioJson": normalize_scenario(payload.scenarioJson)}
    except InvalidScenarioError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/{scenario_id}")
def read_scenario(scenario_id: str, session: Session = Depends(get_db)):
    scenario = get_scenario(session, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    return scenario


@router.post("", status_code=status.HTTP_201_CREATED)
def post_scenario(
    payload: ScenarioCreate,
    session: Session = Depends(get_db),
):
    try:
        return create_scenario(session, payload)
    except ScenarioAlreadyExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except InvalidScenarioError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.put("/{scenario_id}")
def put_scenario(
    scenario_id: str,
    payload: ScenarioUpdate,
    session: Session = Depends(get_db),
):
    try:
        updated = update_scenario(session, scenario_id, payload)
    except InvalidScenarioError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if updated is None:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    return updated


@router.delete("/{scenario_id}")
def delete_scenario(scenario_id: str, session: Session = Depends(get_db)):
    if get_scenario(session, scenario_id) is None:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    raise HTTPException(
        status_code=409,
        detail="Scenario removal is disabled. Simulation definitions remain active.",
    )


@router.post("/{scenario_id}/restore")
def restore_scenario(scenario_id: str, session: Session = Depends(get_db)):
    updated = set_scenario_status(session, scenario_id, "active")
    if updated is None:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    return updated
