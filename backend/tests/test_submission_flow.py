import math
import re

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal, initialize_database, reset_database
from app.main import app
from app.models import Submission

ADMIN_HEADERS = {"X-Mission-Dashboard-Admin-Token": "test-admin-token"}


def scenario_json():
    return {
        "schemaVersion": 1,
        "epoch": {"value": "2026-08-29T05:00:00Z", "timeSystem": "UTC"},
        "coordinateSystem": "EarthMJ2000Eq",
        "spacecraft": {
            "target": {"positionKm": [7000, 0, 0], "velocityKmPerSec": [0, 7.5, 0]},
            "chaser": {"positionKm": [6990, 0, 0], "velocityKmPerSec": [0, 7.6, 0]},
        },
        "forceModel": {"centralBody": "Earth"},
        "propagator": {
            "integrator": "RungeKutta89",
            "initialStepSec": 1,
            "maxStepSec": 1,
            "minStepSec": 0.001,
            "accuracy": 1e-12,
        },
        "validation": {
            "maximumMissionTimeSec": 20000,
            "requiredFinalDistanceKm": 5,
            "maximumTotalDeltaV": 1.5,
            "minimumBurnCount": 1,
            "maximumBurnCount": 5,
            "minimumBurnSeparationSec": 100,
        },
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


def submission_payload():
    delta_v = [0.1, 0.2, 0.3]
    return {
        "schemaVersion": 2,
        "scenarioId": "SC-001",
        "solution": {
            "name": "Manual Test 01",
            "decisionVariables": {
                "tWait": 0,
                "burns": [{"deltaV": delta_v}],
                "finalCoastTime": 5000,
            },
        },
        "clientValidation": {
            "passed": True,
            "provider": "local-gmat-console",
            "minimumDistanceKm": 4.8,
            "minimumDistanceTimeSec": 1234.5,
            "minimumChaserRadiusKm": 7000,
            "minimumTargetRadiusKm": 7000,
            "missionTimeSec": 5000,
            "totalDeltaVKmPerSec": math.hypot(*delta_v),
        },
    }


def setup_module():
    initialize_database()


def setup_function():
    with SessionLocal() as session:
        reset_database(session)


def test_local_gmat_result_is_scored_saved_and_ranked_without_second_worker():
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=submission_payload())
        assert response.status_code == 201
        result = response.json()
        assert result["status"] == "passed"
        assert result["officialResults"]["totalScore"] > 0
        assert result["officialResults"]["minimumDistanceTimeSec"] == 1234.5

        saved = client.get(f"/api/submissions/{result['submissionId']}").json()
        assert saved["status"] == "passed"
        assert saved["officialResults"]["minimumDistanceTimeSec"] == 1234.5
        leaderboard = client.get("/api/scenarios/SC-001/leaderboard").json()
        assert leaderboard["total"] == 1
        assert leaderboard["items"][0]["solutionId"] == result["solutionId"]
        assert leaderboard["items"][0]["minimumDistance"] == 4.8
        assert leaderboard["items"][0]["minimumDistanceTime"] == 1234.5
        assert "finalDistance" not in leaderboard["items"][0]
        detail = client.get(f"/api/solutions/{result['solutionId']}").json()
        assert detail["officialResults"]["minimumDistance"] == 4.8
        assert detail["officialResults"]["minimumDistanceTime"] == 1234.5
        assert "finalDistance" not in detail["officialResults"]


def test_unvalidated_or_inconsistent_client_result_is_rejected():
    payload = submission_payload()
    payload["clientValidation"]["passed"] = False
    with TestClient(app) as client:
        assert client.post("/api/submissions", json=payload).status_code == 422

        payload = submission_payload()
        payload["clientValidation"]["totalDeltaVKmPerSec"] = 0.1
        assert client.post("/api/submissions", json=payload).status_code == 422
        assert client.get("/api/scenarios/SC-001/leaderboard").json()["total"] == 0


def test_delta_v_limit_applies_per_burn_not_total_delta_v():
    payload = submission_payload()
    payload["solution"]["decisionVariables"] = {
        "tWait": 0,
        "burns": [
            {"deltaV": [1.0, 0, 0], "timeToNextBurn": 100},
            {"deltaV": [1.0, 0, 0]},
        ],
        "finalCoastTime": 5000,
    }
    payload["clientValidation"]["missionTimeSec"] = 5100
    payload["clientValidation"]["totalDeltaVKmPerSec"] = 2.0
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=payload)
        assert response.status_code == 201


def test_delta_v_limit_rejects_single_burn_above_limit():
    payload = submission_payload()
    payload["solution"]["decisionVariables"]["burns"] = [{"deltaV": [1.6, 0, 0]}]
    payload["clientValidation"]["totalDeltaVKmPerSec"] = 1.6
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=payload)
        assert response.status_code == 422
        assert "per-burn" in response.json()["detail"]


def test_spacecraft_radius_below_central_body_is_rejected():
    payload = submission_payload()
    payload["clientValidation"]["minimumChaserRadiusKm"] = 6000
    with TestClient(app) as client:
        response = client.post("/api/submissions", json=payload)
        assert response.status_code == 422
        assert "central body" in response.json()["detail"]


def test_existing_solution_revalidation_updates_minimum_distance_time_and_decision_variables():
    payload = submission_payload()
    payload["clientValidation"]["minimumDistanceTimeSec"] = None
    with TestClient(app) as client:
        created = client.post("/api/submissions", json=payload)
        assert created.status_code == 201
        solution_id = created.json()["solutionId"]

        repaired_decision = payload["solution"]["decisionVariables"] | {"finalCoastTime": 4800}
        repaired = client.post(f"/api/solutions/{solution_id}/revalidate", json={
            "decisionVariables": repaired_decision,
            "clientValidation": {
                "passed": True,
                "provider": "local-gmat-console",
                "minimumDistanceKm": 4.2,
                "minimumDistanceTimeSec": 4800,
                "minimumChaserRadiusKm": 7000,
                "minimumTargetRadiusKm": 7000,
                "missionTimeSec": 4800,
                "totalDeltaVKmPerSec": payload["clientValidation"]["totalDeltaVKmPerSec"],
            },
        })
        assert repaired.status_code == 200
        detail = repaired.json()
        assert detail["solutionId"] == solution_id
        assert detail["finalDecisionVariables"]["finalCoastTime"] == 4800
        assert detail["officialResults"]["minimumDistance"] == 4.2
        assert detail["officialResults"]["minimumDistanceTime"] == 4800
        leaderboard = client.get("/api/scenarios/SC-001/leaderboard").json()
        assert leaderboard["items"][0]["minimumDistanceTime"] == 4800


def test_scenario_publish_normalizes_force_model_and_physical_properties():
    definition = scenario_json()
    definition["forceModel"] = {
        "centralBody": "Earth",
        "gravity": {"enabled": True, "degree": 4, "order": 2},
        "pointMasses": ["Sun", "Luna"],
        "drag": {"enabled": True, "model": "JacchiaRoberts"},
        "solarRadiationPressure": {"enabled": True},
        "relativisticCorrection": {"enabled": True},
    }
    with TestClient(app) as client:
        created = client.post("/api/scenarios", json={
            "name": "Rendezvous Challenge",
            "description": "Two-spacecraft test.",
            "scenarioJson": definition,
        })
        assert created.status_code == 201
        assert re.fullmatch(r"SC-\d{12}", created.json()["scenarioId"])
        saved = created.json()["scenarioJson"]
        assert saved["forceModel"]["gravity"]["degree"] == 4
        assert saved["forceModel"]["pointMasses"] == ["Sun", "Luna"]
        assert saved["spacecraft"]["chaser"]["physicalProperties"]["dryMassKg"] == 850

        invalid = scenario_json()
        invalid["propagator"]["minStepSec"] = 2
        response = client.post("/api/scenarios", json={
            "name": "Invalid",
            "scenarioJson": invalid,
        })
        assert response.status_code == 422


def test_scenario_update_can_rename_existing_scenario():
    with TestClient(app) as client:
        response = client.put("/api/scenarios/SC-001", json={
            "name": "Renamed Scenario",
            "description": "Updated description.",
            "scenarioJson": scenario_json(),
        })
        assert response.status_code == 200
        assert response.json()["scenarioId"] == "SC-001"
        assert response.json()["name"] == "Renamed Scenario"
        assert response.json()["description"] == "Updated description."


def test_scenario_update_recomputes_existing_leaderboard_results():
    scenario_id = "SC-999"
    payload = submission_payload()
    payload["scenarioId"] = scenario_id
    with TestClient(app) as client:
        scenario = client.post("/api/scenarios", json={
            "scenarioId": scenario_id,
            "name": "Recompute Scenario",
            "description": "Dedicated test Scenario.",
            "scenarioJson": scenario_json(),
        })
        assert scenario.status_code == 201
        created = client.post("/api/submissions", json=payload)
        assert created.status_code == 201
        solution_id = created.json()["solutionId"]
        assert client.get(f"/api/scenarios/{scenario_id}/leaderboard").json()["total"] == 1

        updated_definition = scenario_json()
        updated_definition["validation"]["requiredFinalDistanceKm"] = 4.0
        updated_definition["scoreConfig"]["distanceReferenceKm"] = 4.0
        response = client.put(f"/api/scenarios/{scenario_id}", json={
            "name": "Stricter Scenario",
            "description": "Old close approaches no longer pass.",
            "scenarioJson": updated_definition,
        })
        assert response.status_code == 200

        leaderboard = client.get(f"/api/scenarios/{scenario_id}/leaderboard").json()
        assert leaderboard["total"] == 0
        detail = client.get(f"/api/solutions/{solution_id}").json()
        assert detail["status"] == "failed"
        assert detail["officialResults"]["officialScore"] is None


def test_scenario_update_marks_legacy_rows_missing_radius_metrics_failed():
    with TestClient(app) as client:
        created = client.post("/api/submissions", json=submission_payload())
        assert created.status_code == 201
        solution_id = created.json()["solutionId"]

        with SessionLocal() as session:
            submission = session.scalar(select(Submission).where(Submission.solution_id == solution_id))
            submission.server_min_chaser_radius_km = None
            submission.server_min_target_radius_km = None
            submission.client_validation_json.pop("minimumChaserRadiusKm", None)
            submission.client_validation_json.pop("minimumTargetRadiusKm", None)
            session.commit()

        response = client.put("/api/scenarios/SC-001", json={
            "name": "Radius Recompute Scenario",
            "description": "Forces recompute of legacy rows.",
            "scenarioJson": scenario_json(),
        })
        assert response.status_code == 200
        assert client.get("/api/scenarios/SC-001/leaderboard").json()["total"] == 0
        detail = client.get(f"/api/solutions/{solution_id}").json()
        assert detail["status"] == "failed"


def test_scenario_can_be_soft_deleted_with_admin_token():
    with TestClient(app) as client:
        assert client.delete("/api/scenarios/SC-001").status_code == 403
        deleted = client.delete("/api/scenarios/SC-001", headers=ADMIN_HEADERS)
        assert deleted.status_code == 200
        assert deleted.json()["status"] == "inactive"
        assert client.get("/api/scenarios").json()["items"] == []
        assert client.get("/api/scenarios/SC-001").status_code == 404
        assert client.post("/api/submissions", json=submission_payload()).status_code == 404
        assert client.post("/api/scenarios/SC-001/restore").status_code == 404
        assert client.post("/api/scenarios/parse", json={"scenarioJson": scenario_json()}).status_code == 405


def test_solution_archive_is_excluded_from_ml_export_unless_explicitly_requested():
    with TestClient(app) as client:
        result = client.post("/api/submissions", json=submission_payload()).json()
        solution_id = result["solutionId"]
        assert client.delete(f"/api/solutions/{solution_id}").status_code == 403
        assert client.delete(f"/api/solutions/{solution_id}", headers=ADMIN_HEADERS).status_code == 200
        assert client.get("/api/scenarios/SC-001/leaderboard").json()["total"] == 0
        assert client.get(f"/api/solutions/{solution_id}").status_code == 404
        assert solution_id not in client.get("/api/data/export?format=jsonl").text
        assert solution_id not in client.get("/api/data/export?format=csv").text
        assert solution_id in client.get(
            "/api/data/export?format=jsonl&includeArchived=true"
        ).text
        assert solution_id in client.get(
            "/api/data/export?format=csv&includeArchived=true"
        ).text
        assert client.post(f"/api/solutions/{solution_id}/restore").status_code == 404
