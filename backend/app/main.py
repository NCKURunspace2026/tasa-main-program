from contextlib import asynccontextmanager
import asyncio
import logging
import os

from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

from .api.leaderboard import router as leaderboard_router
from .api.internal_validation import router as internal_validation_router
from .api.data_export import router as data_export_router
from .api.scenarios import router as scenarios_router
from .api.sync import router as sync_router
from .api.solutions import router as solutions_router
from .api.submissions import router as submissions_router
from .db import SessionLocal, get_db, initialize_database
from .services.sync_service import synchronize_with_peer
from .services.worker_status_service import get_worker_status


class QuietWorkerPollingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not (
            '"POST /api/internal/validation/heartbeat ' in message
            or '"POST /api/internal/validation/next ' in message
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("uvicorn.access").addFilter(QuietWorkerPollingFilter())
    initialize_database()
    sync_task = None
    if os.getenv("MISSION_DASHBOARD_NODE_ROLE", "local") != "relay":
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


app = FastAPI(title="Mission Dashboard API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    # Authentication is not implemented yet. Allow the Electron file origin and
    # LAN browser clients during this pre-auth deployment phase.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(submissions_router)
app.include_router(scenarios_router)
app.include_router(leaderboard_router)
app.include_router(solutions_router)
app.include_router(internal_validation_router)
app.include_router(data_export_router)
app.include_router(sync_router)


@app.get("/health")
def health_check(session: Session = Depends(get_db)):
    node_role = os.getenv("MISSION_DASHBOARD_NODE_ROLE", "local")
    return {
        "status": "ok",
        "database": "postgresql" if session.bind.dialect.name == "postgresql" else "sqlite",
        "nodeRole": node_role,
        "cloudBackend": "relay-cache" if node_role == "relay" else "optional",
        **get_worker_status(session),
    }
