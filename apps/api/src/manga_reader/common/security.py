"""Security primitives, RBAC interfaces, ownership guards, and URL validation.

Implements foundation primitives without implementing full Phase 2 Auth endpoints yet:
- Password hashing (Argon2id — never plaintext)
- Keyed hashing for opaque refresh tokens and OTP challenges (never raw persistence)
- RBAC & resource ownership enforcement interfaces
- External URL scheme allowlisting (anti-XSS/SSRF)
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from urllib.parse import urlparse

from argon2 import PasswordHasher as _Argon2Hasher
from argon2.exceptions import InvalidHashError, VerificationError

from manga_reader.common.errors import (
    AccountLockedError,
    AuthenticationRequiredError,
    EmailNotVerifiedError,
    ForbiddenError,
    ValidationAppError,
)
from manga_reader.common.identities import AccountId, SessionId


class AccountRole(StrEnum):
    ANONYMOUS = "ANONYMOUS"
    READER = "READER"
    ADMIN = "ADMIN"


class AccountStatus(StrEnum):
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    ACTIVE = "ACTIVE"
    LOCKED = "LOCKED"


@dataclass(frozen=True, slots=True)
class SecurityPrincipal:
    """Server-verified identity resolved from JWT + active session check."""

    account_id: AccountId | None = None
    session_id: SessionId | None = None
    role: AccountRole = AccountRole.ANONYMOUS
    status: AccountStatus | None = None
    admin_role_level: str | None = None

    @property
    def is_authenticated(self) -> bool:
        return self.account_id is not None and self.role != AccountRole.ANONYMOUS

    @property
    def is_admin(self) -> bool:
        return self.role == AccountRole.ADMIN and self.status == AccountStatus.ACTIVE

    @property
    def is_active_reader(self) -> bool:
        return self.role == AccountRole.READER and self.status == AccountStatus.ACTIVE


ANONYMOUS_PRINCIPAL = SecurityPrincipal()


def require_authenticated(principal: SecurityPrincipal) -> SecurityPrincipal:
    """Guard requiring any valid authenticated session."""
    if not principal.is_authenticated:
        raise AuthenticationRequiredError()
    if principal.status == AccountStatus.LOCKED:
        raise AccountLockedError()
    if principal.status == AccountStatus.PENDING_VERIFICATION:
        raise EmailNotVerifiedError()
    return principal


def require_active_reader(principal: SecurityPrincipal) -> SecurityPrincipal:
    """Guard enforcing ACTIVE Reader role for mutating Reader operations."""
    require_authenticated(principal)
    if principal.role != AccountRole.READER:
        raise ForbiddenError("Active Reader role is required.")
    return principal


def require_admin(principal: SecurityPrincipal) -> SecurityPrincipal:
    """Guard enforcing ACTIVE Admin role for privileged operations."""
    require_authenticated(principal)
    if principal.role != AccountRole.ADMIN:
        raise ForbiddenError("Administrator privileges are required.")
    return principal


def assert_resource_owner(
    principal: SecurityPrincipal,
    owner_account_id: AccountId,
    *,
    allow_admin: bool = False,
) -> None:
    """Server-side ownership guard preventing IDOR across lists, comments, and profiles."""
    require_authenticated(principal)
    if allow_admin and principal.is_admin:
        return
    if principal.account_id != owner_account_id:
        raise ForbiddenError("You do not own this resource.")


class PasswordHasher(Protocol):
    """Protocol abstracting password hashing implementation."""

    def hash(self, plaintext_password: str) -> str: ...
    def verify(self, password_hash: str, plaintext_password: str) -> bool: ...


class Argon2PasswordHasher:
    """Argon2id password hasher (OWASP recommended default)."""

    def __init__(self) -> None:
        self._hasher = _Argon2Hasher()

    def hash(self, plaintext_password: str) -> str:
        if not plaintext_password:
            raise ValidationAppError("Password must not be empty.")
        return self._hasher.hash(plaintext_password)

    def verify(self, password_hash: str, plaintext_password: str) -> bool:
        try:
            return self._hasher.verify(password_hash, plaintext_password)
        except (VerificationError, InvalidHashError):
            return False


def generate_opaque_token(num_bytes: int = 32) -> str:
    """Generate a cryptographically secure URL-safe opaque token."""
    return secrets.token_urlsafe(num_bytes)


def hash_secret_token(raw_value: str, *, pepper: str) -> str:
    """Compute keyed HMAC-SHA256 digest for refresh tokens or OTP codes.

    Never persist raw OTP codes or raw refresh tokens in SQL or cache.
    """
    return hmac.new(
        pepper.encode("utf-8"),
        raw_value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_secret_hash(raw_value: str, expected_digest: str, *, pepper: str) -> bool:
    """Constant-time verification of a keyed digest."""
    computed = hash_secret_token(raw_value, pepper=pepper)
    return hmac.compare_digest(computed, expected_digest)


_ALLOWED_EXTERNAL_SCHEMES = frozenset({"http", "https"})


def validate_external_url(url: str, *, max_length: int = 1000) -> str:
    """Validate external manga/creator URLs, rejecting javascript:/data:/file: schemes."""
    trimmed = url.strip()
    if not trimmed or len(trimmed) > max_length:
        raise ValidationAppError("External URL is empty or exceeds maximum length.")
    parsed = urlparse(trimmed)
    if parsed.scheme.lower() not in _ALLOWED_EXTERNAL_SCHEMES or not parsed.netloc:
        raise ValidationAppError(
            "External URL must use http or https with a valid host.",
            details={"field": "url"},
        )
    return trimmed
