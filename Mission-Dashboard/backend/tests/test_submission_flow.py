import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

TEST_DATABASE_PATH = Path(tempfile.gettempdir()) / "mission_dashboard_tests.db"
TEST_DATABASE_PATH.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE_PATH}"

from app.db import SessionLocal, initialize_database, reset_database
from app.main import app


def manual_payload(delta_v=(0.1, 0.2, 0.3)):
    return {
        "schemaVersion": "1.1",
        "scenarioId": "SC-001",
        "solution": {
            "name": "Manual Test 01",
            "type": "manual",
            "notes": "API integration test",
        },
        "optimization": None,
        "finalDecisionVariables": {
            "tWait": 0,
            "burns": [{"deltaV": list(delta_v)}],
            "finalCoastTime": 5000,
        },
    }


def setup_module():
    initialize_database()


def setup_function():
    with SessionLocal() as session:
        reset_database(session)


def test_mock_submission_never_creates_solution_or_leaderboard_entry():
    with TestClient(app) as client:
        response = client.post(
            "/api/submissions",
            headers={"X-Input-Type": "manual"},
            json=manual_payload(),
        )
        assert response.status_code == 200
        result = response.json()
        assert result["submissionId"].startswith("SUB-")
        assert result["solutionId"] is None
        assert result["status"] == "mock-not-physical"

        leaderboard = client.get("/api/scenarios/SC-001/leaderboard").json()
        assert leaderboard["rankingMetric"] == "officialScore"
        assert leaderboard["total"] == 0


def test_schema_failure_does_not_create_submission():
    payload = manual_payload()
    payload["finalDecisionVariables"]["burns"] = []
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=payload)
        assert response.status_code == 422
        leaderboard = client.get("/api/scenarios/SC-001/leaderboard").json()
        assert leaderboard["total"] == 0


def test_constraint_failure_keeps_submission_without_solution():
    with TestClient(app) as client:
        response = client.post(
            "/api/submissions",
            headers={"X-Input-Type": "manual"},
            json=manual_payload((5.0, 0.0, 0.0)),
        )
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "mock-not-physical"
        assert result["solutionId"] is None

        saved = client.get(f"/api/submissions/{result['submissionId']}")
        assert saved.status_code == 200
        assert saved.json()["status"] == "mock-not-physical"
        leaderboard = client.get("/api/scenarios/SC-001/leaderboard").json()
        assert leaderboard["total"] == 0


def test_final_burn_cannot_have_time_to_next_burn():
    payload = manual_payload()
    payload["finalDecisionVariables"]["burns"][0]["timeToNextBurn"] = 10
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=payload)
        assert response.status_code == 422


def test_server_can_publish_scenario_for_submission_devices():
    payload = {
        "scenarioId": "SC-003",
        "name": "Lunar Transfer Challenge",
        "description": "Reach the target lunar orbit.",
        "definition": {
            "frame": "EarthMJ2000Eq",
            "units": {"distance": "km", "time": "s"},
        },
    }
    with TestClient(app) as client:
        forbidden = client.post("/api/scenarios", json=payload)
        assert forbidden.status_code == 403

        created = client.post(
            "/api/scenarios",
            headers={"X-Device-Role": "server"},
            json=payload,
        )
        assert created.status_code == 201
        assert created.json()["scenarioId"] == "SC-003"

        scenarios = client.get("/api/scenarios").json()["items"]
        assert any(item["scenarioId"] == "SC-003" for item in scenarios)

        submission_payload = manual_payload()
        submission_payload["scenarioId"] = "SC-003"
        submission = client.post(
            "/api/submissions",
            headers={"X-Input-Type": "manual"},
            json=submission_payload,
        )
        assert submission.status_code == 200
        assert submission.json()["solutionId"] is None


def test_server_can_persist_gmat_api_url():
    with TestClient(app) as client:
        forbidden = client.put(
            "/api/settings/validation",
            json={"gmatApiUrl": "http://127.0.0.1:9000"},
        )
        assert forbidden.status_code == 403

        updated = client.put(
            "/api/settings/validation",
            headers={"X-Device-Role": "server"},
            json={"gmatApiUrl": "http://127.0.0.1:9000/"},
        )
        assert updated.status_code == 200
        assert updated.json()["gmatApiUrl"] == "http://127.0.0.1:9000"
        assert updated.json()["validationProvider"] == "mock-validation-not-physical"

        saved = client.get("/api/settings/validation")
        assert saved.json()["gmatApiUrl"] == "http://127.0.0.1:9000"
