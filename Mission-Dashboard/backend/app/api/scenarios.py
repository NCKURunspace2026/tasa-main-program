from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.scenario import ScenarioCreate
from ..services.scenario_service import (
    ScenarioAlreadyExistsError,
    create_scenario,
    list_scenarios,
)

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("")
def read_scenarios(session: Session = Depends(get_db)):
    return {"items": list_scenarios(session)}


@router.post("", status_code=status.HTTP_201_CREATED)
def post_scenario(
    payload: ScenarioCreate,
    session: Session = Depends(get_db),
    device_role: str = Header(default="client", alias="X-Device-Role"),
):
    if device_role != "server":
        raise HTTPException(
            status_code=403,
            detail="Only a server device can create scenarios.",
        )
    try:
        return create_scenario(session, payload)
    except ScenarioAlreadyExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
