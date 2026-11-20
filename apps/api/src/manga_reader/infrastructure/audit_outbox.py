"""SQLAlchemy helpers for immutable `activity_logs` and transactional `outbox_events`."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import utc_now
from manga_reader.common.correlation import get_request_id
from manga_reader.common.redaction import redact_mapping
from manga_reader.infrastructure.orm import ActivityLogModel, OutboxEventModel


def append_activity_log(
    session: AsyncSession,
    *,
    event_type: str,
    account_id: UUID | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    ip_address: str | None = None,
    details: dict[str, Any] | None = None,
) -> ActivityLogModel:
    """Stage an immutable append-only activity log row inside the active DB transaction."""
    payload = {
        "schema_version": 1,
        "request_id": get_request_id(),
        **(details or {}),
    }
    row = ActivityLogModel(
        account_id=account_id,
        event_type=event_type,
        target_type=target_type,
        target_id=target_id,
        ip_address=ip_address,
        details_json=json.dumps(redact_mapping(payload), ensure_ascii=False, default=str),
        created_at=utc_now(),
    )
    session.add(row)
    return row


async def enqueue_outbox_event(
    session: AsyncSession,
    *,
    idempotency_key: str,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    payload: dict[str, Any],
) -> OutboxEventModel | None:
    """Stage an idempotent outbox event inside the active transaction (`ADR` Round 3)."""
    existing = await session.scalar(
        select(OutboxEventModel).where(OutboxEventModel.idempotency_key == idempotency_key)
    )
    if existing is not None:
        return None
    row = OutboxEventModel(
        idempotency_key=idempotency_key,
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload_json=json.dumps(redact_mapping(payload), ensure_ascii=False, default=str),
        status="PENDING",
        created_at=utc_now(),
    )
    session.add(row)
    return row
