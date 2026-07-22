import json
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .models import Base, Scenario


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = BACKEND_ROOT / "data" / "main.db"
DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
BUILTIN_SCENARIO_TIMESTAMP = datetime(2000, 1, 1, tzinfo=timezone.utc)

configured_data_dir = os.getenv("MISSION_DASHBOARD_DATA_DIR")
database_path = (
    Path(configured_data_dir).expanduser().resolve() / "main.db"
    if configured_data_dir
    else DEFAULT_DB_PATH
)
database_path.parent.mkdir(parents=True, exist_ok=True)
node_role = os.getenv("MISSION_DASHBOARD_NODE_ROLE", "local")
# FastAPI Cloud may keep an integration-managed DATABASE_URL that cannot be
# edited through the CLI. Relay mode deliberately ignores it so Neon is never
# read or written; the Cloud copy is a reconstructible /tmp cache.
configured_database_url = os.getenv("DATABASE_URL", f"sqlite:///{database_path}")
DATABASE_URL = (
    "sqlite:////tmp/mission-dashboard-relay.db"
    if node_role == "relay"
    else configured_database_url
)
if not DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("Mission Dashboard local-first storage requires a SQLite DATABASE_URL.")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)


if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        yield session


def initialize_database() -> None:
    Base.metadata.create_all(engine)
    _add_queue_lease_columns_for_existing_database()
    _add_soft_delete_columns_for_existing_database()
    _add_sync_columns_for_existing_database()
    with SessionLocal.begin() as session:
        definition_path = BACKEND_ROOT / "docs" / "scenarios" / "small-challenge-v1.json"
        definition = json.loads(definition_path.read_text(encoding="utf-8"))
        scenario = session.get(Scenario, "SC-001")
        if scenario is None:
            session.add(Scenario(
                id="SC-001",
                name=definition.get("name", "LEO Interception"),
                description=definition.get("description", ""),
                scenario_json=definition,
                schema_version=int(float(definition.get("schemaVersion", 1))),
                status="active",
                created_at=BUILTIN_SCENARIO_TIMESTAMP,
                updated_at=BUILTIN_SCENARIO_TIMESTAMP,
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
    """Small forward-only migration for existing local databases.

    A full migration framework can replace this once the schema grows.
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


def _add_soft_delete_columns_for_existing_database() -> None:
    """Keep existing databases compatible with soft deletion."""
    existing = {column["name"] for column in inspect(engine).get_columns("solutions")}
    if "deleted_at" not in existing:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE solutions ADD COLUMN deleted_at TIMESTAMP"))


def _add_sync_columns_for_existing_database() -> None:
    """Add timestamps needed for deterministic, idempotent replica sync."""
    for table_name in ("solutions", "submissions"):
        existing = {column["name"] for column in inspect(engine).get_columns(table_name)}
        if "updated_at" not in existing:
            with engine.begin() as connection:
                connection.execute(text(
                    f"ALTER TABLE {table_name} ADD COLUMN updated_at TIMESTAMP"
                ))
                connection.execute(text(
                    f"UPDATE {table_name} SET updated_at = created_at WHERE updated_at IS NULL"
                ))


def reset_database(session: Session) -> None:
    for table in reversed(Base.metadata.sorted_tables):
        if table.name != "scenarios":
            session.execute(table.delete())
    session.query(Scenario).filter(Scenario.id != "SC-001").delete(synchronize_session=False)
    session.commit()
