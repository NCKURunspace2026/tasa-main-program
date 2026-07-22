from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SyncSettingsUpdate(StrictModel):
    peerUrl: str = Field(min_length=1, max_length=500)
    sharedKey: Optional[str] = Field(default=None, max_length=256)
    enabled: bool = True


class SyncImportRequest(StrictModel):
    records: list[dict[str, Any]] = Field(max_length=500)
