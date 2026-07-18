from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.leaderboard import router as leaderboard_router
from .api.scenarios import router as scenarios_router
from .api.settings import router as settings_router
from .api.solutions import router as solutions_router
from .api.submissions import router as submissions_router
from .db import initialize_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
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
app.include_router(settings_router)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "validationProvider": "mock-validation-not-physical",
        "physicalValidation": False,
    }
