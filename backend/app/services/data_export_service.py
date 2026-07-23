from __future__ import annotations

import csv
import io
import json

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
    "minimum_distance_km",
    "minimum_distance_time_sec",
    "mission_time_sec",
    "total_delta_v_kmps",
    "total_score",
    "created_at",
    "validated_at",
)


def iter_export_rows(session: Session, *, include_archived: bool = False):
    query = (
        select(Scenario, Solution, Submission)
        .join(Solution, Solution.scenario_id == Scenario.id)
        .outerjoin(Submission, Submission.solution_id == Solution.id)
        .order_by(Scenario.id, Solution.created_at, Submission.created_at)
        .execution_options(yield_per=500)
    )
    if not include_archived:
        query = query.where(Solution.deleted_at.is_(None))
    rows = session.execute(query)
    for scenario, solution, submission in rows:
        yield {
            "scenario_id": scenario.id,
            "scenario_name": scenario.name,
            "scenario_status": scenario.status,
            "scenario_definition": scenario.scenario_json,
            "solution_id": solution.id,
            "solution_name": solution.name,
            "solution_deleted_at": _iso(solution.deleted_at),
            "submission_id": submission.id if submission else None,
            "submission_status": submission.status if submission else None,
            "decision_variables": solution.decision_variables_json,
            "minimum_distance_km": submission.server_min_distance_km if submission else None,
            "minimum_distance_time_sec": submission.server_min_distance_time_sec if submission else None,
            "mission_time_sec": submission.mission_time_sec if submission else None,
            "total_delta_v_kmps": submission.total_delta_v_kmps if submission else None,
            "total_score": submission.total_score if submission else None,
            "created_at": _iso(solution.created_at),
            "validated_at": _iso(submission.validated_at) if submission else None,
        }


def export_jsonl(session: Session, *, include_archived: bool = False):
    for row in iter_export_rows(session, include_archived=include_archived):
        yield json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"


def export_csv(session: Session, *, include_archived: bool = False):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=EXPORT_FIELDS)
    writer.writeheader()
    yield output.getvalue()
    for row in iter_export_rows(session, include_archived=include_archived):
        output.seek(0)
        output.truncate(0)
        csv_row = dict(row)
        csv_row["scenario_definition"] = json.dumps(
            row["scenario_definition"], ensure_ascii=False, separators=(",", ":")
        )
        csv_row["decision_variables"] = json.dumps(
            row["decision_variables"], ensure_ascii=False, separators=(",", ":")
        )
        writer.writerow(csv_row)
        yield output.getvalue()


def _iso(value) -> str | None:
    return value.isoformat() if value else None
