from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Scenario, Solution, Submission, SyncSetting


SYNC_SCHEMA_VERSION = 1
SYNCABLE_SUBMISSION_STATUS = "passed"


def get_sync_setting(session: Session) -> SyncSetting:
    setting = session.get(SyncSetting, 1)
    if setting is None:
        setting = SyncSetting(id=1, enabled=False)
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


def build_records(session: Session) -> list[dict]:
    records = [_scenario_record(item) for item in session.scalars(select(Scenario)).all()]
    passed = session.execute(
        select(Solution, Submission)
        .join(Submission, Submission.solution_id == Solution.id)
        .where(Submission.status == SYNCABLE_SUBMISSION_STATUS)
    ).all()
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
                Submission.status == SYNCABLE_SUBMISSION_STATUS,
            )
        )
        return _solution_record(solution, submission) if submission else None
    return None


def import_records(session: Session, records: list[dict[str, Any]]) -> dict:
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


def synchronize_with_peer(session: Session) -> dict:
    setting = get_sync_setting(session)
    if not setting.enabled or not setting.peer_url:
        return {"status": "disabled", **serialize_sync_setting(setting)}
    try:
        with httpx.Client(timeout=30.0) as client:
            peer_manifest = client.get(f"{setting.peer_url}/sync/manifest")
            peer_manifest.raise_for_status()
            peer_items = {
                (item["recordType"], item["recordId"]): item
                for item in peer_manifest.json()["records"]
            }
            local_records = {
                (item["recordType"], item["recordId"]): item
                for item in build_records(session)
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

            incoming = []
            for record_type, record_id in incoming_keys:
                response = client.get(
                    f"{setting.peer_url}/sync/records/{record_type}/{record_id}"
                )
                response.raise_for_status()
                incoming.append(response.json())
            local_result = import_records(session, incoming)

        setting = get_sync_setting(session)
        setting.last_sync_at = datetime.now(timezone.utc)
        setting.last_error = None
        session.commit()
        return {
            "status": "ok",
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


def _sync_error_message(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        status_code = error.response.status_code
        return f"Relay request failed with HTTP {status_code}."
    if isinstance(error, httpx.RequestError):
        return "Relay is unreachable. Check the relay address and network connection."
    return str(error)


def _scenario_record(scenario: Scenario) -> dict:
    payload = {
        "scenarioId": scenario.id,
        "name": scenario.name,
        "description": scenario.description,
        "originalScript": scenario.original_script,
        "scenarioJson": scenario.scenario_json,
        "schemaVersion": scenario.schema_version,
        "status": "active",
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
            "missionTimeSec": submission.mission_time_sec,
            "totalDeltaVKmPerSec": submission.total_delta_v_kmps,
            "distanceScore": submission.distance_score,
            "timeScore": submission.time_score,
            "deltaVScore": submission.delta_v_score,
            "penaltyScore": submission.penalty_score,
            "totalScore": submission.total_score,
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
    unsigned = {key: value for key, value in record.items() if key != "contentHash"}
    if record["contentHash"] != _content_hash(unsigned):
        raise ValueError("Sync record content hash does not match.")


def _version_key(record: dict) -> tuple[str, str]:
    return record["updatedAt"], record["contentHash"]


def _import_scenario(session: Session, record: dict) -> None:
    payload = record["payload"]
    scenario = session.get(Scenario, record["recordId"])
    if scenario is None:
        scenario = Scenario(id=record["recordId"], name=payload["name"], scenario_json={})
        session.add(scenario)
    scenario.name = payload["name"]
    scenario.description = payload.get("description", "")
    scenario.original_script = payload.get("originalScript")
    scenario.scenario_json = payload["scenarioJson"]
    scenario.schema_version = payload["schemaVersion"]
    scenario.status = "active"
    scenario.created_at = _datetime(payload["createdAt"])
    scenario.updated_at = _datetime(payload["updatedAt"])


def _import_solution(session: Session, record: dict) -> None:
    payload = record["payload"]
    solution = session.get(Solution, record["recordId"])
    if solution is None:
        solution = Solution(
            id=record["recordId"],
            scenario_id=payload["scenarioId"],
            name=payload["name"],
            decision_variables_json=payload["decisionVariables"],
        )
        session.add(solution)
    solution.scenario_id = payload["scenarioId"]
    solution.name = payload["name"]
    solution.decision_variables_json = payload["decisionVariables"]
    solution.created_at = _datetime(payload["createdAt"])
    solution.updated_at = _datetime(payload["updatedAt"])
    solution.deleted_at = _datetime(payload.get("deletedAt"))

    submission_payload = payload["submission"]
    submission = session.get(Submission, submission_payload["submissionId"])
    if submission is None:
        submission = Submission(
            id=submission_payload["submissionId"],
            solution_id=solution.id,
            client_validation_json=submission_payload["clientValidation"],
        )
        session.add(submission)
    submission.solution_id = solution.id
    submission.client_validation_json = submission_payload["clientValidation"]
    submission.status = SYNCABLE_SUBMISSION_STATUS
    submission.server_min_distance_km = submission_payload["serverMinimumDistanceKm"]
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
    submission.error_message = None


def _datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
