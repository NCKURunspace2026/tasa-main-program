from __future__ import annotations

from contextlib import asynccontextmanager
import asyncio
import logging
import os

from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

from .api.leaderboard import router as leaderboard_router
from .api.data_export import router as data_export_router
from .api.scenarios import router as scenarios_router
from .api.sync import exchange_router as sync_exchange_router
from .api.sync import local_router as sync_local_router
from .api.solutions import router as solutions_router
from .api.submissions import router as submissions_router
from .db import SessionLocal, get_db, initialize_database
from .services.sync_service import synchronize_with_peer


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    sync_task = None
    if app.state.node_role != "relay":
        sync_task = asyncio.create_task(_sync_loop())
    try:
        yield
    finally:
        if sync_task:
            sync_task.cancel()


async def _sync_loop() -> None:
    interval = max(15, int(os.getenv("MISSION_DASHBOARD_SYNC_INTERVAL_SEC", "60")))
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(_sync_once)


def _sync_once() -> None:
    with SessionLocal() as session:
        result = synchronize_with_peer(session)
        if result.get("status") == "error":
            logging.getLogger(__name__).warning("Replica sync failed: %s", result.get("lastError"))


def create_application(node_role: str | None = None) -> FastAPI:
    selected_role = node_role or os.getenv("MISSION_DASHBOARD_NODE_ROLE", "local")
    dashboard = FastAPI(title="Mission Dashboard API", version="0.2.14", lifespan=lifespan)
    dashboard.state.node_role = selected_role
    dashboard.add_middleware(
        CORSMiddleware,
        # The team currently treats relay data as non-sensitive research data.
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    dashboard.include_router(sync_exchange_router)
    if selected_role != "relay":
        dashboard.include_router(sync_local_router)
        dashboard.include_router(submissions_router)
        dashboard.include_router(scenarios_router)
        dashboard.include_router(leaderboard_router)
        dashboard.include_router(solutions_router)
        dashboard.include_router(data_export_router)

    @dashboard.get("/health")
    def health_check(session: Session = Depends(get_db)):
        # Resolving the dependency also proves that this process can open SQLite.
        _ = session
        return {
            "status": "ok",
            "apiVersion": dashboard.version,
            "database": "sqlite",
            "nodeRole": selected_role,
            "cloudBackend": "relay-cache" if selected_role == "relay" else "optional",
            "validationMode": "single-local-gmat" if selected_role != "relay" else "none",
        }

    return dashboard


app = create_application()
