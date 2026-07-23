from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.solution_query_service import (
    get_solution_detail,
    set_solution_deleted,
    update_solution_validation,
)
from ..schemas.submission import SolutionRevalidationInput

router = APIRouter(prefix="/api/solutions", tags=["solutions"])


def require_admin_token(
    token: Optional[str] = Header(default=None, alias="X-Mission-Dashboard-Admin-Token"),
) -> None:
    expected = os.getenv("MISSION_DASHBOARD_ADMIN_TOKEN")
    if not expected or not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Device administration authorization failed.")


@router.get("/{solution_id}")
def read_solution(
    solution_id: str,
    session: Session = Depends(get_db),
):
    detail = get_solution_detail(session, solution_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Solution not found.")
    return detail


@router.delete("/{solution_id}", dependencies=[Depends(require_admin_token)])
def delete_solution(solution_id: str, session: Session = Depends(get_db)):
    result = set_solution_deleted(session, solution_id, True)
    if result is None:
        raise HTTPException(status_code=404, detail="Solution not found.")
    return result


@router.post("/{solution_id}/revalidate")
def revalidate_solution(
    solution_id: str,
    payload: SolutionRevalidationInput,
    session: Session = Depends(get_db),
):
    try:
        result = update_solution_validation(session, solution_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if result is None:
        raise HTTPException(status_code=404, detail="Solution not found.")
    return result
