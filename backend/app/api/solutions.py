from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.solution_query_service import (
    get_solution_detail,
    list_solutions,
    set_solution_deleted,
)

router = APIRouter(prefix="/api/solutions", tags=["solutions"])


@router.get("")
def read_solutions(
    scenario_id: Optional[str] = Query(default=None, alias="scenarioId"),
    include_deleted: bool = Query(default=False, alias="includeDeleted"),
    session: Session = Depends(get_db),
):
    return {"items": list_solutions(session, scenario_id, include_deleted)}


@router.get("/{solution_id}")
def read_solution(
    solution_id: str,
    include_deleted: bool = Query(default=False, alias="includeDeleted"),
    session: Session = Depends(get_db),
):
    detail = get_solution_detail(session, solution_id, include_deleted)
    if detail is None:
        raise HTTPException(status_code=404, detail="Solution not found.")
    return detail


@router.delete("/{solution_id}")
def delete_solution(solution_id: str, session: Session = Depends(get_db)):
    result = set_solution_deleted(session, solution_id, True)
    if result is None:
        raise HTTPException(status_code=404, detail="Solution not found.")
    return result


@router.post("/{solution_id}/restore")
def restore_solution(solution_id: str, session: Session = Depends(get_db)):
    result = set_solution_deleted(session, solution_id, False)
    if result is None:
        raise HTTPException(status_code=404, detail="Solution not found.")
    return result
