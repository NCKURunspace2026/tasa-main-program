from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Burn,
    ConstraintResult,
    DecisionVariableSet,
    OptimizationRun,
    Solution,
    Submission,
    ValidationResult,
)


def get_solution_detail(session: Session, public_id: str) -> dict | None:
    solution = session.scalar(select(Solution).where(Solution.public_id == public_id))
    if solution is None:
        return None

    submission = session.get(Submission, solution.submission_id)
    optimization = session.scalar(
        select(OptimizationRun).where(OptimizationRun.solution_id == solution.id)
    )
    validation = session.scalar(
        select(ValidationResult).where(ValidationResult.solution_id == solution.id)
    )
    variable_sets = session.scalars(
        select(DecisionVariableSet).where(DecisionVariableSet.solution_id == solution.id)
    ).all()
    variables = {
        variable_set.set_type: _serialize_variable_set(session, variable_set)
        for variable_set in variable_sets
    }
    constraints = []
    if validation is not None:
        constraints = session.scalars(
            select(ConstraintResult).where(
                ConstraintResult.validation_result_id == validation.id
            )
        ).all()

    higher_scores = session.scalars(
        select(Solution).where(
            Solution.scenario_id == solution.scenario_id,
            Solution.validation_status == "validated",
            Solution.official_score > solution.official_score,
        )
    ).all()

    return {
        "solutionId": solution.public_id,
        "submissionId": submission.public_id,
        "scenarioId": solution.scenario_id,
        "solution": {
            "name": solution.solution_name,
            "type": solution.solution_type,
            "notes": solution.notes,
        },
        "identity": {
            "submittedBy": submission.user_id,
            "deviceId": submission.device_id,
            "createdAt": submission.created_at.isoformat(),
        },
        "optimization": _serialize_optimization(optimization, variables.get("initial")),
        "finalDecisionVariables": variables["final"],
        "officialResults": {
            "rank": len(higher_scores) + 1,
            "officialScore": solution.official_score,
            "finalDistance": solution.final_distance,
            "totalDeltaV": solution.total_delta_v,
            "totalTime": solution.total_time,
            "burnCount": solution.burn_count,
        },
        "constraints": [
            {
                "name": constraint.constraint_name,
                "value": constraint.value,
                "limit": constraint.limit_value,
                "operator": constraint.operator,
                "satisfied": constraint.satisfied,
            }
            for constraint in constraints
        ],
    }


def _serialize_variable_set(session: Session, variable_set: DecisionVariableSet) -> dict:
    burns = session.scalars(
        select(Burn)
        .where(Burn.decision_variable_set_id == variable_set.id)
        .order_by(Burn.burn_index)
    ).all()
    return {
        "tWait": variable_set.t_wait,
        "burns": [
            {
                "index": burn.burn_index,
                "deltaV": [burn.delta_v_x, burn.delta_v_y, burn.delta_v_z],
                "timeToNextBurn": burn.time_to_next_burn,
            }
            for burn in burns
        ],
        "finalCoastTime": variable_set.final_coast_time,
    }


def _serialize_optimization(optimization: OptimizationRun | None, initial_guess: dict | None) -> dict | None:
    if optimization is None:
        return None
    return {
        "method": {
            "name": optimization.method_name,
            "implementation": optimization.method_implementation,
            "version": optimization.method_version,
            "options": optimization.method_options_json,
        },
        "objectiveFunction": {
            "name": optimization.objective_name,
            "sense": optimization.objective_sense,
            "definitionType": optimization.objective_definition_type,
            "reference": optimization.objective_reference,
            "expression": optimization.objective_expression,
            "components": optimization.objective_components_json,
            "parameters": optimization.objective_parameters_json,
            "description": optimization.objective_description,
        },
        "initialGuess": initial_guess,
        "report": {
            "success": optimization.optimizer_success,
            "objectiveValue": optimization.objective_value,
            "iterations": optimization.optimizer_iterations,
            "functionEvaluations": optimization.function_evaluations,
            "message": optimization.optimizer_message,
        },
    }
