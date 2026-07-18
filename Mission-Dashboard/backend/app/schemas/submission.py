from __future__ import annotations

import math
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BurnInput(StrictModel):
    deltaV: tuple[float, float, float]
    timeToNextBurn: Optional[float] = None

    @model_validator(mode="after")
    def validate_finite_values(self):
        if not all(math.isfinite(value) for value in self.deltaV):
            raise ValueError("Every deltaV component must be finite.")
        if self.timeToNextBurn is not None:
            if not math.isfinite(self.timeToNextBurn) or self.timeToNextBurn < 0:
                raise ValueError("timeToNextBurn must be finite and non-negative.")
        return self


class DecisionVariableSetInput(StrictModel):
    tWait: float
    burns: list[BurnInput] = Field(min_length=1)
    finalCoastTime: float

    @model_validator(mode="after")
    def validate_timing_contract(self):
        if not math.isfinite(self.tWait) or self.tWait < 0:
            raise ValueError("tWait must be finite and non-negative.")
        if not math.isfinite(self.finalCoastTime) or self.finalCoastTime < 0:
            raise ValueError("finalCoastTime must be finite and non-negative.")
        for index, burn in enumerate(self.burns):
            is_last = index == len(self.burns) - 1
            if is_last and burn.timeToNextBurn is not None:
                raise ValueError("The final burn must not define timeToNextBurn.")
            if not is_last and burn.timeToNextBurn is None:
                raise ValueError("Every non-final burn must define timeToNextBurn.")
        return self


class OptimizationMethodInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    implementation: Optional[str] = Field(default=None, max_length=180)
    version: Optional[str] = Field(default=None, max_length=80)
    options: dict[str, Any] = Field(default_factory=dict)


class ObjectiveComponentInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    weight: Optional[float] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class ObjectiveFunctionInput(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    sense: Literal["minimize", "maximize"]
    definitionType: Literal["registered", "weighted-components", "expression", "custom"]
    reference: Optional[str] = None
    expression: Optional[str] = None
    components: list[ObjectiveComponentInput] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    description: Optional[str] = None

    @model_validator(mode="after")
    def validate_definition(self):
        if self.definitionType == "registered" and not self.reference:
            raise ValueError("A registered objective requires reference.")
        if self.definitionType == "expression" and not self.expression:
            raise ValueError("An expression objective requires expression.")
        if self.definitionType == "weighted-components" and not self.components:
            raise ValueError("A weighted-components objective requires components.")
        if self.definitionType == "custom" and not (self.description or self.expression):
            raise ValueError("A custom objective requires description or expression.")
        return self


class OptimizerReportInput(StrictModel):
    success: Optional[bool] = None
    objectiveValue: Optional[float] = None
    iterations: Optional[int] = Field(default=None, ge=0)
    functionEvaluations: Optional[int] = Field(default=None, ge=0)
    message: Optional[str] = None

    @model_validator(mode="after")
    def validate_objective_value(self):
        if self.objectiveValue is not None and not math.isfinite(self.objectiveValue):
            raise ValueError("objectiveValue must be finite.")
        return self


class OptimizationInput(StrictModel):
    method: OptimizationMethodInput
    objectiveFunction: ObjectiveFunctionInput
    initialGuess: DecisionVariableSetInput
    report: Optional[OptimizerReportInput] = None


class SolutionMetadataInput(StrictModel):
    name: str = Field(min_length=1, max_length=180)
    type: Literal["optimization", "manual", "direct", "other"]
    notes: Optional[str] = None


class SubmissionInput(StrictModel):
    schemaVersion: Literal["1.1"]
    scenarioId: str = Field(pattern=r"^SC-\d{3,}$")
    solution: SolutionMetadataInput
    optimization: Optional[OptimizationInput] = None
    finalDecisionVariables: DecisionVariableSetInput

    @model_validator(mode="after")
    def validate_solution_type(self):
        if self.solution.type == "optimization" and self.optimization is None:
            raise ValueError("Optimization solutions require optimization metadata.")
        return self
