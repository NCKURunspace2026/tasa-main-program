from contextlib import asynccontextmanager
import logging

from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

from .api.leaderboard import router as leaderboard_router
from .api.internal_validation import router as internal_validation_router
from .api.data_export import router as data_export_router
from .api.scenarios import router as scenarios_router
from .api.solutions import router as solutions_router
from .api.submissions import router as submissions_router
from .db import get_db, initialize_database
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
    del app
    logging.getLogger("uvicorn.access").addFilter(QuietWorkerPollingFilter())
    initialize_database()
    yield


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


@app.get("/health")
def health_check(session: Session = Depends(get_db)):
    return {
        "status": "ok",
        "database": "neon" if session.bind.dialect.name == "postgresql" else "sqlite-development",
        "cloudBackend": "ready",
        **get_worker_status(session),
    }
