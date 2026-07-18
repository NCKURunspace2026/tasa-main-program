from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.solution_query_service import get_solution_detail

router = APIRouter(prefix="/api/solutions", tags=["solutions"])


@router.get("/{solution_id}")
def read_solution(solution_id: str, session: Session = Depends(get_db)):
    detail = get_solution_detail(session, solution_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Solution not found.")
    return detail
