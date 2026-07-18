from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

from ..schemas.submission import DecisionVariableSetInput


@dataclass(frozen=True)
class ConstraintCheck:
    name: str
    value: float
    limit: float
    operator: str
    satisfied: bool


@dataclass(frozen=True)
class ValidationOutcome:
    status: str
    burn_count: int
    total_delta_v: float
    total_time: float
    final_distance: float
    official_score: Optional[float]
    constraints: list[ConstraintCheck]
    provider: str
    error_message: Optional[str] = None


class ValidationProvider(Protocol):
    def validate(
        self,
        scenario_id: str,
        variables: DecisionVariableSetInput,
    ) -> ValidationOutcome: ...
