import os
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session, sessionmaker

from .models import Base, Scenario


DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "mission_dashboard.db"
DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        yield session


def initialize_database() -> None:
    Base.metadata.create_all(engine)
    _migrate_existing_scenario_table()
    with SessionLocal.begin() as session:
        for scenario_id, name in (
            ("SC-001", "LEO Interception"),
            ("SC-002", "Orbital Rendezvous"),
        ):
            if session.get(Scenario, scenario_id) is None:
                session.add(
                    Scenario(
                        id=scenario_id,
                        name=name,
                        description="",
                        definition_json={},
                        is_active=True,
                    )
                )


def _migrate_existing_scenario_table() -> None:
    """Keep the development SQLite database usable without deleting user data."""
    existing_columns = {
        column["name"] for column in inspect(engine).get_columns("scenarios")
    }
    migrations = {
        "description": "ALTER TABLE scenarios ADD COLUMN description TEXT NOT NULL DEFAULT ''",
        "definition_json": "ALTER TABLE scenarios ADD COLUMN definition_json JSON NOT NULL DEFAULT '{}'",
        "created_at": "ALTER TABLE scenarios ADD COLUMN created_at DATETIME",
    }
    with engine.begin() as connection:
        for column_name, statement in migrations.items():
            if column_name not in existing_columns:
                connection.exec_driver_sql(statement)


def reset_database(session: Session) -> None:
    """Test helper: remove application rows while preserving scenario seeds."""
    for table in reversed(Base.metadata.sorted_tables):
        if table.name != "scenarios":
            session.execute(table.delete())
    session.query(Scenario).filter(
        Scenario.id.notin_(("SC-001", "SC-002"))
    ).delete(synchronize_session=False)
    session.commit()
