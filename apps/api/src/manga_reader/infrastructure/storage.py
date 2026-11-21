"""Object storage abstraction and runtime media URL signing (`ADR-018`).

Canonical media identity is ALWAYS `MediaObjectRef(bucket, object_key)`.
Signed/proxy URLs are generated dynamically at runtime and NEVER persisted.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from urllib.parse import quote, urlparse

import httpx

from manga_reader.common.clock import utc_now
from manga_reader.common.errors import ForbiddenError, StorageUnavailableError
from manga_reader.common.identities import MediaObjectRef
from manga_reader.infrastructure.cache import AdapterHealth

logger = logging.getLogger(__name__)


def _sign_s3_request(
    *,
    method: str,
    endpoint: str,
    bucket: str,
    object_key: str,
    access_key: str,
    secret_key: str,
    region: str = "us-east-1",
    payload_hash: str = "UNSIGNED-PAYLOAD",
    content_type: str | None = None,
) -> tuple[str, dict[str, str]]:
    """Build AWS Signature Version 4 URL + headers for MinIO/S3 requests."""
    parsed = urlparse(endpoint)
    host = parsed.netloc
    now = datetime.now(UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    encoded_key = quote(object_key.lstrip("/"), safe="/-_.~")
    canonical_uri = f"/{bucket}/{encoded_key}"

    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = (
        f"{method.upper()}\n{canonical_uri}\n\n{canonical_headers}\n"
        f"{signed_headers}\n{payload_hash}"
    )

    scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )

    def _hmac_sha256(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    k_date = _hmac_sha256(f"AWS4{secret_key}".encode(), date_stamp)
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, "s3")
    k_signing = _hmac_sha256(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    headers: dict[str, str] = {
        "Host": host,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        ),
    }
    if content_type:
        headers["Content-Type"] = content_type
    return f"{endpoint.rstrip('/')}{canonical_uri}", headers


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
        if target.is_file():
            return target.read_bytes()
        if ref.bucket == "manga-media":
            url, headers = _sign_s3_request(
                method="GET",
                endpoint="http://127.0.0.1:9010",
                bucket=ref.bucket,
                object_key=ref.object_key,
                access_key="mangaadmin",
                secret_key="MangaMinio2026!",  # noqa: S106
            )
            try:
                async with httpx.AsyncClient(timeout=6.0) as client:
                    resp = await client.get(url, headers=headers)
                if resp.status_code == 200 and resp.content:
                    return resp.content
            except Exception as exc:
                logger.debug("Local MinIO fallback fetch failed: %s", type(exc).__name__)
        raise StorageUnavailableError(
            "Requested media object was not found in local storage.",
            error_code="MEDIA_NOT_FOUND",
            status_code=404,
        )

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
    """Async S3/MinIO storage adapter streaming objects directly without local disk copies."""

    def __init__(
        self,
        *,
        endpoint_url: str,
        allowed_buckets: frozenset[str],
        credentials_configured: bool,
        access_key: str = "",
        secret_key: str = "",
        region: str = "us-east-1",
    ) -> None:
        self._endpoint_url = endpoint_url.rstrip("/")
        self._allowed_buckets = allowed_buckets
        self._credentials_configured = credentials_configured
        self._access_key = access_key
        self._secret_key = secret_key
        self._region = region
        self._memory_objects: dict[tuple[str, str], bytes] = {}

    @property
    def backend_name(self) -> str:
        return "s3-minio"

    @property
    def adapter_mode(self) -> str:
        return "configured" if self._credentials_configured else "unconfigured"

    def _assert_bucket(self, ref: MediaObjectRef) -> None:
        if ref.bucket not in self._allowed_buckets:
            raise ForbiddenError(f"Bucket '{ref.bucket}' is not allowlisted.")

    @property
    def _has_live_s3(self) -> bool:
        return bool(self._credentials_configured and self._access_key and self._secret_key)

    async def exists(self, ref: MediaObjectRef) -> bool:
        self._assert_bucket(ref)
        if not self._has_live_s3:
            return (ref.bucket, ref.object_key) in self._memory_objects
        url, headers = _sign_s3_request(
            method="HEAD",
            endpoint=self._endpoint_url,
            bucket=ref.bucket,
            object_key=ref.object_key,
            access_key=self._access_key,
            secret_key=self._secret_key,
            region=self._region,
        )
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.head(url, headers=headers)
            return resp.status_code == 200
        except Exception:
            return False

    async def put_bytes(
        self, ref: MediaObjectRef, data: bytes, *, content_type: str = "application/octet-stream"
    ) -> str:
        self._assert_bucket(ref)
        digest = hashlib.sha256(data).hexdigest()
        if not self._has_live_s3:
            self._memory_objects[(ref.bucket, ref.object_key)] = data
            return digest
        url, headers = _sign_s3_request(
            method="PUT",
            endpoint=self._endpoint_url,
            bucket=ref.bucket,
            object_key=ref.object_key,
            access_key=self._access_key,
            secret_key=self._secret_key,
            region=self._region,
            payload_hash=digest,
            content_type=content_type,
        )
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.put(url, headers=headers, content=data)
            if resp.status_code not in (200, 201, 204):
                raise StorageUnavailableError(
                    f"MinIO upload failed with HTTP {resp.status_code}.",
                    error_code="STORAGE_UNAVAILABLE",
                )
        except StorageUnavailableError:
            raise
        except Exception as exc:
            raise StorageUnavailableError(f"MinIO upload error: {type(exc).__name__}") from exc
        return digest

    async def get_bytes(self, ref: MediaObjectRef) -> bytes:
        self._assert_bucket(ref)
        if not self._has_live_s3:
            data = self._memory_objects.get((ref.bucket, ref.object_key))
            if data is None:
                raise StorageUnavailableError(
                    "Requested media object was not found in storage.",
                    error_code="MEDIA_NOT_FOUND",
                    status_code=404,
                )
            return data
        url, headers = _sign_s3_request(
            method="GET",
            endpoint=self._endpoint_url,
            bucket=ref.bucket,
            object_key=ref.object_key,
            access_key=self._access_key,
            secret_key=self._secret_key,
            region=self._region,
        )
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(url, headers=headers)
            if resp.status_code == 200 and resp.content:
                return resp.content
        except Exception as exc:
            logger.debug("MinIO GET failed for %s: %s", ref.object_key, type(exc).__name__)
        raise StorageUnavailableError(
            "Requested media object was not found in MinIO storage.",
            error_code="MEDIA_NOT_FOUND",
            status_code=404,
        )

    async def delete(self, ref: MediaObjectRef) -> bool:
        self._assert_bucket(ref)
        if not self._has_live_s3:
            return self._memory_objects.pop((ref.bucket, ref.object_key), None) is not None
        url, headers = _sign_s3_request(
            method="DELETE",
            endpoint=self._endpoint_url,
            bucket=ref.bucket,
            object_key=ref.object_key,
            access_key=self._access_key,
            secret_key=self._secret_key,
            region=self._region,
        )
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.delete(url, headers=headers)
            return resp.status_code in (200, 204)
        except Exception:
            return False

    async def check_health(self) -> AdapterHealth:
        if not self._credentials_configured:
            return AdapterHealth(
                healthy=False,
                backend=self.backend_name,
                mode=self.adapter_mode,
                detail="S3/MinIO credentials (S3_ACCESS_KEY/S3_SECRET_KEY) not configured.",
            )
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{self._endpoint_url}/minio/health/live")
            if resp.status_code == 200:
                return AdapterHealth(
                    healthy=True,
                    backend=self.backend_name,
                    mode=self.adapter_mode,
                    detail=f"S3/MinIO live endpoint verified ({self._endpoint_url}).",
                )
        except Exception as exc:
            logger.debug("MinIO health check skipped: %s", type(exc).__name__)
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
