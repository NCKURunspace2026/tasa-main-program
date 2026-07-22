from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.data_export_service import export_csv, export_jsonl


router = APIRouter(prefix="/api/data", tags=["data-export"])


@router.get("/export")
def export_data(
    format_name: str = Query(default="jsonl", alias="format", pattern="^(csv|jsonl)$"),
    session: Session = Depends(get_db),
):
    date_stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    if format_name == "csv":
        content = export_csv(session)
        media_type = "text/csv; charset=utf-8"
    else:
        content = export_jsonl(session)
        media_type = "application/x-ndjson; charset=utf-8"
    filename = f"mission-dashboard-dataset-{date_stamp}.{format_name}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
