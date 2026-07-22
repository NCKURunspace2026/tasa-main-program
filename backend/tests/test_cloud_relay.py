from fastapi.testclient import TestClient

from app.db import initialize_database
from app.main import app


def setup_module():
    initialize_database()


def test_local_backend_is_authoritative_and_cloud_is_optional():
    with TestClient(app) as client:
        health = client.get("/health")
        scenarios = client.get("/api/scenarios")

    assert health.status_code == 200
    assert health.json()["cloudBackend"] == "optional"
    assert health.json()["database"] == "sqlite"
    assert health.json()["nodeRole"] == "local"
    assert scenarios.status_code == 200
    assert scenarios.json()["items"][0]["scenarioId"] == "SC-001"


def test_internal_worker_api_accepts_a_team_worker_without_shared_secret():
    with TestClient(app) as client:
        response = client.post(
            "/api/internal/validation/next",
            json={"workerId": "worker-test"},
        )

    assert response.status_code == 200
    assert response.json() == {"item": None}
