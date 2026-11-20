"""UTC timestamp utilities enforcing timezone-aware UTC everywhere."""

from __future__ import annotations

from datetime import UTC, datetime


def utc_now() -> datetime:
    """Return current timezone-aware UTC instant."""
    return datetime.now(tz=UTC)


def ensure_utc(value: datetime) -> datetime:
    """Normalize any datetime to timezone-aware UTC. Reject naive datetimes."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Naive datetime is forbidden; pass a timezone-aware datetime.")
    return value.astimezone(UTC)


def format_rfc3339(value: datetime) -> str:
    """Serialize a timezone-aware datetime to RFC 3339 UTC string with millisecond precision."""
    utc_val = ensure_utc(value)
    return utc_val.isoformat(timespec="milliseconds").replace("+00:00", "Z")
