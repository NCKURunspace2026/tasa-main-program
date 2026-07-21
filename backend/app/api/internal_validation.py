from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.validation import CentralValidationResult, WorkerHeartbeat
from ..services.validation_queue_service import (
    SubmissionStateError,
    claim_next_submission,
    complete_submission,
)
from ..services.worker_status_service import record_heartbeat

router = APIRouter(prefix="/api/internal/validation", tags=["internal-validation"])


def require_worker(device_role: str, worker_token: Optional[str]) -> None:
    expected_token = os.getenv("MISSION_DASHBOARD_WORKER_TOKEN")
    if (
        device_role != "server"
        or not expected_token
        or not worker_token
        or not hmac.compare_digest(worker_token, expected_token)
    ):
        raise HTTPException(status_code=403, detail="Server worker access required.")


@router.post("/heartbeat")
def heartbeat(
    payload: WorkerHeartbeat,
    device_role: str = Header(default="client", alias="X-Device-Role"),
    worker_token: Optional[str] = Header(default=None, alias="X-Worker-Token"),
):
    require_worker(device_role, worker_token)
    return record_heartbeat(payload.provider, payload.gmatConfigured)


@router.post("/next")
def claim_next(
    session: Session = Depends(get_db),
    device_role: str = Header(default="client", alias="X-Device-Role"),
    worker_token: Optional[str] = Header(default=None, alias="X-Worker-Token"),
):
    require_worker(device_role, worker_token)
    item = claim_next_submission(session)
    return {"item": item}


@router.post("/{submission_id}/result")
def post_result(
    submission_id: str,
    payload: CentralValidationResult,
    session: Session = Depends(get_db),
    device_role: str = Header(default="client", alias="X-Device-Role"),
    worker_token: Optional[str] = Header(default=None, alias="X-Worker-Token"),
):
    require_worker(device_role, worker_token)
    try:
        return complete_submission(session, submission_id, payload)
    except SubmissionStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
