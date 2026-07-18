import math

from ..schemas.submission import DecisionVariableSetInput
from .provider import ConstraintCheck, ValidationOutcome


class MockValidationProvider:
    """Plumbing-only provider. It must never be treated as physical GMAT evidence."""

    name = "mock-validation-not-physical"

    def validate(self, scenario_id: str, variables: DecisionVariableSetInput) -> ValidationOutcome:
        del scenario_id
        total_delta_v = sum(math.sqrt(sum(component**2 for component in burn.deltaV)) for burn in variables.burns)
        total_time = variables.tWait + variables.finalCoastTime + sum(
            burn.timeToNextBurn or 0 for burn in variables.burns
        )
        final_distance = max(0.0, 5.0 - total_delta_v * 0.05)
        constraints = [
            ConstraintCheck("finalDistance", final_distance, 5.0, "<=", final_distance <= 5.0),
            ConstraintCheck("totalDeltaV", total_delta_v, 1.5, "<=", total_delta_v <= 1.5),
            ConstraintCheck("totalTime", total_time, 21600.0, "<=", total_time <= 21600.0),
            ConstraintCheck("burnCount", float(len(variables.burns)), 10.0, "<=", len(variables.burns) <= 10),
        ]
        passed = all(constraint.satisfied for constraint in constraints)
        return ValidationOutcome(
            # This provider is plumbing only. It must never create a Solution or
            # a leaderboard entry, even if its arithmetic constraints pass.
            status="mock-not-physical",
            burn_count=len(variables.burns),
            total_delta_v=total_delta_v,
            total_time=total_time,
            final_distance=final_distance,
            official_score=None,
            constraints=constraints,
            provider=self.name,
            error_message=(
                "Development Mock validation only; no physical GMAT evidence was supplied."
                if passed else "Development Mock validation constraints failed."
            ),
        )
