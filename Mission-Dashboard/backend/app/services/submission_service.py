from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Burn,
    ConstraintResult,
    DecisionVariableSet,
    OptimizationRun,
    Scenario,
    Solution,
    Submission,
    ValidationResult,
)
from ..schemas.submission import DecisionVariableSetInput, SubmissionInput
from ..validation import MockValidationProvider, ValidationProvider


class ScenarioNotFoundError(ValueError):
    pass


def create_submission(
    session: Session,
    payload: SubmissionInput,
    input_type: str,
    provider: ValidationProvider | None = None,
) -> dict:
    if session.get(Scenario, payload.scenarioId) is None:
        raise ScenarioNotFoundError(f"Scenario {payload.scenarioId} does not exist.")

    validation_provider = provider or MockValidationProvider()
    outcome = validation_provider.validate(payload.scenarioId, payload.finalDecisionVariables)

    try:
        submission = Submission(
            scenario_id=payload.scenarioId,
            input_type=input_type,
            schema_version=payload.schemaVersion,
            raw_payload=payload.model_dump(mode="json"),
            validation_status=outcome.status,
            error_message=outcome.error_message,
        )
        session.add(submission)
        session.flush()
        submission.public_id = f"SUB-{submission.id:06d}"

        validation = ValidationResult(
            submission_id=submission.id,
            solution_id=None,
            status=outcome.status,
            burn_count=outcome.burn_count,
            total_delta_v=outcome.total_delta_v,
            total_time=outcome.total_time,
            final_distance=outcome.final_distance,
            official_score=outcome.official_score,
            provider=outcome.provider,
            error_message=outcome.error_message,
        )
        session.add(validation)
        session.flush()

        solution = None
        if outcome.status == "validated" and outcome.official_score is not None:
            solution = Solution(
                submission_id=submission.id,
                scenario_id=payload.scenarioId,
                solution_name=payload.solution.name,
                solution_type=payload.solution.type,
                notes=payload.solution.notes,
                validation_status="validated",
                official_score=outcome.official_score,
                final_distance=outcome.final_distance,
                total_delta_v=outcome.total_delta_v,
                total_time=outcome.total_time,
                burn_count=outcome.burn_count,
            )
            session.add(solution)
            session.flush()
            solution.public_id = f"SOL-{solution.id:06d}"
            validation.solution_id = solution.id

            _store_decision_variables(session, solution.id, "final", payload.finalDecisionVariables)
            if payload.optimization is not None:
                _store_decision_variables(session, solution.id, "initial", payload.optimization.initialGuess)
                _store_optimization(session, solution.id, payload)

        for check in outcome.constraints:
            session.add(
                ConstraintResult(
                    validation_result_id=validation.id,
                    constraint_name=check.name,
                    value=check.value,
                    limit_value=check.limit,
                    operator=check.operator,
                    satisfied=check.satisfied,
                )
            )

        session.commit()
    except Exception:
        session.rollback()
        raise

    return {
        "submissionId": submission.public_id,
        "solutionId": solution.public_id if solution else None,
        "status": outcome.status,
        "validationProvider": outcome.provider,
        "optimizationSummary": _optimization_summary(payload),
        "officialResults": {
            "burnCount": outcome.burn_count,
            "totalDeltaV": outcome.total_delta_v,
            "totalTime": outcome.total_time,
            "finalDistance": outcome.final_distance,
            "officialScore": outcome.official_score,
        },
        "errorMessage": outcome.error_message,
    }


def get_submission(session: Session, public_id: str) -> Submission | None:
    return session.scalar(select(Submission).where(Submission.public_id == public_id))


def _store_decision_variables(
    session: Session,
    solution_id: int,
    set_type: str,
    variables: DecisionVariableSetInput,
) -> None:
    variable_set = DecisionVariableSet(
        solution_id=solution_id,
        set_type=set_type,
        t_wait=variables.tWait,
        final_coast_time=variables.finalCoastTime,
        burn_count=len(variables.burns),
    )
    session.add(variable_set)
    session.flush()
    for index, burn in enumerate(variables.burns, start=1):
        session.add(
            Burn(
                decision_variable_set_id=variable_set.id,
                burn_index=index,
                delta_v_x=burn.deltaV[0],
                delta_v_y=burn.deltaV[1],
                delta_v_z=burn.deltaV[2],
                time_to_next_burn=burn.timeToNextBurn,
            )
        )


def _store_optimization(session: Session, solution_id: int, payload: SubmissionInput) -> None:
    optimization = payload.optimization
    assert optimization is not None
    objective = optimization.objectiveFunction
    report = optimization.report
    session.add(
        OptimizationRun(
            solution_id=solution_id,
            method_name=optimization.method.name,
            method_implementation=optimization.method.implementation,
            method_version=optimization.method.version,
            method_options_json=optimization.method.options,
            objective_name=objective.name,
            objective_sense=objective.sense,
            objective_definition_type=objective.definitionType,
            objective_reference=objective.reference,
            objective_expression=objective.expression,
            objective_components_json=[component.model_dump() for component in objective.components],
            objective_parameters_json=objective.parameters,
            objective_description=objective.description,
            objective_value=report.objectiveValue if report else None,
            optimizer_success=report.success if report else None,
            optimizer_iterations=report.iterations if report else None,
            function_evaluations=report.functionEvaluations if report else None,
            optimizer_message=report.message if report else None,
        )
    )


def _optimization_summary(payload: SubmissionInput) -> dict | None:
    if payload.optimization is None:
        return None
    report = payload.optimization.report
    return {
        "method": payload.optimization.method.name,
        "objectiveFunction": payload.optimization.objectiveFunction.name,
        "objectiveSense": payload.optimization.objectiveFunction.sense,
        "objectiveValue": report.objectiveValue if report else None,
    }
