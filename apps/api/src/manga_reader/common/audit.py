"""Immutable audit / activity log interface (`activity_logs` contract)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from manga_reader.common.clock import utc_now
from manga_reader.common.correlation import get_request_id
from manga_reader.common.identities import AccountId
from manga_reader.common.redaction import redact_mapping


@dataclass(frozen=True, slots=True)
class AuditEvent:
    """Append-only audit record emitted for privileged or trackable domain actions."""

    event_type: str
    actor_account_id: AccountId | None = None
    target_type: str | None = None
    target_id: str | None = None
    ip_address: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    request_id: str = field(default_factory=get_request_id)
    created_at: datetime = field(default_factory=utc_now)

    def sanitized_details(self) -> dict[str, Any]:
        """Return redacted metadata safe for immutable persistence."""
        payload = {"schema_version": 1, "request_id": self.request_id, **self.details}
        return redact_mapping(payload)


class AuditLogWriter(Protocol):
    """Port implemented by `admin_analytics` to persist immutable activity logs."""

    async def record(self, event: AuditEvent) -> None: ...


class InMemoryAuditLogWriter:
    """Development/test audit log writer preserving immutability semantics in memory."""

    def __init__(self) -> None:
        self._events: list[AuditEvent] = []

    async def record(self, event: AuditEvent) -> None:
        self._events.append(event)

    @property
    def events(self) -> tuple[AuditEvent, ...]:
        return tuple(self._events)
