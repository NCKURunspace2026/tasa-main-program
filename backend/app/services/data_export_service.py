from __future__ import annotations

import csv
import io
import json
import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Scenario, Solution, Submission


EXPORT_FIELDS = (
    "scenario_id",
    "scenario_name",
    "scenario_status",
    "scenario_definition",
    "solution_id",
    "solution_name",
    "solution_deleted_at",
    "submission_id",
    "submission_status",
    "decision_variables",
    "burn_norms_kmps",
    "minimum_distance_km",
    "minimum_distance_time_sec",
    "minimum_chaser_radius_km",
    "minimum_target_radius_km",
    "mission_time_sec",
    "total_delta_v_kmps",
    "total_score",
    "distance_score",
    "time_score",
    "delta_v_score",
    "penalty_score",
    "client_validation",
    "error_message",
    "created_at",
    "updated_at",
    "validated_at",
)


def iter_export_rows(
    session: Session,
    *,
    include_archived: bool = False,
    scope: str = "ml",
    scenario_id: str | None = None,
):
    query = (
        select(Scenario, Solution, Submission)
        .outerjoin(Solution, Solution.scenario_id == Scenario.id)
        .outerjoin(Submission, Submission.solution_id == Solution.id)
        .order_by(Scenario.id, Solution.created_at, Submission.created_at)
        .execution_options(yield_per=500)
    )
    if scenario_id:
        query = query.where(Scenario.id == scenario_id)
    if scope == "ml":
        query = query.where(
            Scenario.status == "active",
            Solution.deleted_at.is_(None),
            Submission.status == "passed",
        )
    elif not include_archived:
        query = query.where(Solution.deleted_at.is_(None))
    rows = session.execute(query)
    for scenario, solution, submission in rows:
        decision_variables = solution.decision_variables_json if solution else None
        burns = decision_variables.get("burns", []) if decision_variables else []
        yield {
            "scenario_id": scenario.id,
            "scenario_name": scenario.name,
            "scenario_status": scenario.status,
            "scenario_definition": scenario.scenario_json,
            "solution_id": solution.id if solution else None,
            "solution_name": solution.name if solution else None,
            "solution_deleted_at": _iso(solution.deleted_at) if solution else None,
            "submission_id": submission.id if submission else None,
            "submission_status": submission.status if submission else None,
            "decision_variables": decision_variables,
            "burn_norms_kmps": [
                math.hypot(*burn.get("deltaV", (0, 0, 0))) for burn in burns
            ],
            "minimum_distance_km": submission.server_min_distance_km if submission else None,
            "minimum_distance_time_sec": submission.server_min_distance_time_sec if submission else None,
            "minimum_chaser_radius_km": submission.server_min_chaser_radius_km if submission else None,
            "minimum_target_radius_km": submission.server_min_target_radius_km if submission else None,
            "mission_time_sec": submission.mission_time_sec if submission else None,
            "total_delta_v_kmps": submission.total_delta_v_kmps if submission else None,
            "total_score": submission.total_score if submission else None,
            "distance_score": submission.distance_score if submission else None,
            "time_score": submission.time_score if submission else None,
            "delta_v_score": submission.delta_v_score if submission else None,
            "penalty_score": submission.penalty_score if submission else None,
            "client_validation": submission.client_validation_json if submission else None,
            "error_message": submission.error_message if submission else None,
            "created_at": _iso(solution.created_at) if solution else _iso(scenario.created_at),
            "updated_at": _iso(solution.updated_at) if solution else _iso(scenario.updated_at),
            "validated_at": _iso(submission.validated_at) if submission else None,
        }


def export_jsonl(session: Session, **options):
    for row in iter_export_rows(session, **options):
        yield json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"


def export_csv(session: Session, **options):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=EXPORT_FIELDS)
    writer.writeheader()
    yield output.getvalue()
    for row in iter_export_rows(session, **options):
        output.seek(0)
        output.truncate(0)
        csv_row = dict(row)
        csv_row["scenario_definition"] = json.dumps(
            row["scenario_definition"], ensure_ascii=False, separators=(",", ":")
        )
        csv_row["decision_variables"] = json.dumps(
            row["decision_variables"], ensure_ascii=False, separators=(",", ":")
        )
        csv_row["burn_norms_kmps"] = json.dumps(
            row["burn_norms_kmps"], separators=(",", ":")
        )
        csv_row["client_validation"] = json.dumps(
            row["client_validation"], ensure_ascii=False, separators=(",", ":")
        )
        writer.writerow(csv_row)
        yield output.getvalue()


def _iso(value) -> str | None:
    return value.isoformat() if value else None
