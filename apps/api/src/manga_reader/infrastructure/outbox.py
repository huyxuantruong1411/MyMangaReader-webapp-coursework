"""Transactional outbox message contract (`ADR` Round 3).

Ensures external side effects (emails, search indexing, CDC subscribe/cancel,
media garbage collection) are recorded inside the DB transaction and executed
after commit by idempotent background workers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID, uuid4

from manga_reader.common.clock import utc_now
from manga_reader.common.correlation import get_request_id


@dataclass(frozen=True, slots=True)
class OutboxMessage:
    event_type: str
    aggregate_type: str
    aggregate_id: str
    payload: dict[str, Any]
    idempotency_key: str
    message_id: UUID = field(default_factory=uuid4)
    request_id: str = field(default_factory=get_request_id)
    created_at: datetime = field(default_factory=utc_now)


class OutboxPublisher(Protocol):
    """Port for persisting durable outbox events within the active transaction."""

    async def enqueue(self, message: OutboxMessage) -> None: ...


class InMemoryOutboxPublisher:
    """Development/test outbox sink preserving idempotency keys in memory."""

    def __init__(self) -> None:
        self._messages: list[OutboxMessage] = []
        self._seen_keys: set[str] = set()

    async def enqueue(self, message: OutboxMessage) -> None:
        if message.idempotency_key in self._seen_keys:
            return
        self._seen_keys.add(message.idempotency_key)
        self._messages.append(message)

    @property
    def messages(self) -> tuple[OutboxMessage, ...]:
        return tuple(self._messages)
