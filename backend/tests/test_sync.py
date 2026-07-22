from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, initialize_database, reset_database
from app.main import app
from app.models import Base, Solution, Submission
from app.services.sync_service import build_records, find_record, import_records

WORKER_ID = "test-sync-worker"


def submission_payload():
    return {
        "schemaVersion": 2,
        "scenarioId": "SC-001",
        "solution": {
            "name": "Sync Test",
            "decisionVariables": {
                "tWait": 0,
                "burns": [{"deltaV": [0.1, 0.2, 0.3]}],
                "finalCoastTime": 5000,
            },
        },
        "clientValidation": {
            "passed": True,
            "provider": "local-gmat-console",
            "minimumDistanceKm": 4.8,
            "missionTimeSec": 5000,
            "totalDeltaVKmPerSec": 0.374,
        },
    }


def setup_function():
    initialize_database()
    with SessionLocal() as session:
        reset_database(session)


def _create_passed_solution(client: TestClient) -> str:
    accepted = client.post("/api/submissions", json=submission_payload()).json()
    claimed = client.post(
        "/api/internal/validation/next", json={"workerId": WORKER_ID}
    ).json()["item"]
    response = client.post(
        f"/api/internal/validation/{accepted['submissionId']}/result",
        json={
            "status": "passed",
            "workerId": WORKER_ID,
            "claimToken": claimed["claimToken"],
            "provider": "official-gmat-console",
            "minimumDistanceKm": 4.8,
            "missionTimeSec": 5000,
            "totalDeltaVKmPerSec": 0.374,
            "penaltyScore": 0,
        },
    )
    assert response.status_code == 200
    return accepted["solutionId"]


def test_sync_only_exposes_scenarios_and_passed_solutions():
    with TestClient(app) as client:
        pending = client.post("/api/submissions", json=submission_payload()).json()
        manifest = client.get("/api/sync/manifest").json()
        assert not any(
            item["recordId"] == pending["solutionId"] for item in manifest["records"]
        )

        claimed = client.post(
            "/api/internal/validation/next", json={"workerId": WORKER_ID}
        ).json()["item"]
        client.post(
            f"/api/internal/validation/{pending['submissionId']}/result",
            json={
                "status": "failed",
                "workerId": WORKER_ID,
                "claimToken": claimed["claimToken"],
                "provider": "official-gmat-console",
                "errorMessage": "constraint failed",
            },
        )
        manifest = client.get("/api/sync/manifest").json()
        assert not any(
            item["recordId"] == pending["solutionId"] for item in manifest["records"]
        )

        passed_id = _create_passed_solution(client)
        manifest = client.get("/api/sync/manifest").json()
        assert any(item["recordId"] == passed_id for item in manifest["records"])


def test_sync_records_are_hash_verified_and_idempotent():
    with TestClient(app) as client:
        solution_id = _create_passed_solution(client)

    with SessionLocal() as session:
        records = build_records(session)
        solution_record = next(
            record for record in records if record["recordId"] == solution_id
        )
        first = import_records(session, [solution_record])
        assert first == {"imported": 0, "skipped": 1, "conflicts": []}

        tampered = {**solution_record, "payload": {**solution_record["payload"], "name": "changed"}}
        result = import_records(session, [tampered])
        assert result["imported"] == 0
        assert result["conflicts"][0]["reason"] == "Sync record content hash does not match."


def test_passed_solution_can_rebuild_an_empty_replica(tmp_path):
    with TestClient(app) as client:
        solution_id = _create_passed_solution(client)
    with SessionLocal() as source:
        records = build_records(source)

    replica_engine = create_engine(f"sqlite:///{tmp_path / 'replica.db'}")
    Base.metadata.create_all(replica_engine)
    with Session(replica_engine) as replica:
        result = import_records(replica, records)
        assert result["conflicts"] == []
        assert replica.get(Solution, solution_id) is not None
        submission = replica.scalar(
            select(Submission).where(Submission.solution_id == solution_id)
        )
        assert submission.status == "passed"
        assert submission.total_score is not None
        rebuilt = find_record(replica, "solution", solution_id)
        source = next(record for record in records if record["recordId"] == solution_id)
        assert rebuilt["contentHash"] == source["contentHash"]
