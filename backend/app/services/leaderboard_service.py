from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..repositories.submission_repository import find_passed_by_scenario


def get_leaderboard(
    session: Session,
    scenario_id: str,
    page: int,
    page_size: int,
    search: Optional[str],
) -> dict:
    ranked = []
    for rank, (submission, solution) in enumerate(
        find_passed_by_scenario(session, scenario_id), start=1
    ):
        item = {
            "rank": rank,
            "solutionId": solution.id,
            "solutionName": solution.name,
            "officialScore": submission.total_score,
            "finalDistance": submission.server_min_distance_km,
            "totalDeltaV": submission.total_delta_v_kmps,
            "totalTime": submission.mission_time_sec,
            "burnCount": len(solution.decision_variables_json.get("burns", [])),
            "status": submission.status,
        }
        if search and search.lower() not in f"{solution.id} {solution.name}".lower():
            continue
        ranked.append(item)

    start = (page - 1) * page_size
    return {
        "scenarioId": scenario_id,
        "rankingMetric": "totalScore",
        "total": len(ranked),
        "page": page,
        "pageSize": page_size,
        "items": ranked[start:start + page_size],
    }
