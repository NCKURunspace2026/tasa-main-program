from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.scenario import ScenarioCreate, ScenarioUpdate
from ..services.scenario_service import (
    ScenarioAlreadyExistsError,
    InvalidScenarioError,
    create_scenario,
    get_scenario,
    list_scenarios,
    update_scenario,
)

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("")
def read_scenarios(
    session: Session = Depends(get_db),
):
    return {"items": list_scenarios(session)}


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
