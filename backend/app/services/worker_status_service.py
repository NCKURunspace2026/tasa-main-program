from __future__ import annotations

from datetime import datetime, timedelta, timezone

_last_heartbeat: datetime | None = None
_provider: str | None = None
_gmat_configured = False


def record_heartbeat(provider: str, gmat_configured: bool) -> dict:
    global _last_heartbeat, _provider, _gmat_configured
    _last_heartbeat = datetime.now(timezone.utc)
    _provider = provider
    _gmat_configured = gmat_configured
    return get_worker_status()


def get_worker_status() -> dict:
    active = (
        _last_heartbeat is not None
        and datetime.now(timezone.utc) - _last_heartbeat < timedelta(seconds=30)
    )
    return {
        "validationWorker": "ready" if active and _gmat_configured else (
            "waiting-for-gmat" if active else "offline"
        ),
        "validationProvider": _provider if active else None,
        "physicalValidation": bool(active and _gmat_configured),
        "workerLastSeenAt": _last_heartbeat.isoformat() if active else None,
    }
