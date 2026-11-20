"""Object storage abstraction and runtime media URL signing (`ADR-018`).

Canonical media identity is ALWAYS `MediaObjectRef(bucket, object_key)`.
Signed/proxy URLs are generated dynamically at runtime and NEVER persisted.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

from manga_reader.common.clock import utc_now
from manga_reader.common.errors import ForbiddenError, StorageUnavailableError
from manga_reader.common.identities import MediaObjectRef
from manga_reader.infrastructure.cache import AdapterHealth

logger = logging.getLogger(__name__)


class ObjectStorageAdapter(Protocol):
    """Vendor-agnostic object storage protocol keyed by `MediaObjectRef`."""

    @property
    def backend_name(self) -> str: ...
    @property
    def adapter_mode(self) -> str: ...
    async def exists(self, ref: MediaObjectRef) -> bool: ...
    async def put_bytes(
        self, ref: MediaObjectRef, data: bytes, *, content_type: str = "application/octet-stream"
    ) -> str: ...
    async def get_bytes(self, ref: MediaObjectRef) -> bytes: ...
    async def delete(self, ref: MediaObjectRef) -> bool: ...
    async def check_health(self) -> AdapterHealth: ...


class LocalDevStorageAdapter:
    """Filesystem-backed storage adapter for local development & tests (`storage/local-dev/`)."""

    def __init__(self, root_dir: Path, *, allowed_buckets: frozenset[str]) -> None:
        self._root = root_dir.resolve()
        self._allowed_buckets = allowed_buckets
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def backend_name(self) -> str:
        return "local-dev"

    @property
    def adapter_mode(self) -> str:
        return "dev-fallback"

    def _resolve_safe_path(self, ref: MediaObjectRef) -> Path:
        if ref.bucket not in self._allowed_buckets:
            raise ForbiddenError(
                f"Bucket '{ref.bucket}' is not in S3_ALLOWED_BUCKETS.",
                details={"bucket": ref.bucket},
            )
        target = (self._root / ref.bucket / ref.object_key).resolve()
        bucket_root = (self._root / ref.bucket).resolve()
        if not target.is_relative_to(bucket_root):
            raise ForbiddenError("Resolved storage path escapes bucket root.")
        return target

    async def exists(self, ref: MediaObjectRef) -> bool:
        return self._resolve_safe_path(ref).is_file()

    async def put_bytes(
        self, ref: MediaObjectRef, data: bytes, *, content_type: str = "application/octet-stream"
    ) -> str:
        _ = content_type
        target = self._resolve_safe_path(ref)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return hashlib.sha256(data).hexdigest()

    async def get_bytes(self, ref: MediaObjectRef) -> bytes:
        target = self._resolve_safe_path(ref)
        if not target.is_file():
            raise StorageUnavailableError(
                "Requested media object was not found in local storage.",
                error_code="MEDIA_NOT_FOUND",
                status_code=404,
            )
        return target.read_bytes()

    async def delete(self, ref: MediaObjectRef) -> bool:
        target = self._resolve_safe_path(ref)
        if target.is_file():
            target.unlink()
            return True
        return False

    async def check_health(self) -> AdapterHealth:
        writable = self._root.exists() and self._root.is_dir()
        return AdapterHealth(
            healthy=writable,
            backend=self.backend_name,
            mode=self.adapter_mode,
            detail=f"Local development storage directory ready at {self._root.name}.",
        )


class S3CompatibleStorageAdapter:
    """Configuration-ready S3/MinIO adapter boundary (wired for Phase 3/6 media I/O)."""

    def __init__(
        self,
        *,
        endpoint_url: str,
        allowed_buckets: frozenset[str],
        credentials_configured: bool,
    ) -> None:
        self._endpoint_url = endpoint_url
        self._allowed_buckets = allowed_buckets
        self._credentials_configured = credentials_configured

    @property
    def backend_name(self) -> str:
        return "s3-minio"

    @property
    def adapter_mode(self) -> str:
        return "configured" if self._credentials_configured else "unconfigured"

    def _assert_bucket(self, ref: MediaObjectRef) -> None:
        if ref.bucket not in self._allowed_buckets:
            raise ForbiddenError(f"Bucket '{ref.bucket}' is not allowlisted.")

    async def exists(self, ref: MediaObjectRef) -> bool:
        self._assert_bucket(ref)
        raise StorageUnavailableError("S3/MinIO object operations activate in Phase 3 ETL.")

    async def put_bytes(
        self, ref: MediaObjectRef, data: bytes, *, content_type: str = "application/octet-stream"
    ) -> str:
        self._assert_bucket(ref)
        _ = (data, content_type)
        raise StorageUnavailableError("S3/MinIO object operations activate in Phase 3 ETL.")

    async def get_bytes(self, ref: MediaObjectRef) -> bytes:
        self._assert_bucket(ref)
        raise StorageUnavailableError("S3/MinIO object operations activate in Phase 3 ETL.")

    async def delete(self, ref: MediaObjectRef) -> bool:
        self._assert_bucket(ref)
        raise StorageUnavailableError("S3/MinIO object operations activate in Phase 3 ETL.")

    async def check_health(self) -> AdapterHealth:
        if not self._credentials_configured:
            return AdapterHealth(
                healthy=False,
                backend=self.backend_name,
                mode=self.adapter_mode,
                detail="S3/MinIO credentials (S3_ACCESS_KEY/S3_SECRET_KEY) not configured.",
            )
        return AdapterHealth(
            healthy=True,
            backend=self.backend_name,
            mode=self.adapter_mode,
            detail=f"S3/MinIO endpoint configured ({self._endpoint_url}).",
        )


class MediaUrlSigner:
    """Generates short-lived runtime URLs from canonical `MediaObjectRef` (`ADR-018`)."""

    def __init__(
        self,
        *,
        signing_secret: str,
        public_base_url: str,
        allowed_buckets: frozenset[str],
        default_ttl_seconds: int = 300,
    ) -> None:
        self._secret = signing_secret
        self._base_url = public_base_url.rstrip("/")
        self._allowed_buckets = allowed_buckets
        self._default_ttl = default_ttl_seconds

    def build_signed_proxy_url(
        self,
        ref: MediaObjectRef,
        *,
        revision: int | None = None,
        ttl_seconds: int | None = None,
    ) -> str:
        """Create an HMAC-signed runtime URL without persisting URLs in the database."""
        if ref.bucket not in self._allowed_buckets:
            raise ForbiddenError(f"Bucket '{ref.bucket}' is not allowlisted.")
        ttl = self._default_ttl if ttl_seconds is None else ttl_seconds
        exp = int(utc_now().timestamp()) + max(ttl, 1)
        rev_part = f":{revision}" if revision is not None else ""
        canonical = f"{ref.bucket}/{ref.object_key}:{exp}{rev_part}"
        sig = hmac.new(
            self._secret.encode("utf-8"),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:32]
        encoded_key = quote(ref.object_key, safe="/")
        rev_query = f"&rev={revision}" if revision is not None else ""
        return f"{self._base_url}/{ref.bucket}/{encoded_key}?exp={exp}{rev_query}&sig={sig}"

    def verify_signed_proxy_url(
        self,
        ref: MediaObjectRef,
        *,
        exp: int,
        sig: str,
        revision: int | None = None,
    ) -> bool:
        """Verify HMAC signature and expiry for proxy media streaming."""
        if ref.bucket not in self._allowed_buckets:
            return False
        if exp < int(utc_now().timestamp()):
            return False
        rev_part = f":{revision}" if revision is not None else ""
        canonical = f"{ref.bucket}/{ref.object_key}:{exp}{rev_part}"
        expected = hmac.new(
            self._secret.encode("utf-8"),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:32]
        return hmac.compare_digest(expected, sig)
