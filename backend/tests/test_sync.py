import json

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, initialize_database, reset_database
from app.main import app
from app.models import Base, Solution, Submission
from app.services.sync_service import (
    build_records,
    find_record,
    get_sync_setting,
    import_records,
    read_changes,
    synchronize_with_peer,
)
from app.services.solution_query_service import set_solution_deleted
from tests.test_submission_flow import submission_payload


def setup_function():
    initialize_database()
    with SessionLocal() as session:
        reset_database(session)


def _create_passed_solution(client: TestClient) -> str:
    response = client.post("/api/submissions", json=submission_payload())
    assert response.status_code == 201
    return response.json()["solutionId"]


def test_incremental_change_feed_distributes_imported_records_by_cursor():
    with TestClient(app) as client:
        solution_id = _create_passed_solution(client)
    with SessionLocal() as session:
        solution_record = find_record(session, "solution", solution_id)

    replica_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(replica_engine)
    with Session(replica_engine) as relay_session:
        scenario_record = None
        with SessionLocal() as source:
            scenario_record = find_record(source, "scenario", "SC-001")
        result = import_records(relay_session, [scenario_record, solution_record])
        assert result["imported"] == 2
        first = read_changes(relay_session, after=0, limit=1)
        assert first["hasMore"] is True
        second = read_changes(relay_session, after=first["nextCursor"], limit=10)
        assert second["hasMore"] is False
        ids = [record["recordId"] for record in first["records"] + second["records"]]
        assert ids == ["SC-001", solution_id]
        empty = read_changes(relay_session, after=second["nextCursor"], limit=10)
        assert empty["records"] == []


def test_device_pushes_only_changes_after_the_first_successful_sync():
    with TestClient(app) as client:
        solution_id = _create_passed_solution(client)

    relay_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(relay_engine)

    def handler(request: httpx.Request) -> httpx.Response:
        with Session(relay_engine) as relay:
            if request.method == "GET" and request.url.path.endswith("/sync/changes"):
                return httpx.Response(200, json=read_changes(
                    relay,
                    after=int(request.url.params.get("after", 0)),
                    limit=int(request.url.params.get("limit", 500)),
                ))
            if request.method == "POST" and request.url.path.endswith("/sync/import"):
                payload = json.loads(request.content)
                return httpx.Response(200, json=import_records(relay, payload["records"]))
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)

    def client_factory(**kwargs):
        return httpx.Client(transport=transport, **kwargs)

    with SessionLocal() as local:
        setting = get_sync_setting(local)
        setting.peer_url = "https://relay.test/api"
        setting.enabled = True
        local.commit()
        first = synchronize_with_peer(local, client_factory=client_factory)
        second = synchronize_with_peer(local, client_factory=client_factory)
        set_solution_deleted(local, solution_id, True)
        third = synchronize_with_peer(local, client_factory=client_factory)

    assert first["status"] == "ok"
    assert first["pushed"] >= 1
    assert second["status"] == "ok"
    assert second["pushed"] == 0
    assert third["status"] == "ok"
    assert third["pushed"] == 1
    with Session(relay_engine) as relay:
        record = find_record(relay, "solution", solution_id)
        assert record is not None
        assert record["payload"]["deletedAt"] is not None


def test_sync_records_are_hash_verified_and_idempotent():
    with TestClient(app) as client:
        solution_id = _create_passed_solution(client)

    with SessionLocal() as session:
        solution_record = find_record(session, "solution", solution_id)
        first = import_records(session, [solution_record])
        assert first == {"imported": 0, "skipped": 1, "conflicts": []}

        tampered = {**solution_record, "payload": {**solution_record["payload"], "name": "changed"}}
        result = import_records(session, [tampered])
        assert result["imported"] == 0
        assert result["conflicts"][0]["reason"] == "Sync record content hash does not match."


def test_passed_solution_can_rebuild_an_empty_replica_and_recomputes_score(tmp_path):
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
        submission = replica.scalar(select(Submission).where(Submission.solution_id == solution_id))
        assert submission.status == "passed"
        assert submission.total_score is not None
        rebuilt = find_record(replica, "solution", solution_id)
        source = next(record for record in records if record["recordId"] == solution_id)
        assert rebuilt["contentHash"] == source["contentHash"]
