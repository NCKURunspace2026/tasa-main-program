from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CentralValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["passed", "failed"]
    workerId: str = Field(min_length=1, max_length=96)
    claimToken: str = Field(min_length=32, max_length=64)
    provider: str = Field(min_length=1, max_length=80)
    minimumDistanceKm: Optional[float] = Field(default=None, ge=0)
    missionTimeSec: Optional[float] = Field(default=None, ge=0)
    totalDeltaVKmPerSec: Optional[float] = Field(default=None, ge=0)
    penaltyScore: float = Field(default=0, ge=0)
    errorMessage: Optional[str] = None

    @model_validator(mode="after")
    def validate_result(self):
        metrics = (
            self.minimumDistanceKm,
            self.missionTimeSec,
            self.totalDeltaVKmPerSec,
        )
        if self.status == "passed" and any(value is None for value in metrics):
            raise ValueError("A passed validation requires all central GMAT metrics.")
        if any(value is not None and not math.isfinite(value) for value in metrics):
            raise ValueError("Official GMAT metrics must be finite.")
        if self.status == "failed" and not self.errorMessage:
            raise ValueError("A failed validation requires errorMessage.")
        return self


class WorkerHeartbeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workerId: str = Field(min_length=1, max_length=96)
    provider: str = Field(min_length=1, max_length=80)
    gmatConfigured: bool


class WorkerClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workerId: str = Field(min_length=1, max_length=96)
