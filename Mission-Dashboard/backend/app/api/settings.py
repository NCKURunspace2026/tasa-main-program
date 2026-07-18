from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.settings import ValidationSettingsUpdate
from ..services.settings_service import (
    get_validation_settings,
    update_validation_settings,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def require_server(device_role: str) -> None:
    if device_role != "server":
        raise HTTPException(
            status_code=403,
            detail="Only a server device can modify validation settings.",
        )


@router.get("/validation")
def read_validation_settings(session: Session = Depends(get_db)):
    return get_validation_settings(session)


@router.put("/validation")
def put_validation_settings(
    payload: ValidationSettingsUpdate,
    session: Session = Depends(get_db),
    device_role: str = Header(default="client", alias="X-Device-Role"),
):
    require_server(device_role)
    return update_validation_settings(session, payload.gmatApiUrl)
