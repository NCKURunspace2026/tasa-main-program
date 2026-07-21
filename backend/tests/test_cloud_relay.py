import os

import httpx
from fastapi.testclient import TestClient

from cloud_relay.main import create_app


os.environ["CENTRAL_SERVER_URL"] = "http://central.test"


def test_health_reports_cloud_and_central_server_status():
    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://central.test/health"
        return httpx.Response(200, json={
            "status": "ok",
            "database": "ok",
            "validationWorker": "ready",
            "physicalValidation": True,
        })

    with TestClient(create_app(httpx.MockTransport(upstream))) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["cloudRelay"] == "ready"
    assert response.json()["centralServer"] == "ready"


def test_public_api_is_forwarded_without_server_privilege_headers():
    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://central.test/api/scenarios?page=2"
        assert "x-device-role" not in request.headers
        assert "x-worker-token" not in request.headers
        return httpx.Response(200, json={"items": []})

    with TestClient(create_app(httpx.MockTransport(upstream))) as client:
        response = client.get(
            "/api/scenarios?page=2",
            headers={"X-Device-Role": "server", "X-Worker-Token": "forged"},
        )

    assert response.status_code == 200
    assert response.json() == {"items": []}


def test_internal_worker_api_is_never_exposed_by_cloud():
    def should_not_run(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("Private route must not reach the central Server.")

    with TestClient(create_app(httpx.MockTransport(should_not_run))) as client:
        response = client.post("/api/internal/validation/next")

    assert response.status_code == 404


def test_unreachable_central_server_returns_service_unavailable():
    def unavailable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with TestClient(create_app(httpx.MockTransport(unavailable))) as client:
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["detail"]["message"] == "Central Server is unreachable."
