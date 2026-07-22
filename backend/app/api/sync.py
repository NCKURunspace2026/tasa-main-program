from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.sync import SyncImportRequest, SyncSettingsUpdate
from ..services.sync_service import (
    build_manifest,
    find_record,
    get_sync_setting,
    import_records,
    read_changes,
    serialize_sync_setting,
    synchronize_with_peer,
    update_sync_setting,
)

exchange_router = APIRouter(prefix="/api/sync", tags=["sync-exchange"])
local_router = APIRouter(prefix="/api/sync", tags=["sync-settings"])


@exchange_router.get("/manifest")
def read_manifest(session: Session = Depends(get_db)):
    return build_manifest(session)


@exchange_router.get("/records/{record_type}/{record_id}")
def read_record(record_type: str, record_id: str, session: Session = Depends(get_db)):
    record = find_record(session, record_type, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Sync record not found.")
    return record


@exchange_router.post("/import")
def post_import(payload: SyncImportRequest, session: Session = Depends(get_db)):
    return import_records(session, payload.records)


@exchange_router.get("/changes")
def get_changes(
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=500),
    session: Session = Depends(get_db),
):
    return read_changes(session, after, limit)


@local_router.get("/settings")
def read_settings(session: Session = Depends(get_db)):
    return serialize_sync_setting(get_sync_setting(session))


@local_router.put("/settings")
def put_settings(payload: SyncSettingsUpdate, session: Session = Depends(get_db)):
    try:
        return update_sync_setting(session, payload.peerUrl, payload.enabled)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@local_router.post("/run")
def run_sync(session: Session = Depends(get_db)):
    return synchronize_with_peer(session)
