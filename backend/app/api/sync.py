from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.sync import SyncImportRequest, SyncSettingsUpdate
from ..services.sync_service import (
    build_manifest,
    find_record,
    get_sync_setting,
    import_records,
    serialize_sync_setting,
    synchronize_with_peer,
    update_sync_setting,
)

router = APIRouter(prefix="/api/sync", tags=["sync"])


def require_local_node() -> None:
    if os.getenv("MISSION_DASHBOARD_NODE_ROLE") == "relay":
        raise HTTPException(status_code=404, detail="Local sync controls are disabled on relay nodes.")


@router.get("/manifest")
def read_manifest(session: Session = Depends(get_db)):
    return build_manifest(session)


@router.get("/records/{record_type}/{record_id}")
def read_record(record_type: str, record_id: str, session: Session = Depends(get_db)):
    record = find_record(session, record_type, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Sync record not found.")
    return record


@router.post("/import")
def post_import(payload: SyncImportRequest, session: Session = Depends(get_db)):
    return import_records(session, payload.records)


@router.get("/settings", dependencies=[Depends(require_local_node)])
def read_settings(session: Session = Depends(get_db)):
    return serialize_sync_setting(get_sync_setting(session))


@router.put("/settings", dependencies=[Depends(require_local_node)])
def put_settings(payload: SyncSettingsUpdate, session: Session = Depends(get_db)):
    try:
        return update_sync_setting(session, payload.peerUrl, payload.enabled)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/run", dependencies=[Depends(require_local_node)])
def run_sync(session: Session = Depends(get_db)):
    return synchronize_with_peer(session)
