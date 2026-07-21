from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException


def require_worker_access(
    worker_token: Optional[str] = Header(default=None, alias="X-Worker-Token"),
) -> None:
    expected_token = os.getenv("MISSION_DASHBOARD_WORKER_TOKEN", "").strip()
    if (
        not expected_token
        or not worker_token
        or not hmac.compare_digest(worker_token, expected_token)
    ):
        raise HTTPException(status_code=403, detail="GMAT worker access required.")
