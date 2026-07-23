from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    scenario_json: Mapped[dict] = mapped_column(JSON)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class Solution(Base):
    __tablename__ = "solutions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    name: Mapped[str] = mapped_column(String(180))
    decision_variables_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), default=None, index=True
    )


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    solution_id: Mapped[str] = mapped_column(ForeignKey("solutions.id"), index=True)
    client_validation_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    server_min_distance_km: Mapped[Optional[float]] = mapped_column(Float)
    server_min_distance_time_sec: Mapped[Optional[float]] = mapped_column(Float)
    mission_time_sec: Mapped[Optional[float]] = mapped_column(Float)
    total_delta_v_kmps: Mapped[Optional[float]] = mapped_column(Float)
    distance_score: Mapped[Optional[float]] = mapped_column(Float)
    time_score: Mapped[Optional[float]] = mapped_column(Float)
    delta_v_score: Mapped[Optional[float]] = mapped_column(Float)
    penalty_score: Mapped[Optional[float]] = mapped_column(Float)
    total_score: Mapped[Optional[float]] = mapped_column(Float)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    # Kept for local databases created by the former worker-queue validation flow.
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class SyncSetting(Base):
    __tablename__ = "sync_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    peer_url: Mapped[Optional[str]] = mapped_column(String(500))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_pushed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    remote_cursor: Mapped[int] = mapped_column(Integer, default=0)
    remote_generation: Mapped[Optional[str]] = mapped_column(String(64))
    last_error: Mapped[Optional[str]] = mapped_column(Text)


class SyncRelayState(Base):
    __tablename__ = "sync_relay_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    generation_id: Mapped[str] = mapped_column(String(64), unique=True)


class SyncEvent(Base):
    __tablename__ = "sync_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_type: Mapped[str] = mapped_column(String(24), index=True)
    record_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
