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
    original_script: Mapped[Optional[str]] = mapped_column(Text)
    scenario_json: Mapped[dict] = mapped_column(JSON)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class Solution(Base):
    __tablename__ = "solutions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    name: Mapped[str] = mapped_column(String(180))
    decision_variables_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    solution_id: Mapped[str] = mapped_column(ForeignKey("solutions.id"), index=True)
    client_validation_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    server_min_distance_km: Mapped[Optional[float]] = mapped_column(Float)
    mission_time_sec: Mapped[Optional[float]] = mapped_column(Float)
    total_delta_v_kmps: Mapped[Optional[float]] = mapped_column(Float)
    distance_score: Mapped[Optional[float]] = mapped_column(Float)
    time_score: Mapped[Optional[float]] = mapped_column(Float)
    delta_v_score: Mapped[Optional[float]] = mapped_column(Float)
    penalty_score: Mapped[Optional[float]] = mapped_column(Float)
    total_score: Mapped[Optional[float]] = mapped_column(Float)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    claimed_by_worker_id: Mapped[Optional[str]] = mapped_column(String(96), index=True)
    claim_token: Mapped[Optional[str]] = mapped_column(String(64))
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class ValidationWorker(Base):
    __tablename__ = "validation_workers"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    provider: Mapped[str] = mapped_column(String(80))
    gmat_configured: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )
