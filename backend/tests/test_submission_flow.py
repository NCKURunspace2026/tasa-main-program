from fastapi.testclient import TestClient

from app.db import SessionLocal, initialize_database, reset_database
from app.main import app

WORKER_HEADERS = {
    "X-Worker-Token": "test-worker-token",
}
WORKER_ID = "test-central-gmat-worker"


def submission_payload():
    return {
        "schemaVersion": 2,
        "scenarioId": "SC-001",
        "solution": {
            "name": "Manual Test 01",
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


def scenario_json():
    return {
        "schemaVersion": 1,
        "epoch": {"value": "2026-08-29T05:00:00Z", "timeSystem": "UTC"},
        "coordinateSystem": "EarthMJ2000Eq",
        "spacecraft": {"target": {}, "chaser": {}},
        "forceModel": {"centralBody": "Earth"},
        "propagator": {"integrator": "RungeKutta89"},
        "validation": {"maximumSimulationTimeSec": 20000, "requiredFinalDistanceKm": 5},
        "scoreConfig": {
            "distanceReferenceKm": 5,
            "distanceDecayKm": 100,
            "timeReferenceSec": 5000,
            "timeSlope": 0.001,
            "deltaVReferenceKmPerSec": 0.5,
            "deltaVSlope": 5,
            "distanceWeight": 50,
            "timeWeight": 25,
            "deltaVWeight": 25,
        },
    }


def setup_module():
    initialize_database()


def setup_function():
    with SessionLocal() as session:
        reset_database(session)


def test_submission_is_saved_atomically_and_queued_for_central_validation():
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=submission_payload())
        assert response.status_code == 202
        result = response.json()
        assert result["submissionId"].startswith("SUB-")
        assert result["solutionId"].startswith("SOL-")
        assert result["status"] == "accepted"
        assert result["queueStatus"] == "pending"

        saved = client.get(f"/api/submissions/{result['submissionId']}")
        assert saved.status_code == 200
        assert saved.json()["status"] == "pending"
        assert saved.json()["officialResults"] is None

        leaderboard = client.get("/api/scenarios/SC-001/leaderboard").json()
        assert leaderboard["rankingMetric"] == "totalScore"
        assert leaderboard["total"] == 0


def test_client_validation_must_have_physically_passed_before_upload():
    payload = submission_payload()
    payload["clientValidation"]["passed"] = False
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=payload)
        assert response.status_code == 422


def test_invalid_decision_variables_do_not_create_submission():
    payload = submission_payload()
    payload["solution"]["decisionVariables"]["burns"] = []
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=payload)
        assert response.status_code == 422
        assert client.get("/api/scenarios/SC-001/leaderboard").json()["total"] == 0


def test_server_can_validate_and_publish_scenario_json():
    payload = {
        "scenarioId": "SC-003",
        "name": "Rendezvous Challenge",
        "description": "Two-spacecraft test.",
        "scenarioJson": scenario_json(),
    }
    with TestClient(app) as client:
        forbidden = client.post("/api/scenarios", json=payload)
        assert forbidden.status_code == 403

        parsed = client.post("/api/scenarios/parse", json={"scenarioJson": scenario_json()})
        assert parsed.status_code == 200
        assert parsed.json()["scenarioJson"]["schemaVersion"] == 1

        created = client.post(
            "/api/scenarios",
            headers=WORKER_HEADERS,
            json=payload,
        )
        assert created.status_code == 201
        assert created.json()["scenarioId"] == "SC-003"
        assert client.get("/api/scenarios/SC-003").status_code == 200


def test_only_server_can_update_published_scenario_limits():
    with TestClient(app) as client:
        current = client.get("/api/scenarios/SC-001").json()
        definition = current["scenarioJson"]
        original_max_step = definition["propagator"]["maxStepSec"]
        definition["propagator"]["maxStepSec"] = 1.0
        payload = {
            "name": current["name"],
            "description": current["description"],
            "scenarioJson": definition,
        }

        forbidden = client.put("/api/scenarios/SC-001", json=payload)
        assert forbidden.status_code == 403

        updated = client.put(
            "/api/scenarios/SC-001",
            headers=WORKER_HEADERS,
            json=payload,
        )
        assert updated.status_code == 200
        assert updated.json()["scenarioJson"]["propagator"]["maxStepSec"] == 1.0

        definition["propagator"]["maxStepSec"] = original_max_step
        restored = client.put(
            "/api/scenarios/SC-001",
            headers=WORKER_HEADERS,
            json=payload,
        )
        assert restored.status_code == 200


def test_health_does_not_claim_unconfigured_physical_validation():
    with TestClient(app) as client:
        health = client.get("/health").json()
        assert health["validationWorker"] == "offline"
        assert health["physicalValidation"] is False


def test_central_worker_claims_scores_and_publishes_passed_submission():
    scenario_payload = {
        "scenarioId": "SC-003",
        "name": "Scored Challenge",
        "description": "Central worker integration test.",
        "scenarioJson": scenario_json(),
    }
    with TestClient(app) as client:
        assert client.post(
            "/api/scenarios",
            headers=WORKER_HEADERS,
            json=scenario_payload,
        ).status_code == 201

        payload = submission_payload()
        payload["scenarioId"] = "SC-003"
        accepted = client.post("/api/submissions", json=payload).json()

        forbidden = client.post("/api/internal/validation/next")
        assert forbidden.status_code == 403

        claimed = client.post(
            "/api/internal/validation/next",
            headers=WORKER_HEADERS,
            json={"workerId": WORKER_ID},
        ).json()["item"]
        assert claimed["submissionId"] == accepted["submissionId"]
        assert claimed["decisionVariables"]["burns"][0]["deltaV"] == [0.1, 0.2, 0.3]

        completed = client.post(
            f"/api/internal/validation/{accepted['submissionId']}/result",
            headers=WORKER_HEADERS,
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
        assert completed.status_code == 200
        assert completed.json()["status"] == "passed"
        assert completed.json()["totalScore"] > 50

        leaderboard = client.get("/api/scenarios/SC-003/leaderboard").json()
        assert leaderboard["total"] == 1
        assert leaderboard["items"][0]["solutionId"] == accepted["solutionId"]


def test_worker_heartbeat_controls_health_truthfully():
    with TestClient(app) as client:
        heartbeat = client.post(
            "/api/internal/validation/heartbeat",
            headers=WORKER_HEADERS,
            json={
                "workerId": WORKER_ID,
                "provider": "official-gmat-console",
                "gmatConfigured": True,
            },
        )
        assert heartbeat.status_code == 200
        health = client.get("/health").json()
        assert health["validationWorker"] == "ready"
        assert health["physicalValidation"] is True
