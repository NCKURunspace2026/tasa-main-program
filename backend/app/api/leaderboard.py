from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.leaderboard_service import get_leaderboard

router = APIRouter(prefix="/api/scenarios", tags=["leaderboard"])


@router.get("/{scenario_id}/leaderboard")
def read_leaderboard(
    scenario_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    search: Optional[str] = Query(default=None, max_length=120),
    session: Session = Depends(get_db),
):
    return get_leaderboard(session, scenario_id, page, page_size, search)
