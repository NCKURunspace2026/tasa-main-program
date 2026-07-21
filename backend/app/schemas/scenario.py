from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class ScenarioCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenarioId: str = Field(pattern=r"^SC-\d{3,}$")
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    scenarioJson: dict[str, Any]
    originalScript: Optional[str] = None


class ScenarioUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    scenarioJson: dict[str, Any]


class ScenarioParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenarioJson: dict[str, Any]


class ScenarioSummary(BaseModel):
    scenarioId: str
    name: str
    description: str
    scenarioJson: dict[str, Any]
    status: str
    createdAt: Optional[str]
