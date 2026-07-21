from fastapi.testclient import TestClient

from app.db import initialize_database
from app.main import app


def setup_module():
    initialize_database()


def test_cloud_backend_is_the_authoritative_api():
    with TestClient(app) as client:
        health = client.get("/health")
        scenarios = client.get("/api/scenarios")

    assert health.status_code == 200
    assert health.json()["cloudBackend"] == "ready"
    assert health.json()["database"] == "sqlite-development"
    assert scenarios.status_code == 200
    assert scenarios.json()["items"][0]["scenarioId"] == "SC-001"


def test_internal_worker_api_requires_the_shared_secret():
    with TestClient(app) as client:
        forbidden = client.post(
            "/api/internal/validation/next",
            json={"workerId": "worker-test"},
        )

    assert forbidden.status_code == 403
