from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.submission import SubmissionInput
from ..services.submission_service import ScenarioNotFoundError, create_submission, get_submission

router = APIRouter(prefix="/api/submissions", tags=["submissions"])


@router.post("")
def post_submission(
    payload: SubmissionInput,
    session: Session = Depends(get_db),
    input_type: str = Header(default="file", alias="X-Input-Type"),
):
    if input_type not in {"file", "manual"}:
        raise HTTPException(status_code=400, detail="X-Input-Type must be file or manual.")
    try:
        return create_submission(session, payload, input_type=input_type)
    except ScenarioNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{submission_id}")
def read_submission(submission_id: str, session: Session = Depends(get_db)):
    submission = get_submission(session, submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found.")
    return {
        "submissionId": submission.public_id,
        "scenarioId": submission.scenario_id,
        "status": submission.validation_status,
        "inputType": submission.input_type,
        "errorMessage": submission.error_message,
        "createdAt": submission.created_at,
    }
