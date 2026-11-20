"""Request / background-job correlation ID context propagation."""

from __future__ import annotations

import re
import uuid
from contextvars import ContextVar, Token

_REQUEST_ID_CTX: ContextVar[str | None] = ContextVar("manga_reader_request_id", default=None)
_SAFE_CORRELATION_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,128}$")


def generate_request_id() -> str:
    """Create a fresh UUIDv4 correlation ID."""
    return str(uuid.uuid4())


def sanitize_inbound_request_id(candidate: str | None) -> str:
    """Accept a valid inbound X-Request-ID or generate a clean UUIDv4."""
    if candidate and _SAFE_CORRELATION_ID_RE.match(candidate.strip()):
        return candidate.strip()
    return generate_request_id()


def get_request_id() -> str:
    """Return active correlation ID or a fallback value outside request context."""
    return _REQUEST_ID_CTX.get() or "no-request-context"


def set_request_id(request_id: str) -> Token[str | None]:
    """Bind correlation ID into the current async context."""
    return _REQUEST_ID_CTX.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    """Restore previous correlation ID context."""
    _REQUEST_ID_CTX.reset(token)
