"""Shared cross-cutting domain-agnostic primitives."""

from manga_reader.common.audit import AuditEvent, AuditLogWriter, InMemoryAuditLogWriter
from manga_reader.common.clock import ensure_utc, format_rfc3339, utc_now
from manga_reader.common.correlation import get_request_id, reset_request_id, set_request_id
from manga_reader.common.errors import AppError
from manga_reader.common.identities import (
    AccountId,
    ChapterId,
    CreatorId,
    ListId,
    MangaId,
    MediaId,
    MediaObjectRef,
    PageUid,
    PoolChapterId,
    PoolMangaId,
    SessionId,
    TagId,
)
from manga_reader.common.pagination import PaginationParams, SortDirection, SortSpec
from manga_reader.common.security import (
    ANONYMOUS_PRINCIPAL,
    AccountRole,
    AccountStatus,
    Argon2PasswordHasher,
    SecurityPrincipal,
    assert_resource_owner,
    require_active_reader,
    require_admin,
    require_authenticated,
)

__all__ = [
    "ANONYMOUS_PRINCIPAL",
    "AccountId",
    "AccountRole",
    "AccountStatus",
    "AppError",
    "Argon2PasswordHasher",
    "AuditEvent",
    "AuditLogWriter",
    "ChapterId",
    "CreatorId",
    "InMemoryAuditLogWriter",
    "ListId",
    "MangaId",
    "MediaId",
    "MediaObjectRef",
    "PageUid",
    "PaginationParams",
    "PoolChapterId",
    "PoolMangaId",
    "SecurityPrincipal",
    "SessionId",
    "SortDirection",
    "SortSpec",
    "TagId",
    "assert_resource_owner",
    "ensure_utc",
    "format_rfc3339",
    "get_request_id",
    "require_active_reader",
    "require_admin",
    "require_authenticated",
    "reset_request_id",
    "set_request_id",
    "utc_now",
]
