from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response


UPSTREAM_ENV = "CENTRAL_SERVER_URL"
HOP_BY_HOP_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}
PRIVATE_CLIENT_HEADERS = {"x-device-role", "x-worker-token"}


def _central_server_url() -> str | None:
    value = os.getenv(UPSTREAM_ENV, "").strip().rstrip("/")
    if not value:
        return None
    if not value.startswith(("http://", "https://")):
        raise RuntimeError(f"{UPSTREAM_ENV} must use HTTP or HTTPS.")
    return value


def _forward_headers(request: Request) -> dict[str, str]:
    return {
        name: value
        for name, value in request.headers.items()
        if name.lower() not in HOP_BY_HOP_HEADERS | PRIVATE_CLIENT_HEADERS
    }


def _response_headers(response: httpx.Response) -> dict[str, str]:
    return {
        name: value
        for name, value in response.headers.items()
        if name.lower() not in HOP_BY_HOP_HEADERS
    }


def create_app(transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.central_server_url = _central_server_url()
        app.state.http_client = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(30.0, connect=5.0),
            follow_redirects=False,
        )
        yield
        await app.state.http_client.aclose()

    def require_central_server(request: Request) -> str:
        central_server_url = request.app.state.central_server_url
        if not central_server_url:
            raise HTTPException(
                status_code=503,
                detail={"message": f"{UPSTREAM_ENV} is not configured."},
            )
        return central_server_url

    relay = FastAPI(
        title="Mission Dashboard Cloud Relay",
        version="0.1.0",
        lifespan=lifespan,
    )
    relay.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @relay.get("/health")
    async def health(request: Request):
        central_server_url = require_central_server(request)
        try:
            upstream = await request.app.state.http_client.get(
                f"{central_server_url}/health"
            )
            payload = upstream.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(
                status_code=503,
                detail={"message": "Central Server is unreachable.", "reason": str(error)},
            ) from error
        if upstream.status_code != 200 or payload.get("status") != "ok":
            raise HTTPException(
                status_code=503,
                detail={"message": "Central Server health check failed."},
            )
        return {
            **payload,
            "status": "ok",
            "cloudRelay": "ready",
            "centralServer": "ready",
        }

    @relay.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )
    async def forward_api(path: str, request: Request):
        if path == "internal" or path.startswith("internal/"):
            raise HTTPException(status_code=404, detail="Route not found.")
        central_server_url = require_central_server(request)
        try:
            upstream = await request.app.state.http_client.request(
                method=request.method,
                url=f"{central_server_url}/api/{path}",
                params=request.query_params,
                headers=_forward_headers(request),
                content=await request.body(),
            )
        except httpx.HTTPError as error:
            raise HTTPException(
                status_code=503,
                detail={"message": "Central Server request failed.", "reason": str(error)},
            ) from error
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers=_response_headers(upstream),
            media_type=upstream.headers.get("content-type"),
        )

    return relay


app = create_app()
