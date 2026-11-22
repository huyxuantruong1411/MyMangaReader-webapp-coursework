"""Centralized, validated application configuration.

Numeric NFR settings are explicitly documented as configurable project defaults
per ADR-015 because exact thresholds are absent from the original Lab8 source.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnvironment = Literal["development", "test", "staging", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["json", "console"]
DatabaseBackend = Literal["sqlite", "mssql", "postgres"]
CacheBackend = Literal["memory", "redis"]
StorageBackend = Literal["local-dev", "minio", "s3"]
MediaUrlMode = Literal["proxy", "presigned"]
EmailBackend = Literal["dev-console", "smtp"]
PasswordHashAlgorithm = Literal["argon2id", "bcrypt"]

DEV_DEFAULT_JWT_SECRET = "dev-only-insecure-secret-change-me-at-least-32-bytes"  # noqa: S105

# Repository root resolved safely from apps/api/src/manga_reader/config/settings.py
REPO_ROOT = Path(__file__).resolve().parents[5]


class Settings(BaseSettings):
    """Typed, validated environment settings for the Manga Reader backend."""

    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Application
    app_name: str = "Manga Reader API"
    app_env: AppEnvironment = "development"
    app_version: str = "0.1.0"
    app_debug: bool = True
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"

    # Server
    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8020, ge=1, le=65535)
    api_prefix: str = "/api/v1"
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Database
    database_backend: DatabaseBackend = "sqlite"
    database_url: str = "sqlite+aiosqlite:///./storage/local-dev/dev.sqlite3"
    database_echo: bool = False
    database_pool_size: int = Field(default=5, ge=1, le=100)
    database_max_overflow: int = Field(default=10, ge=0, le=200)
    database_connect_timeout_seconds: int = Field(default=10, ge=1, le=120)

    # Security & Auth
    jwt_secret_key: SecretStr = SecretStr(DEV_DEFAULT_JWT_SECRET)
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_ttl_days: int = Field(default=14, ge=1, le=90)
    password_hash_algorithm: PasswordHashAlgorithm = "argon2id"  # noqa: S105

    # OTP (ADR-004: 120s TTL from Lab9 sequence)
    otp_ttl_seconds: int = Field(default=120, ge=30, le=900)
    otp_length: int = Field(default=6, ge=4, le=10)
    otp_max_attempts: int = Field(default=5, ge=1, le=20)
    otp_resend_cooldown_seconds: int = Field(default=60, ge=10, le=600)

    # Cache
    cache_backend: CacheBackend = "memory"
    redis_url: str = "redis://127.0.0.1:6379/1"
    redis_key_prefix: str = "mreader:"

    # Object Storage & Media Delivery (ADR-018)
    storage_backend: StorageBackend = "local-dev"
    local_storage_root: str = "./storage/local-dev"
    s3_endpoint_url: str = "http://127.0.0.1:9010"
    s3_region: str = "us-east-1"
    s3_access_key: SecretStr = SecretStr("")
    s3_secret_key: SecretStr = SecretStr("")
    s3_allowed_buckets: str = "manga-reader-media,manga-media"
    s3_default_bucket: str = "manga-reader-media"
    media_url_mode: MediaUrlMode = "proxy"
    media_signed_url_ttl_seconds: int = Field(default=300, ge=30, le=3600)
    media_public_base_url: str = Field(
        default="http://127.0.0.1:8020/api/v1/media",
        validation_alias="MEDIA_PUBLIC_BASE_URL",
    )

    # Email
    email_backend: EmailBackend = "smtp"
    smtp_host: str = Field(
        default="smtp.gmail.com",
        validation_alias=AliasChoices("SMTP_HOST", "SMTP_SERVER", "smtp_host"),
    )
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = Field(
        default="",
        validation_alias=AliasChoices("SMTP_USERNAME", "SMTP_ACCOUNT", "smtp_username"),
    )
    smtp_password: SecretStr = SecretStr("")
    smtp_from_address: str = "noreply@manga-reader.local"
    email_dev_log_otp: bool = False

    # External Source / ETL / CDC & Local Reading Fallbacks
    external_etl_enabled: bool = True
    mangadex_fallback_enabled: bool = False
    mangadex_data_saver: bool = True
    upstream_source_base_url: str = ""
    upstream_webhook_secret: SecretStr = SecretStr("")
    etl_max_package_bytes: int = Field(default=52_428_800, ge=1024)

    # Configurable NFR & Policy Targets (ADR-015 — project defaults, NOT Lab8 hard SLOs)
    catalog_default_page_size: int = Field(default=24, ge=1, le=100)
    catalog_max_page_size: int = Field(default=100, ge=1, le=500)
    autocomplete_max_results: int = Field(default=10, ge=1, le=50)
    reader_default_preload_pages: int = Field(default=3, ge=0, le=20)
    reader_max_preload_pages: int = Field(default=10, ge=1, le=50)
    valid_view_threshold_seconds: int = Field(default=15, ge=1, le=3600)
    valid_view_dedupe_window_seconds: int = Field(default=300, ge=0, le=86400)
    password_min_length: int = Field(default=8, ge=8, le=128)
    avatar_max_bytes: int = Field(default=5_242_880, ge=1024)
    comment_max_length: int = Field(default=2000, ge=1, le=10000)
    login_rate_limit_max_attempts: int = Field(default=10, ge=1, le=100)
    login_rate_limit_window_seconds: int = Field(default=300, ge=10, le=86400)
    api_rate_limit_per_minute: int = Field(default=120, ge=10, le=10000)

    @field_validator("api_prefix")
    @classmethod
    def validate_api_prefix(cls, value: str) -> str:
        if not value.startswith("/"):
            raise ValueError("api_prefix must start with '/'")
        return value.rstrip("/") or "/"

    @model_validator(mode="after")
    def validate_cross_field_invariants(self) -> Settings:
        secret = self.jwt_secret_key.get_secret_value()
        if len(secret) < 32:
            raise ValueError("JWT_SECRET_KEY must be at least 32 characters long.")
        if self.app_env in ("staging", "production"):
            if secret == DEV_DEFAULT_JWT_SECRET:
                raise ValueError(
                    "Default development JWT_SECRET_KEY is forbidden in staging/production."
                )
            if self.app_debug:
                raise ValueError("APP_DEBUG must be false in staging/production.")
            if self.email_dev_log_otp:
                raise ValueError("EMAIL_DEV_LOG_OTP must be false in staging/production.")
            if self.cache_backend == "memory":
                raise ValueError(
                    "In-memory cache is single-process dev-only; use Redis in staging/production."
                )
            if self.storage_backend == "local-dev":
                raise ValueError(
                    "local-dev storage adapter is forbidden in staging/production; use S3/MinIO."
                )
        if self.catalog_default_page_size > self.catalog_max_page_size:
            raise ValueError("CATALOG_DEFAULT_PAGE_SIZE cannot exceed CATALOG_MAX_PAGE_SIZE.")
        if self.reader_default_preload_pages > self.reader_max_preload_pages:
            raise ValueError("READER_DEFAULT_PRELOAD_PAGES cannot exceed READER_MAX_PRELOAD_PAGES.")
        if self.s3_default_bucket not in self.allowed_buckets_set:
            raise ValueError("S3_DEFAULT_BUCKET must be included in S3_ALLOWED_BUCKETS.")
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    @property
    def allowed_buckets_set(self) -> frozenset[str]:
        return frozenset(b.strip() for b in self.s3_allowed_buckets.split(",") if b.strip())

    @property
    def resolved_local_storage_root(self) -> Path:
        raw = Path(self.local_storage_root)
        return raw if raw.is_absolute() else (REPO_ROOT / raw).resolve()

    @property
    def resolved_database_url(self) -> str:
        """Resolve relative SQLite paths consistently from the repository root."""
        if self.database_url.startswith("sqlite+aiosqlite:///./"):
            rel = self.database_url.removeprefix("sqlite+aiosqlite:///./")
            target = (REPO_ROOT / rel).resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite+aiosqlite:///{target.as_posix()}"
        return self.database_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings singleton for process runtime."""
    return Settings()
