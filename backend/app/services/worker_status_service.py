from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ValidationWorker


def record_heartbeat(
    session: Session,
    worker_id: str,
    provider: str,
    gmat_configured: bool,
) -> dict:
    worker = session.get(ValidationWorker, worker_id)
    if worker is None:
        worker = ValidationWorker(id=worker_id, provider=provider)
        session.add(worker)
    worker.provider = provider
    worker.gmat_configured = gmat_configured
    worker.last_seen_at = datetime.now(timezone.utc)
    session.commit()
    return get_worker_status(session)


def get_worker_status(session: Session) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=30)
    worker = session.scalar(
        select(ValidationWorker)
        .where(ValidationWorker.last_seen_at >= cutoff)
        .order_by(ValidationWorker.gmat_configured.desc(), ValidationWorker.last_seen_at.desc())
        .limit(1)
    )
    active = worker is not None
    return {
        "validationWorker": "ready" if active and worker.gmat_configured else (
            "waiting-for-gmat" if active else "offline"
        ),
        "validationProvider": worker.provider if active else None,
        "physicalValidation": bool(active and worker.gmat_configured),
        "workerLastSeenAt": worker.last_seen_at.isoformat() if active else None,
    }
