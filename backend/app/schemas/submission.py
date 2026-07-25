from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BurnInput(StrictModel):
    deltaV: tuple[float, float, float]
    timeToNextBurn: Optional[float] = None

    @model_validator(mode="after")
    def validate_values(self):
        if not all(math.isfinite(value) for value in self.deltaV):
            raise ValueError("Every deltaV component must be finite.")
        if self.timeToNextBurn is not None and (
            not math.isfinite(self.timeToNextBurn) or self.timeToNextBurn < 0
        ):
            raise ValueError("timeToNextBurn must be finite and non-negative.")
        return self


class DecisionVariablesInput(StrictModel):
    tWait: float = Field(ge=0)
    burns: list[BurnInput] = Field(min_length=1)
    finalCoastTime: float = Field(ge=0)

    @model_validator(mode="after")
    def validate_timing(self):
        if not math.isfinite(self.tWait) or not math.isfinite(self.finalCoastTime):
            raise ValueError("All times must be finite.")
        for index, burn in enumerate(self.burns):
            is_last = index == len(self.burns) - 1
            if is_last and burn.timeToNextBurn is not None:
                raise ValueError("The final burn must not define timeToNextBurn.")
            if not is_last and burn.timeToNextBurn is None:
                raise ValueError("Every non-final burn must define timeToNextBurn.")
        return self


class SolutionInput(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    decisionVariables: DecisionVariablesInput


class ClientValidationInput(StrictModel):
    passed: Literal[True]
    provider: str = Field(min_length=1, max_length=80)
    minimumDistanceKm: float = Field(ge=0)
    minimumDistanceTimeSec: Optional[float] = Field(default=None, ge=0)
    minimumChaserRadiusKm: Optional[float] = Field(default=None, ge=0)
    minimumTargetRadiusKm: Optional[float] = Field(default=None, ge=0)
    missionTimeSec: float = Field(ge=0)
    totalDeltaVKmPerSec: float = Field(ge=0)

    @model_validator(mode="after")
    def validate_finite_metrics(self):
        values = (self.minimumDistanceKm, self.missionTimeSec, self.totalDeltaVKmPerSec)
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Client validation metrics must be finite.")
        if self.minimumDistanceTimeSec is not None and not math.isfinite(self.minimumDistanceTimeSec):
            raise ValueError("Client validation minimum-distance time must be finite.")
        radius_values = (self.minimumChaserRadiusKm, self.minimumTargetRadiusKm)
        if any(value is not None and not math.isfinite(value) for value in radius_values):
            raise ValueError("Client validation spacecraft radius metrics must be finite.")
        return self


class SubmissionInput(StrictModel):
    schemaVersion: Literal[2]
    scenarioId: str = Field(pattern=r"^SC-\d{3,}$")
    solution: SolutionInput
    clientValidation: ClientValidationInput


class SolutionRevalidationInput(StrictModel):
    decisionVariables: DecisionVariablesInput
    clientValidation: ClientValidationInput
