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
    definition_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[Optional[str]] = mapped_column(String(32), unique=True, index=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(64), default="development-user")
    device_id: Mapped[str] = mapped_column(String(64), default="development-device")
    input_type: Mapped[str] = mapped_column(String(24))
    schema_version: Mapped[str] = mapped_column(String(16))
    raw_payload: Mapped[dict] = mapped_column(JSON)
    validation_status: Mapped[str] = mapped_column(String(24), index=True)
    upload_status: Mapped[str] = mapped_column(String(24), default="stored")
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Solution(Base):
    __tablename__ = "solutions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[Optional[str]] = mapped_column(String(32), unique=True, index=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id"), unique=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    solution_name: Mapped[str] = mapped_column(String(180))
    solution_type: Mapped[str] = mapped_column(String(32))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    validation_status: Mapped[str] = mapped_column(String(24), index=True)
    official_score: Mapped[float] = mapped_column(Float)
    final_distance: Mapped[float] = mapped_column(Float)
    total_delta_v: Mapped[float] = mapped_column(Float)
    total_time: Mapped[float] = mapped_column(Float)
    burn_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OptimizationRun(Base):
    __tablename__ = "optimization_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    solution_id: Mapped[int] = mapped_column(ForeignKey("solutions.id"), unique=True)
    method_name: Mapped[str] = mapped_column(String(120))
    method_implementation: Mapped[Optional[str]] = mapped_column(String(180))
    method_version: Mapped[Optional[str]] = mapped_column(String(80))
    method_options_json: Mapped[dict] = mapped_column(JSON, default=dict)
    objective_name: Mapped[str] = mapped_column(String(180))
    objective_sense: Mapped[str] = mapped_column(String(16))
    objective_definition_type: Mapped[str] = mapped_column(String(40))
    objective_reference: Mapped[Optional[str]] = mapped_column(String(180))
    objective_expression: Mapped[Optional[str]] = mapped_column(Text)
    objective_components_json: Mapped[list] = mapped_column(JSON, default=list)
    objective_parameters_json: Mapped[dict] = mapped_column(JSON, default=dict)
    objective_description: Mapped[Optional[str]] = mapped_column(Text)
    objective_value: Mapped[Optional[float]] = mapped_column(Float)
    optimizer_success: Mapped[Optional[bool]] = mapped_column(Boolean)
    optimizer_iterations: Mapped[Optional[int]] = mapped_column(Integer)
    function_evaluations: Mapped[Optional[int]] = mapped_column(Integer)
    optimizer_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DecisionVariableSet(Base):
    __tablename__ = "decision_variable_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    solution_id: Mapped[int] = mapped_column(ForeignKey("solutions.id"), index=True)
    set_type: Mapped[str] = mapped_column(String(16), index=True)
    t_wait: Mapped[float] = mapped_column(Float)
    final_coast_time: Mapped[float] = mapped_column(Float)
    burn_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Burn(Base):
    __tablename__ = "burns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    decision_variable_set_id: Mapped[int] = mapped_column(ForeignKey("decision_variable_sets.id"), index=True)
    burn_index: Mapped[int] = mapped_column(Integer)
    delta_v_x: Mapped[float] = mapped_column(Float)
    delta_v_y: Mapped[float] = mapped_column(Float)
    delta_v_z: Mapped[float] = mapped_column(Float)
    time_to_next_burn: Mapped[Optional[float]] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ValidationResult(Base):
    __tablename__ = "validation_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id"), index=True)
    solution_id: Mapped[Optional[int]] = mapped_column(ForeignKey("solutions.id"), index=True)
    status: Mapped[str] = mapped_column(String(24))
    burn_count: Mapped[int] = mapped_column(Integer)
    total_delta_v: Mapped[float] = mapped_column(Float)
    total_time: Mapped[float] = mapped_column(Float)
    final_distance: Mapped[float] = mapped_column(Float)
    official_score: Mapped[Optional[float]] = mapped_column(Float)
    provider: Mapped[str] = mapped_column(String(80))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    validated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ConstraintResult(Base):
    __tablename__ = "constraint_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    validation_result_id: Mapped[int] = mapped_column(ForeignKey("validation_results.id"), index=True)
    constraint_name: Mapped[str] = mapped_column(String(120))
    value: Mapped[float] = mapped_column(Float)
    limit_value: Mapped[float] = mapped_column(Float)
    operator: Mapped[str] = mapped_column(String(8))
    satisfied: Mapped[bool] = mapped_column(Boolean)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
