"""Explicit Dependency Injection composition root (`AppContainer`)."""

from __future__ import annotations

from manga_reader.common.audit import AuditLogWriter, InMemoryAuditLogWriter
from manga_reader.common.security import Argon2PasswordHasher, PasswordHasher
from manga_reader.config.settings import Settings
from manga_reader.infrastructure.cache import (
    CacheAdapter,
    CacheRateLimiter,
    InMemoryCacheAdapter,
    RedisCacheAdapter,
)
from manga_reader.infrastructure.database import DatabaseManager
from manga_reader.infrastructure.email import DevConsoleEmailAdapter, EmailAdapter
from manga_reader.infrastructure.outbox import InMemoryOutboxPublisher, OutboxPublisher
from manga_reader.infrastructure.storage import (
    LocalDevStorageAdapter,
    MediaUrlSigner,
    ObjectStorageAdapter,
    S3CompatibleStorageAdapter,
)
from manga_reader.workers.runner import BackgroundWorkerBoundary


class AppContainer:
    """Wires infrastructure adapters and shared services cleanly without global state."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db = DatabaseManager(settings)
        self.cache: CacheAdapter = self._build_cache(settings)
        self.rate_limiter = CacheRateLimiter(self.cache)
        self.storage: ObjectStorageAdapter = self._build_storage(settings)
        self.media_signer = MediaUrlSigner(
            signing_secret=settings.jwt_secret_key.get_secret_value(),
            public_base_url=settings.media_public_base_url,
            allowed_buckets=settings.allowed_buckets_set,
            default_ttl_seconds=settings.media_signed_url_ttl_seconds,
        )
        self.email: EmailAdapter = DevConsoleEmailAdapter(
            allow_dev_otp_log=settings.email_dev_log_otp
        )
        self.audit: AuditLogWriter = InMemoryAuditLogWriter()
        self.outbox: OutboxPublisher = InMemoryOutboxPublisher()
        self.password_hasher: PasswordHasher = Argon2PasswordHasher()
        self.worker = BackgroundWorkerBoundary()

    @staticmethod
    def _build_cache(settings: Settings) -> CacheAdapter:
        if settings.cache_backend == "redis":
            return RedisCacheAdapter(
                settings.redis_url,
                key_prefix=settings.redis_key_prefix,
            )
        return InMemoryCacheAdapter(key_prefix=settings.redis_key_prefix)

    @staticmethod
    def _build_storage(settings: Settings) -> ObjectStorageAdapter:
        if settings.storage_backend in ("minio", "s3"):
            access_key = settings.s3_access_key.get_secret_value()
            secret_key = settings.s3_secret_key.get_secret_value()
            has_creds = bool(access_key and secret_key)
            return S3CompatibleStorageAdapter(
                endpoint_url=settings.s3_endpoint_url,
                allowed_buckets=settings.allowed_buckets_set,
                credentials_configured=has_creds,
                access_key=access_key,
                secret_key=secret_key,
                region=settings.s3_region,
            )
        return LocalDevStorageAdapter(
            settings.resolved_local_storage_root,
            allowed_buckets=settings.allowed_buckets_set,
        )

    async def startup(self) -> None:
        await self.worker.start()

    async def shutdown(self) -> None:
        await self.worker.stop()
        await self.cache.close()
        await self.db.dispose()
