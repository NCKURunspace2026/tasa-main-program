from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import OptimizationRun, Solution


def get_leaderboard(
    session: Session,
    scenario_id: str,
    page: int,
    page_size: int,
    search: Optional[str],
    method: Optional[str],
) -> dict:
    rows = session.execute(
        select(Solution, OptimizationRun)
        .outerjoin(OptimizationRun, OptimizationRun.solution_id == Solution.id)
        .where(
            Solution.scenario_id == scenario_id,
            Solution.validation_status == "validated",
        )
        .order_by(Solution.official_score.desc(), Solution.id.asc())
    ).all()

    ranked = []
    for rank, (solution, optimization) in enumerate(rows, start=1):
        item = {
            "rank": rank,
            "solutionId": solution.public_id,
            "solutionName": solution.solution_name,
            "method": optimization.method_name if optimization else _manual_method(solution.solution_type),
            "officialScore": solution.official_score,
            "finalDistance": solution.final_distance,
            "totalDeltaV": solution.total_delta_v,
            "totalTime": solution.total_time,
            "burnCount": solution.burn_count,
            "status": solution.validation_status,
        }
        if search and search.lower() not in f"{item['solutionId']} {item['solutionName']}".lower():
            continue
        if method and method.lower() not in item["method"].lower():
            continue
        ranked.append(item)

    start = (page - 1) * page_size
    return {
        "scenarioId": scenario_id,
        "rankingMetric": "officialScore",
        "total": len(ranked),
        "page": page,
        "pageSize": page_size,
        "items": ranked[start : start + page_size],
    }


def _manual_method(solution_type: str) -> str:
    return {
        "manual": "Manual",
        "direct": "Direct",
        "other": "Custom",
    }.get(solution_type, "Manual")
