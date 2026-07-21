from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.validation import (
    CentralValidationResult,
    WorkerClaimRequest,
    WorkerHeartbeat,
)
from ..security import require_worker_access
from ..services.validation_queue_service import (
    SubmissionStateError,
    claim_next_submission,
    complete_submission,
)
from ..services.worker_status_service import record_heartbeat

router = APIRouter(prefix="/api/internal/validation", tags=["internal-validation"])


@router.post("/heartbeat")
def heartbeat(
    payload: WorkerHeartbeat,
    session: Session = Depends(get_db),
    _: None = Depends(require_worker_access),
):
    return record_heartbeat(
        session,
        payload.workerId,
        payload.provider,
        payload.gmatConfigured,
    )


@router.post("/next")
def claim_next(
    payload: WorkerClaimRequest,
    session: Session = Depends(get_db),
    _: None = Depends(require_worker_access),
):
    item = claim_next_submission(session, payload.workerId)
    return {"item": item}


@router.post("/{submission_id}/result")
def post_result(
    submission_id: str,
    payload: CentralValidationResult,
    session: Session = Depends(get_db),
    _: None = Depends(require_worker_access),
):
    try:
        return complete_submission(session, submission_id, payload)
    except SubmissionStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
