from fastapi.testclient import TestClient

from app.db import initialize_database
from app.main import app, create_application


def setup_module():
    initialize_database()


def test_local_backend_is_authoritative_and_uses_single_local_validation():
    with TestClient(app) as client:
        health = client.get("/health")
        scenarios = client.get("/api/scenarios")

    assert health.status_code == 200
    assert health.json()["cloudBackend"] == "optional"
    assert health.json()["database"] == "sqlite"
    assert health.json()["nodeRole"] == "local"
    assert health.json()["validationMode"] == "single-local-gmat"
    assert scenarios.status_code == 200


def test_relay_exposes_only_health_and_replica_sync_routes():
    relay = create_application("relay")
    with TestClient(relay) as client:
        health = client.get("/health")
        changes = client.get("/api/sync/changes")
        local_settings = client.get("/api/sync/settings")
        scenarios = client.get("/api/scenarios")
        submissions = client.post("/api/submissions", json={})
        worker = client.post("/api/internal/validation/next", json={"workerId": "old"})

    assert health.json()["nodeRole"] == "relay"
    assert health.json()["validationMode"] == "none"
    assert changes.status_code == 200
    assert local_settings.status_code == 404
    assert scenarios.status_code == 404
    assert submissions.status_code == 404
    assert worker.status_code == 404
