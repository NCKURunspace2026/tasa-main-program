from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..repositories.submission_repository import count_passed_by_scenario, find_passed_by_scenario


def get_leaderboard(
    session: Session,
    scenario_id: str,
    page: int,
    page_size: int,
    search: Optional[str],
) -> dict:
    start = (page - 1) * page_size
    ranked = []
    for rank, (submission, solution) in enumerate(
        find_passed_by_scenario(
            session,
            scenario_id,
            offset=start,
            limit=page_size,
            search=search,
        ),
        start=start + 1,
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
        ranked.append(item)

    return {
        "scenarioId": scenario_id,
        "rankingMetric": "totalScore",
        "total": count_passed_by_scenario(session, scenario_id, search),
        "page": page,
        "pageSize": page_size,
        "items": ranked,
    }
