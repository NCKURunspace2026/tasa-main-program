from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import (
    Scenario,
    Solution,
    Submission,
    SyncEvent,
    SyncRelayState,
    SyncSetting,
)
from ..schemas.submission import ClientValidationInput, DecisionVariablesInput
from .scenario_service import normalize_scenario
from .validation_result_service import (
    apply_recomputed_submission,
    mark_scenario_submissions_for_repair,
    recompute_scenario_submissions,
    recompute_submission_result,
    scenario_dynamics_changed,
)


SYNC_SCHEMA_VERSION = 1
SYNCABLE_SUBMISSION_STATUSES = ("passed", "needs_repair")
DEFAULT_PEER_URL = "https://missiondashboard.fastapicloud.dev/api"


def get_sync_setting(session: Session) -> SyncSetting:
    setting = session.get(SyncSetting, 1)
    if setting is None:
        setting = SyncSetting(id=1, peer_url=DEFAULT_PEER_URL, enabled=True)
        session.add(setting)
        session.commit()
    return setting


def update_sync_setting(
    session: Session,
    peer_url: str,
    enabled: bool,
) -> dict:
    setting = get_sync_setting(session)
    setting.peer_url = normalize_peer_url(peer_url)
    setting.enabled = enabled
    setting.last_error = None
    session.commit()
    return serialize_sync_setting(setting)


def serialize_sync_setting(setting: SyncSetting) -> dict:
    return {
        "peerUrl": setting.peer_url,
        "enabled": setting.enabled,
        "lastSyncAt": _iso(setting.last_sync_at),
        "lastError": setting.last_error,
    }


def normalize_peer_url(value: str) -> str:
    peer_url = value.strip().rstrip("/")
    if not peer_url.startswith(("http://", "https://")):
        raise ValueError("Sync peer URL must use HTTP or HTTPS.")
    return peer_url if peer_url.endswith("/api") else f"{peer_url}/api"


def build_manifest(session: Session) -> dict:
    records = [_record_summary(record) for record in build_records(session)]
    return {
        "schemaVersion": SYNC_SCHEMA_VERSION,
        "records": sorted(records, key=lambda item: (item["recordType"], item["recordId"])),
    }


def build_records(session: Session, updated_after: datetime | None = None) -> list[dict]:
    scenario_query = select(Scenario)
    if updated_after is not None:
        scenario_query = scenario_query.where(Scenario.updated_at > updated_after)
    records = [_scenario_record(item) for item in session.scalars(scenario_query).all()]
    solution_query = (
        select(Solution, Submission)
        .join(Submission, Submission.solution_id == Solution.id)
        .where(Submission.status.in_(SYNCABLE_SUBMISSION_STATUSES))
    )
    if updated_after is not None:
        solution_query = solution_query.where(or_(
            Solution.updated_at > updated_after,
            Submission.updated_at > updated_after,
            Submission.validated_at > updated_after,
        ))
    passed = session.execute(solution_query).all()
    records.extend(_solution_record(solution, submission) for solution, submission in passed)
    return records


def find_record(session: Session, record_type: str, record_id: str) -> dict | None:
    if record_type == "scenario":
        scenario = session.get(Scenario, record_id)
        return _scenario_record(scenario) if scenario else None
    if record_type == "solution":
        solution = session.get(Solution, record_id)
        if solution is None:
            return None
        submission = session.scalar(
            select(Submission).where(
                Submission.solution_id == solution.id,
                Submission.status.in_(SYNCABLE_SUBMISSION_STATUSES),
            )
        )
        return _solution_record(solution, submission) if submission else None
    return None


def import_records(
    session: Session,
    records: list[dict[str, Any]],
    *,
    emit_events: bool = True,
) -> dict:
    imported = 0
    skipped = 0
    conflicts: list[dict] = []
    ordered = sorted(records, key=lambda record: record.get("recordType") != "scenario")
    for record in ordered:
        try:
            _validate_record(record)
            local = find_record(session, record["recordType"], record["recordId"])
            if local is not None and _version_key(local) >= _version_key(record):
                skipped += 1
                continue
            if record["recordType"] == "scenario":
                _import_scenario(session, record)
            elif record["recordType"] == "solution":
                if session.get(Scenario, record["payload"]["scenarioId"]) is None:
                    raise ValueError("Referenced Scenario is missing.")
                _import_solution(session, record)
            else:
                raise ValueError("Unsupported record type.")
            if emit_events:
                session.add(SyncEvent(
                    record_type=record["recordType"],
                    record_id=record["recordId"],
                ))
            session.commit()
            imported += 1
        except Exception as error:
            session.rollback()
            conflicts.append({
                "recordType": record.get("recordType"),
                "recordId": record.get("recordId"),
                "reason": str(error),
            })
    return {"imported": imported, "skipped": skipped, "conflicts": conflicts}


def read_changes(session: Session, after: int, limit: int) -> dict:
    state = _get_relay_state(session)
    events = list(session.scalars(
        select(SyncEvent)
        .where(SyncEvent.id > after)
        .order_by(SyncEvent.id)
        .limit(limit + 1)
    ).all())
    has_more = len(events) > limit
    page = events[:limit]
    records = []
    next_cursor = after
    for event in page:
        next_cursor = event.id
        record = find_record(session, event.record_type, event.record_id)
        if record is not None:
            records.append(record)
    return {
        "schemaVersion": SYNC_SCHEMA_VERSION,
        "generation": state.generation_id,
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "records": records,
    }


def _get_relay_state(session: Session) -> SyncRelayState:
    state = session.get(SyncRelayState, 1)
    if state is None:
        state = SyncRelayState(id=1, generation_id=uuid4().hex)
        session.add(state)
        session.commit()
    return state


def synchronize_with_peer(session: Session, client_factory=httpx.Client) -> dict:
    setting = get_sync_setting(session)
    if not setting.enabled or not setting.peer_url:
        return {"status": "disabled", **serialize_sync_setting(setting)}
    try:
        sync_started_at = datetime.now(timezone.utc)
        with client_factory(timeout=30.0) as client:
            probe = client.get(
                f"{setting.peer_url}/sync/changes",
                params={"after": setting.remote_cursor or 0, "limit": 1},
            )
            if probe.status_code == 404:
                return _synchronize_with_legacy_peer(
                    session, setting, client, sync_started_at
                )
            probe.raise_for_status()
            peer_generation = probe.json()["generation"]
            relay_was_rebuilt = setting.remote_generation != peer_generation
            outgoing = build_records(
                session,
                None if relay_was_rebuilt else setting.last_pushed_at,
            )

            peer_result = {"imported": 0, "skipped": 0, "conflicts": []}
            for offset in range(0, len(outgoing), 100):
                response = client.post(
                    f"{setting.peer_url}/sync/import",
                    json={"records": outgoing[offset:offset + 100]},
                )
                response.raise_for_status()
                result = response.json()
                peer_result["imported"] += result["imported"]
                peer_result["skipped"] += result["skipped"]
                peer_result["conflicts"].extend(result["conflicts"])

            cursor = 0 if relay_was_rebuilt else (setting.remote_cursor or 0)
            local_result = {"imported": 0, "skipped": 0, "conflicts": []}
            while True:
                response = client.get(
                    f"{setting.peer_url}/sync/changes",
                    params={"after": cursor, "limit": 500},
                )
                response.raise_for_status()
                page = response.json()
                result = import_records(session, page["records"], emit_events=False)
                local_result["imported"] += result["imported"]
                local_result["skipped"] += result["skipped"]
                local_result["conflicts"].extend(result["conflicts"])
                cursor = page["nextCursor"]
                if not page["hasMore"]:
                    break

            reconciliation = _reconcile_with_peer_manifest(session, setting, client)
            peer_result["imported"] += reconciliation["pushed"]
            peer_result["conflicts"].extend(reconciliation["conflicts"])
            local_result["imported"] += reconciliation["pulled"]

        setting = get_sync_setting(session)
        setting.last_sync_at = datetime.now(timezone.utc)
        setting.last_pushed_at = sync_started_at
        setting.remote_cursor = cursor
        setting.remote_generation = peer_generation
        setting.last_error = None
        session.commit()
        return {
            "status": "ok",
            "mode": "incremental-cursor",
            "pushed": peer_result["imported"],
            "pulled": local_result["imported"],
            "conflicts": peer_result["conflicts"] + local_result["conflicts"],
            **serialize_sync_setting(setting),
        }
    except Exception as error:
        session.rollback()
        setting = get_sync_setting(session)
        setting.last_error = _sync_error_message(error)
        session.commit()
        return {"status": "error", **serialize_sync_setting(setting)}


def _reconcile_with_peer_manifest(
    session: Session,
    setting: SyncSetting,
    client: httpx.Client,
) -> dict:
    response = client.get(f"{setting.peer_url}/sync/manifest")
    if response.status_code == 404:
        return {"pushed": 0, "pulled": 0, "conflicts": []}
    response.raise_for_status()
    peer_items = {
        (item["recordType"], item["recordId"]): item
        for item in response.json()["records"]
    }
    local_records = {
        (item["recordType"], item["recordId"]): item for item in build_records(session)
    }
    outgoing = []
    incoming_keys = []
    for key in set(local_records) | set(peer_items):
        local = local_records.get(key)
        peer = peer_items.get(key)
        if local is not None and (peer is None or _version_key(local) > _version_key(peer)):
            outgoing.append(local)
        elif peer is not None and (local is None or _version_key(peer) > _version_key(local)):
            incoming_keys.append(key)

    pushed = 0
    conflicts = []
    for offset in range(0, len(outgoing), 100):
        import_response = client.post(
            f"{setting.peer_url}/sync/import",
            json={"records": outgoing[offset:offset + 100]},
        )
        import_response.raise_for_status()
        result = import_response.json()
        pushed += result["imported"]
        conflicts.extend(result["conflicts"])

    incoming = []
    for record_type, record_id in incoming_keys:
        record_response = client.get(f"{setting.peer_url}/sync/records/{record_type}/{record_id}")
        record_response.raise_for_status()
        incoming.append(record_response.json())
    local_result = import_records(session, incoming, emit_events=False)
    return {
        "pushed": pushed,
        "pulled": local_result["imported"],
        "conflicts": conflicts + local_result["conflicts"],
    }


def _synchronize_with_legacy_peer(
    session: Session,
    setting: SyncSetting,
    client: httpx.Client,
    sync_started_at: datetime,
) -> dict:
    peer_manifest = client.get(f"{setting.peer_url}/sync/manifest")
    peer_manifest.raise_for_status()
    peer_items = {
        (item["recordType"], item["recordId"]): item
        for item in peer_manifest.json()["records"]
    }
    local_records = {
        (item["recordType"], item["recordId"]): item for item in build_records(session)
    }
    outgoing = []
    incoming_keys = []
    for key in set(local_records) | set(peer_items):
        local = local_records.get(key)
        peer = peer_items.get(key)
        if local is not None and (peer is None or _version_key(local) > _version_key(peer)):
            outgoing.append(local)
        elif peer is not None and (local is None or _version_key(peer) > _version_key(local)):
            incoming_keys.append(key)

    pushed = 0
    conflicts = []
    for offset in range(0, len(outgoing), 100):
        response = client.post(
            f"{setting.peer_url}/sync/import",
            json={"records": outgoing[offset:offset + 100]},
        )
        response.raise_for_status()
        result = response.json()
        pushed += result["imported"]
        conflicts.extend(result["conflicts"])

    incoming = []
    for record_type, record_id in incoming_keys:
        response = client.get(f"{setting.peer_url}/sync/records/{record_type}/{record_id}")
        response.raise_for_status()
        incoming.append(response.json())
    local_result = import_records(session, incoming, emit_events=False)
    setting.last_sync_at = datetime.now(timezone.utc)
    setting.last_pushed_at = sync_started_at
    setting.last_error = None
    session.commit()
    return {
        "status": "ok",
        "mode": "legacy-manifest",
        "pushed": pushed,
        "pulled": local_result["imported"],
        "conflicts": conflicts + local_result["conflicts"],
        **serialize_sync_setting(setting),
    }


def _sync_error_message(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        status_code = error.response.status_code
        return f"Relay request failed with HTTP {status_code}."
    if isinstance(error, httpx.RequestError):
        return "Relay is unreachable. Check the relay address and network connection."
    return str(error)


def _scenario_record(scenario: Scenario) -> dict:
    scenario_json = json.loads(json.dumps(scenario.scenario_json))
    validation = scenario_json.setdefault("validation", {})
    validation.setdefault("minimumBurnCount", 1)
    validation.setdefault("maximumBurnCount", 2147483647)
    score_config = scenario_json.setdefault("scoreConfig", {})
    score_config.update({
        "distanceReferenceKm": 5,
        "distanceDecayKm": 100,
        "distanceWeight": 50,
        "timeWeight": 25,
        "deltaVWeight": 25,
    })
    payload = {
        "scenarioId": scenario.id,
        "name": scenario.name,
        "description": scenario.description,
        "scenarioJson": scenario_json,
        "schemaVersion": scenario.schema_version,
        "status": scenario.status,
        "createdAt": _iso(scenario.created_at),
        "updatedAt": _iso(scenario.updated_at),
    }
    return _wrap_record("scenario", scenario.id, payload["updatedAt"], payload)


def _solution_record(solution: Solution, submission: Submission) -> dict:
    updated_at = max(
        _as_utc(value)
        for value in (solution.updated_at, submission.updated_at, submission.validated_at)
        if value is not None
    )
    payload = {
        "solutionId": solution.id,
        "scenarioId": solution.scenario_id,
        "name": solution.name,
        "decisionVariables": solution.decision_variables_json,
        "createdAt": _iso(solution.created_at),
        "updatedAt": _iso(solution.updated_at),
        "deletedAt": _iso(solution.deleted_at),
        "submission": {
            "submissionId": submission.id,
            "clientValidation": submission.client_validation_json,
            "status": submission.status,
            "serverMinimumDistanceKm": submission.server_min_distance_km,
            "serverMinimumDistanceTimeSec": submission.server_min_distance_time_sec,
            "serverMinimumChaserRadiusKm": submission.server_min_chaser_radius_km,
            "serverMinimumTargetRadiusKm": submission.server_min_target_radius_km,
            "missionTimeSec": submission.mission_time_sec,
            "totalDeltaVKmPerSec": submission.total_delta_v_kmps,
            "distanceScore": submission.distance_score,
            "timeScore": submission.time_score,
            "deltaVScore": submission.delta_v_score,
            "penaltyScore": submission.penalty_score,
            "totalScore": submission.total_score,
            "errorMessage": submission.error_message,
            "createdAt": _iso(submission.created_at),
            "updatedAt": _iso(submission.updated_at),
            "validatedAt": _iso(submission.validated_at),
        },
    }
    return _wrap_record("solution", solution.id, _iso(updated_at), payload)


def _wrap_record(record_type: str, record_id: str, updated_at: str, payload: dict) -> dict:
    record = {
        "schemaVersion": SYNC_SCHEMA_VERSION,
        "recordType": record_type,
        "recordId": record_id,
        "updatedAt": updated_at,
        "payload": payload,
    }
    record["contentHash"] = _content_hash(record)
    return record


def _record_summary(record: dict) -> dict:
    return {key: record[key] for key in ("recordType", "recordId", "updatedAt", "contentHash")}


def _content_hash(record: dict) -> str:
    canonical = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def _validate_record(record: dict) -> None:
    required = {"schemaVersion", "recordType", "recordId", "updatedAt", "payload", "contentHash"}
    if not required.issubset(record):
        raise ValueError("Sync record is incomplete.")
    if record["schemaVersion"] != SYNC_SCHEMA_VERSION:
        raise ValueError("Sync record schema version is unsupported.")
    if record["recordType"] not in {"scenario", "solution"}:
        raise ValueError("Sync record type is unsupported.")
    if not isinstance(record["recordId"], str) or not record["recordId"]:
        raise ValueError("Sync record ID is invalid.")
    _datetime(record["updatedAt"])
    unsigned = {key: value for key, value in record.items() if key != "contentHash"}
    if record["contentHash"] != _content_hash(unsigned):
        raise ValueError("Sync record content hash does not match.")


def _version_key(record: dict) -> tuple[str, str]:
    return record["updatedAt"], record["contentHash"]


def _import_scenario(session: Session, record: dict) -> None:
    payload = record["payload"]
    if payload.get("scenarioId") != record["recordId"]:
        raise ValueError("Scenario record ID does not match its payload.")
    definition = normalize_scenario(payload["scenarioJson"])
    scenario = session.get(Scenario, record["recordId"])
    previous_definition = (
        normalize_scenario(scenario.scenario_json) if scenario is not None else definition
    )
    if scenario is None:
        scenario = Scenario(id=record["recordId"], name=payload["name"], scenario_json={})
        session.add(scenario)
    scenario.name = payload["name"]
    scenario.description = payload.get("description", "")
    scenario.scenario_json = definition
    scenario.schema_version = definition["schemaVersion"]
    scenario.status = payload.get("status", "active")
    scenario.created_at = _datetime(payload["createdAt"])
    scenario.updated_at = _datetime(payload["updatedAt"])
    if scenario_dynamics_changed(previous_definition, definition):
        mark_scenario_submissions_for_repair(
            session, scenario, updated_at=scenario.updated_at, emit_sync_events=False,
        )
    else:
        recompute_scenario_submissions(
            session,
            scenario,
            updated_at=scenario.updated_at,
            emit_sync_events=False,
        )


def _import_solution(session: Session, record: dict) -> None:
    payload = record["payload"]
    if payload.get("solutionId") != record["recordId"]:
        raise ValueError("Solution record ID does not match its payload.")
    decision_variables = DecisionVariablesInput.model_validate(payload["decisionVariables"])
    submission_payload = payload["submission"]
    client_validation = ClientValidationInput.model_validate(
        submission_payload["clientValidation"]
    )
    scenario = session.get(Scenario, payload["scenarioId"])
    server_metrics = (
        float(submission_payload["serverMinimumDistanceKm"]),
        float(submission_payload["missionTimeSec"]),
        float(submission_payload["totalDeltaVKmPerSec"]),
    )
    client_metrics = (
        client_validation.minimumDistanceKm,
        client_validation.missionTimeSec,
        client_validation.totalDeltaVKmPerSec,
    )
    if not all(
        math.isfinite(server) and math.isclose(server, client, rel_tol=1e-9, abs_tol=1e-9)
        for server, client in zip(server_metrics, client_metrics)
    ):
        raise ValueError("Synchronized GMAT metrics are inconsistent.")
    server_minimum_time = submission_payload.get("serverMinimumDistanceTimeSec")
    if server_minimum_time is not None:
        server_minimum_time = float(server_minimum_time)
        if not math.isfinite(server_minimum_time):
            raise ValueError("Synchronized minimum-distance time is invalid.")
        if client_validation.minimumDistanceTimeSec is not None and not math.isclose(
            server_minimum_time,
            client_validation.minimumDistanceTimeSec,
            rel_tol=1e-9,
            abs_tol=1e-9,
        ):
            raise ValueError("Synchronized minimum-distance time is inconsistent.")
    server_minimum_chaser_radius = _optional_finite_float(
        submission_payload.get("serverMinimumChaserRadiusKm"),
        "Synchronized chaser radius metric is invalid.",
    )
    server_minimum_target_radius = _optional_finite_float(
        submission_payload.get("serverMinimumTargetRadiusKm"),
        "Synchronized target radius metric is invalid.",
    )
    if client_validation.minimumChaserRadiusKm is not None and server_minimum_chaser_radius is not None:
        if not math.isclose(
            server_minimum_chaser_radius,
            client_validation.minimumChaserRadiusKm,
            rel_tol=1e-9,
            abs_tol=1e-9,
        ):
            raise ValueError("Synchronized chaser radius metric is inconsistent.")
    if client_validation.minimumTargetRadiusKm is not None and server_minimum_target_radius is not None:
        if not math.isclose(
            server_minimum_target_radius,
            client_validation.minimumTargetRadiusKm,
            rel_tol=1e-9,
            abs_tol=1e-9,
        ):
            raise ValueError("Synchronized target radius metric is inconsistent.")
    recomputed = recompute_submission_result(
        scenario.scenario_json,
        decision_variables.model_dump(mode="json"),
        server_metrics[0],
        server_metrics[1],
        server_metrics[2],
        float(submission_payload.get("penaltyScore") or 0),
        server_minimum_chaser_radius,
        server_minimum_target_radius,
    )
    solution = session.get(Solution, record["recordId"])
    if solution is None:
        solution = Solution(
            id=record["recordId"],
            scenario_id=payload["scenarioId"],
            name=payload["name"],
            decision_variables_json=decision_variables.model_dump(mode="json"),
        )
        session.add(solution)
    solution.scenario_id = payload["scenarioId"]
    solution.name = payload["name"]
    solution.decision_variables_json = decision_variables.model_dump(mode="json")
    solution.created_at = _datetime(payload["createdAt"])
    solution.updated_at = _datetime(payload["updatedAt"])
    solution.deleted_at = _datetime(payload.get("deletedAt"))

    submission = session.get(Submission, submission_payload["submissionId"])
    if submission is None:
        submission = Submission(
            id=submission_payload["submissionId"],
            solution_id=solution.id,
            client_validation_json=client_validation.model_dump(mode="json"),
        )
        session.add(submission)
    submission.solution_id = solution.id
    submission.client_validation_json = client_validation.model_dump(mode="json")
    synchronized_status = submission_payload.get("status", "passed")
    if synchronized_status not in SYNCABLE_SUBMISSION_STATUSES:
        raise ValueError("Synchronized submission status is unsupported.")
    submission.status = synchronized_status
    submission.server_min_distance_km = submission_payload["serverMinimumDistanceKm"]
    submission.server_min_distance_time_sec = server_minimum_time
    submission.server_min_chaser_radius_km = server_minimum_chaser_radius
    submission.server_min_target_radius_km = server_minimum_target_radius
    submission.mission_time_sec = submission_payload["missionTimeSec"]
    submission.total_delta_v_kmps = submission_payload["totalDeltaVKmPerSec"]
    submission.distance_score = submission_payload["distanceScore"]
    submission.time_score = submission_payload["timeScore"]
    submission.delta_v_score = submission_payload["deltaVScore"]
    submission.penalty_score = submission_payload["penaltyScore"]
    submission.total_score = submission_payload["totalScore"]
    submission.created_at = _datetime(submission_payload["createdAt"])
    submission.updated_at = _datetime(submission_payload["updatedAt"])
    submission.validated_at = _datetime(submission_payload["validatedAt"])
    submission.error_message = submission_payload.get("errorMessage")
    if synchronized_status == "passed":
        apply_recomputed_submission(
            submission,
            recomputed,
            updated_at=max(
                _as_utc(value) for value in (submission.updated_at, scenario.updated_at)
                if value is not None
            ),
        )


def _datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _optional_finite_float(value, message: str) -> float | None:
    if value is None:
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(message)
    return result


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
