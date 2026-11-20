"""Secret and PII redaction utilities for structured logs and diagnostics.

Ensures passwords, OTP codes, JWTs, refresh tokens, cookies, and signed media
query strings never appear in application logs (`06_AUTH_SECURITY_MODERATION.md` §11).
"""

from __future__ import annotations

import re
from typing import Any

REDACTED = "[REDACTED]"

_SENSITIVE_KEY_FRAGMENTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "cookie",
    "otp",
    "api_key",
    "apikey",
    "signature",
    "credential",
)

_SIGNED_QUERY_PARAM_RE = re.compile(
    r"((?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|sig|token|otp)=)[^&\s]+",
    re.IGNORECASE,
)


def is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(fragment in lowered for fragment in _SENSITIVE_KEY_FRAGMENTS)


def redact_url_secrets(value: str) -> str:
    """Strip sensitive query parameters from URLs before logging."""
    return _SIGNED_QUERY_PARAM_RE.sub(rf"\1{REDACTED}", value)


def redact_mapping(data: dict[str, Any]) -> dict[str, Any]:
    """Recursively redact sensitive keys and signed URL params from a log payload."""
    sanitized: dict[str, Any] = {}
    for key, value in data.items():
        if is_sensitive_key(key):
            sanitized[key] = REDACTED
        elif isinstance(value, dict):
            sanitized[key] = redact_mapping(value)
        elif isinstance(value, list):
            sanitized[key] = [
                redact_mapping(item)
                if isinstance(item, dict)
                else (redact_url_secrets(item) if isinstance(item, str) else item)
                for item in value
            ]
        elif isinstance(value, str):
            sanitized[key] = redact_url_secrets(value)
        else:
            sanitized[key] = value
    return sanitized
