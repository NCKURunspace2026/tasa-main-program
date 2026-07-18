from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class ScenarioCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenarioId: str = Field(pattern=r"^SC-\d{3,}$")
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    definition: dict[str, Any] = Field(default_factory=dict)


class ScenarioSummary(BaseModel):
    scenarioId: str
    name: str
    description: str
    definition: dict[str, Any]
    isActive: bool
    createdAt: Optional[str]
