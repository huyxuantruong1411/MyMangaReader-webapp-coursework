"""Unit tests for environment validation, UTC clock, redaction, security, and identities."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from manga_reader.common.clock import ensure_utc, format_rfc3339, utc_now
from manga_reader.common.errors import AccountLockedError, ForbiddenError, ValidationAppError
from manga_reader.common.identities import AccountId, MediaObjectRef
from manga_reader.common.pagination import PaginationParams, SortDirection, SortSpec
from manga_reader.common.redaction import REDACTED, redact_mapping, redact_url_secrets
from manga_reader.common.security import (
    AccountRole,
    AccountStatus,
    Argon2PasswordHasher,
    SecurityPrincipal,
    assert_resource_owner,
    hash_secret_token,
    require_admin,
    require_authenticated,
    validate_external_url,
    verify_secret_hash,
)
from manga_reader.config.settings import DEV_DEFAULT_JWT_SECRET, Settings

pytestmark = pytest.mark.unit


def test_settings_rejects_short_jwt_secret() -> None:
    with pytest.raises(ValidationError, match="32 characters"):
        Settings(_env_file=None, jwt_secret_key="short-secret")


def test_settings_rejects_dev_defaults_in_production() -> None:
    with pytest.raises(ValidationError, match="Default development JWT_SECRET_KEY"):
        Settings(
            _env_file=None,
            app_env="production",
            app_debug=False,
            cache_backend="redis",
            storage_backend="s3",
            jwt_secret_key=DEV_DEFAULT_JWT_SECRET,
        )

    with pytest.raises(ValidationError, match="In-memory cache"):
        Settings(
            _env_file=None,
            app_env="production",
            app_debug=False,
            cache_backend="memory",
            storage_backend="s3",
            jwt_secret_key="a" * 48,
        )


def test_settings_rejects_invalid_page_size_bounds() -> None:
    with pytest.raises(ValidationError, match="CATALOG_DEFAULT_PAGE_SIZE"):
        Settings(_env_file=None, catalog_default_page_size=50, catalog_max_page_size=24)


def test_utc_clock_rejects_naive_datetime() -> None:
    now = utc_now()
    formatted = format_rfc3339(now)
    assert formatted.endswith("Z")
    with pytest.raises(ValueError, match="Naive datetime"):
        ensure_utc(datetime(2026, 11, 20, 12, 0, 0))


def test_media_object_ref_rejects_path_traversal_and_bad_bucket() -> None:
    valid = MediaObjectRef(bucket="manga-reader-media", object_key="covers/pm_1/01.webp")
    assert valid.storage_uri == "s3://manga-reader-media/covers/pm_1/01.webp"

    with pytest.raises(ValueError, match="Path traversal"):
        MediaObjectRef(bucket="manga-reader-media", object_key="covers/../secrets.txt")

    with pytest.raises(ValueError, match="leading slash"):
        MediaObjectRef(bucket="manga-reader-media", object_key="/etc/passwd")

    with pytest.raises(ValueError, match="Invalid S3 bucket"):
        MediaObjectRef(bucket="INVALID_BUCKET!", object_key="covers/1.webp")


def test_password_and_opaque_token_hashing_never_store_plaintext() -> None:
    hasher = Argon2PasswordHasher()
    hashed = hasher.hash("SuperSecurePass!2026")
    assert "SuperSecurePass!2026" not in hashed
    assert hasher.verify(hashed, "SuperSecurePass!2026") is True
    assert hasher.verify(hashed, "WrongPassword") is False

    otp_hash = hash_secret_token("123456", pepper="test-pepper-key")
    assert "123456" not in otp_hash
    assert verify_secret_hash("123456", otp_hash, pepper="test-pepper-key") is True
    assert verify_secret_hash("654321", otp_hash, pepper="test-pepper-key") is False


def test_rbac_and_ownership_guards_enforce_server_side_invariants() -> None:
    reader_id = AccountId(uuid4())
    other_id = AccountId(uuid4())
    locked_reader = SecurityPrincipal(
        account_id=reader_id,
        role=AccountRole.READER,
        status=AccountStatus.LOCKED,
    )
    active_reader = SecurityPrincipal(
        account_id=reader_id,
        role=AccountRole.READER,
        status=AccountStatus.ACTIVE,
    )
    admin = SecurityPrincipal(
        account_id=AccountId(uuid4()),
        role=AccountRole.ADMIN,
        status=AccountStatus.ACTIVE,
    )

    with pytest.raises(AccountLockedError):
        require_authenticated(locked_reader)

    with pytest.raises(ForbiddenError):
        require_admin(active_reader)

    with pytest.raises(ForbiddenError):
        assert_resource_owner(active_reader, other_id)

    assert_resource_owner(active_reader, reader_id)
    assert require_admin(admin) == admin


def test_redaction_strips_secrets_and_signed_urls() -> None:
    redacted = redact_mapping(
        {
            "password": "my-secret-password",
            "otp_code": "123456",
            "authorization": "Bearer eyJ...",
            "nested": {"refresh_token": "tok_abc", "safe_field": "ok"},
            "url": "https://cdn.example.com/p.webp?exp=999&sig=secret123",
        }
    )
    assert redacted["password"] == REDACTED
    assert redacted["otp_code"] == REDACTED
    assert redacted["authorization"] == REDACTED
    assert redacted["nested"]["refresh_token"] == REDACTED
    assert redacted["nested"]["safe_field"] == "ok"
    assert "secret123" not in redacted["url"]
    assert "secret999" not in redact_url_secrets("https://s3/obj?X-Amz-Signature=secret999")


def test_pagination_sort_and_external_url_validation() -> None:
    page = PaginationParams.create(page=2, page_size=24)
    assert page.offset == 24
    with pytest.raises(ValidationAppError):
        PaginationParams.create(page=0)

    sort = SortSpec.from_allowlist(
        "UPDATED_DESC",
        allowed_fields=frozenset({"UPDATED_DESC", "RATING_DESC"}),
        direction=SortDirection.DESC,
    )
    assert sort.field == "UPDATED_DESC"
    with pytest.raises(ValidationAppError):
        SortSpec.from_allowlist("DROP TABLE mangas", allowed_fields=frozenset({"UPDATED_DESC"}))

    assert (
        validate_external_url("https://mangadex.org/title/abc") == "https://mangadex.org/title/abc"
    )
    with pytest.raises(ValidationAppError):
        validate_external_url("javascript:alert(1)")
