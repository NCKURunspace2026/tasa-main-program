import json
import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .models import Base, Scenario


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = BACKEND_ROOT / "data" / "main.db"
DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def _normalize_database_url(value: str) -> str:
    # Neon supplies a standard postgresql:// URL. Select SQLAlchemy's psycopg 3
    # driver explicitly so Cloud does not depend on the legacy psycopg2 package.
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+psycopg://", 1)
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


DATABASE_URL = _normalize_database_url(
    os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")
)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        yield session


def initialize_database() -> None:
    Base.metadata.create_all(engine)
    _add_queue_lease_columns_for_existing_database()
    with SessionLocal.begin() as session:
        definition_path = BACKEND_ROOT / "docs" / "scenarios" / "small-challenge-v1.json"
        definition = json.loads(definition_path.read_text())
        scenario = session.get(Scenario, "SC-001")
        if scenario is None:
            session.add(Scenario(
                id="SC-001",
                name=definition.get("name", "LEO Interception"),
                description=definition.get("description", ""),
                scenario_json=definition,
                schema_version=int(float(definition.get("schemaVersion", 1))),
                status="active",
            ))
        elif not all(
            key in (scenario.scenario_json or {})
            for key in ("spacecraft", "propagator", "validation", "scoreConfig")
        ):
            scenario.name = definition.get("name", scenario.name)
            scenario.description = definition.get("description", scenario.description)
            scenario.scenario_json = definition
            scenario.schema_version = int(float(definition.get("schemaVersion", 1)))
            scenario.status = "active"
        else:
            # Migrate the original SC-001 propagation defaults without
            # overwriting limits that a Server operator has already customized.
            scenario_definition = dict(scenario.scenario_json)
            propagator = dict(scenario_definition.get("propagator", {}))
            if (
                propagator.get("initialStepSec") == 60.0
                and propagator.get("maxStepSec") == 60.0
            ):
                propagator["initialStepSec"] = 1.0
                propagator["maxStepSec"] = 1.0
                scenario_definition["propagator"] = propagator
                scenario.scenario_json = scenario_definition


def _add_queue_lease_columns_for_existing_database() -> None:
    """Small forward-only migration for pre-Neon development databases.

    A fresh Neon database is created from SQLAlchemy metadata. This keeps an
    existing local SQLite database usable without retaining it as production
    state. A full migration framework can replace this once the schema grows.
    """
    existing = {column["name"] for column in inspect(engine).get_columns("submissions")}
    additions = {
        "claimed_at": "TIMESTAMP",
        "lease_expires_at": "TIMESTAMP",
        "claimed_by_worker_id": "VARCHAR(96)",
        "claim_token": "VARCHAR(64)",
        "attempt_count": "INTEGER NOT NULL DEFAULT 0",
    }
    with engine.begin() as connection:
        for name, data_type in additions.items():
            if name not in existing:
                connection.execute(text(
                    f"ALTER TABLE submissions ADD COLUMN {name} {data_type}"
                ))


def reset_database(session: Session) -> None:
    for table in reversed(Base.metadata.sorted_tables):
        if table.name != "scenarios":
            session.execute(table.delete())
    session.query(Scenario).filter(Scenario.id != "SC-001").delete(synchronize_session=False)
    session.commit()
