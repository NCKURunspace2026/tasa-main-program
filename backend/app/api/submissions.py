from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.submission import SubmissionInput
from ..services.submission_service import ScenarioNotFoundError, create_submission, get_submission

router = APIRouter(prefix="/api/submissions", tags=["submissions"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def post_submission(
    payload: SubmissionInput,
    session: Session = Depends(get_db),
):
    try:
        return create_submission(session, payload)
    except ScenarioNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{submission_id}")
def read_submission(submission_id: str, session: Session = Depends(get_db)):
    result = get_submission(session, submission_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Submission not found.")
    return result
