"""ORM models for Media, Manga, Creators, Tags, Chapters, Pages, and ETL/CDC."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from manga_reader.common.clock import utc_now
from manga_reader.infrastructure.database import Base
from manga_reader.infrastructure.orm.types import GUID, UTCDateTime


class MediaObjectModel(Base):
    __tablename__ = "media_objects"
    __table_args__ = (
        UniqueConstraint("bucket", "object_key", name="UQ_media_objects_location"),
        CheckConstraint("file_size >= 0", name="file_size_nonneg"),
        CheckConstraint("width IS NULL OR width >= 1", name="width_pos"),
        CheckConstraint("height IS NULL OR height >= 1", name="height_pos"),
        CheckConstraint(
            "gc_status IN ('ACTIVE', 'PENDING_GC', 'DELETED')",
            name="gc_status_enum",
        ),
        Index("IX_media_objects_md5", "md5_hash"),
    )

    media_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    bucket: Mapped[str] = mapped_column(String(63), nullable=False)
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    md5_hash: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gc_status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class MangaModel(Base):
    __tablename__ = "mangas"
    __table_args__ = (
        CheckConstraint(
            "publication_status IN ('ongoing', 'completed', 'hiatus', 'cancelled', 'unknown')",
            name="pub_status_enum",
        ),
        CheckConstraint(
            "content_rating IN ('safe', 'suggestive', 'erotica', 'pornographic', 'unknown')",
            name="content_rating_enum",
        ),
        CheckConstraint(
            "publication_demographic IN "
            "('shounen', 'shoujo', 'seinen', 'josei', 'kodomo', 'unknown')",
            name="demographic_enum",
        ),
        CheckConstraint("visibility_status IN ('PUBLIC', 'HIDDEN')", name="visibility_enum"),
        CheckConstraint(
            "deletion_status IN ('ACTIVE', 'DELETING', 'TOMBSTONED')",
            name="deletion_status_enum",
        ),
        CheckConstraint("year IS NULL OR (year >= 1800 AND year <= 2200)", name="year_range"),
        CheckConstraint("total_views >= 0", name="total_views_nonneg"),
        CheckConstraint("average_rating >= 0", name="avg_rating_nonneg"),
        Index("IX_mangas_visibility_updated", "visibility_status", "updated_at"),
        Index("IX_mangas_title", "title"),
    )

    manga_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    pool_manga_id: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    source_manga_id: Mapped[str] = mapped_column(String(255), nullable=False)
    mangadex_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    publication_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    content_rating: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    publication_demographic: Mapped[str] = mapped_column(
        String(20), nullable=False, default="unknown"
    )
    original_language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    published_start_date: Mapped[str | None] = mapped_column(String(100), nullable=True)
    published_end_date: Mapped[str | None] = mapped_column(String(100), nullable=True)
    official_volumes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    official_chapters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    primary_cover_media_id: Mapped[int | None] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("media_objects.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    visibility_status: Mapped[str] = mapped_column(String(10), nullable=False, default="PUBLIC")
    deletion_status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    is_cdc_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_syncing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ignore_all_reports: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    total_views: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    average_rating: Mapped[Decimal] = mapped_column(
        Numeric(6, 3), nullable=False, default=Decimal("0.000")
    )
    latest_chapter_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class MangaDeletionTombstoneModel(Base):
    """Durable tombstone preventing delayed CDC events from resurrecting deleted manga (ADR-011)."""

    __tablename__ = "manga_deletion_tombstones"

    pool_manga_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    manga_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    manga_title_snapshot: Mapped[str] = mapped_column(String(500), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    deleted_by_admin_account_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    deleted_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class MangaAltTitleModel(Base):
    __tablename__ = "manga_alt_titles"
    __table_args__ = (Index("IX_manga_alt_titles_manga", "manga_id"),)

    alt_title_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    language_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    alternative_title: Mapped[str] = mapped_column(String(500), nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


class CreatorModel(Base):
    __tablename__ = "creators"
    __table_args__ = (Index("IX_creators_name", "name"),)

    creator_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    mangadex_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    biography: Mapped[str | None] = mapped_column(Text, nullable=True)


class CreatorBiographyModel(Base):
    __tablename__ = "creator_biographies"

    creator_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("creators.creator_id", ondelete="CASCADE"), primary_key=True
    )
    language_code: Mapped[str] = mapped_column(String(16), primary_key=True)
    biography: Mapped[str] = mapped_column(Text, nullable=False)


class CreatorLinkModel(Base):
    __tablename__ = "creator_links"

    creator_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("creators.creator_id", ondelete="CASCADE"), primary_key=True
    )
    platform: Mapped[str] = mapped_column(String(100), primary_key=True)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)


class MangaCreatorModel(Base):
    __tablename__ = "manga_creators"
    __table_args__ = (
        CheckConstraint("role IN ('author', 'artist')", name="creator_role_enum"),
        Index("IX_manga_creators_creator", "creator_id", "role", "manga_id"),
    )

    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), primary_key=True
    )
    creator_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("creators.creator_id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(10), primary_key=True)


class TagModel(Base):
    __tablename__ = "tags"
    __table_args__ = (
        CheckConstraint(
            "tag_group IN ('genre', 'theme', 'format', 'content', 'other')",
            name="tag_group_enum",
        ),
    )

    tag_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    source_tag_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    mangadex_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tag_group: Mapped[str] = mapped_column(String(20), nullable=False, default="genre")
    name: Mapped[str] = mapped_column(String(200), nullable=False)


class TagNameModel(Base):
    __tablename__ = "tag_names"

    tag_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("tags.tag_id", ondelete="CASCADE"),
        primary_key=True,
    )
    language_code: Mapped[str] = mapped_column(String(16), primary_key=True)
    tag_name: Mapped[str] = mapped_column(String(200), nullable=False)


class MangaTagModel(Base):
    __tablename__ = "manga_tags"
    __table_args__ = (Index("IX_manga_tags_tag", "tag_id", "manga_id"),)

    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("tags.tag_id", ondelete="CASCADE"),
        primary_key=True,
    )


class MangaLinkModel(Base):
    __tablename__ = "manga_links"

    manga_link_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    site: Mapped[str] = mapped_column(String(100), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)


class MangaCoverArtModel(Base):
    __tablename__ = "manga_cover_arts"

    cover_art_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    cover_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    volume: Mapped[str | None] = mapped_column(String(40), nullable=True)
    locale: Mapped[str | None] = mapped_column(String(16), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    media_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("media_objects.media_id", ondelete="NO ACTION"),
        nullable=False,
    )


class MangaStatsModel(Base):
    __tablename__ = "manga_stats"
    __table_args__ = (
        CheckConstraint("chapter_count >= 0", name="chapter_count_nonneg"),
        CheckConstraint("page_count >= 0", name="page_count_nonneg"),
        CheckConstraint("total_size_bytes >= 0", name="total_size_nonneg"),
    )

    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), primary_key=True
    )
    chapter_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class MangaStatsLanguageModel(Base):
    __tablename__ = "manga_stats_languages"

    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), primary_key=True
    )
    language_code: Mapped[str] = mapped_column(String(16), primary_key=True)


class MangaLineageModel(Base):
    __tablename__ = "manga_lineage"
    __table_args__ = (
        CheckConstraint("pool_revision >= 1", name="pool_rev_pos"),
        CheckConstraint("source_metadata_revision >= 1", name="src_rev_pos"),
    )

    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), primary_key=True
    )
    pool_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source_metadata_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class MangaContentVectorModel(Base):
    __tablename__ = "manga_content_vectors"

    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), primary_key=True
    )
    feature_vector_json: Mapped[str] = mapped_column(Text, nullable=False)
    model_version: Mapped[str] = mapped_column(String(32), nullable=False, default="tfidf-v1")
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class MangaModerationLogModel(Base):
    __tablename__ = "manga_moderation_logs"
    __table_args__ = (
        CheckConstraint("action_type IN ('HIDE', 'SHOW', 'DELETE')", name="mod_action_enum"),
    )

    moderation_log_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    admin_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("admins.account_id", ondelete="NO ACTION"), nullable=False
    )
    manga_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    pool_manga_id: Mapped[str] = mapped_column(String(80), nullable=False)
    manga_title_snapshot: Mapped[str] = mapped_column(String(500), nullable=False)
    action_type: Mapped[str] = mapped_column(String(10), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_report_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ChapterModel(Base):
    __tablename__ = "chapters"
    __table_args__ = (
        CheckConstraint("page_count >= 0", name="ch_page_count_nonneg"),
        CheckConstraint("total_size_bytes >= 0", name="ch_total_size_nonneg"),
        CheckConstraint("pages_revision >= 1", name="ch_pages_rev_pos"),
        CheckConstraint("view_count >= 0", name="ch_view_count_nonneg"),
        Index(
            "IX_chapters_canonical_order",
            "manga_id",
            "chapter_numeric",
            "language",
            "pool_chapter_id",
        ),
    )

    chapter_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    pool_chapter_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    source_chapter_id: Mapped[str] = mapped_column(String(255), nullable=False)
    chapter_number: Mapped[str] = mapped_column(String(50), nullable=False)
    chapter_numeric: Mapped[Decimal] = mapped_column(
        Numeric(18, 6), nullable=False, default=Decimal("0")
    )
    volume: Mapped[str | None] = mapped_column(String(40), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    scanlation_group: Mapped[str | None] = mapped_column(String(255), nullable=True)
    publish_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    source: Mapped[str] = mapped_column(String(100), nullable=False, default="mangadex")
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    pages_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    view_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ChapterPageModel(Base):
    __tablename__ = "chapter_pages"
    __table_args__ = (
        UniqueConstraint("chapter_id", "page_number", name="UQ_chapter_pages_number"),
        CheckConstraint("page_number >= 1", name="page_number_pos"),
        Index("IX_chapter_pages_media", "media_id"),
    )

    page_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    chapter_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chapters.chapter_id", ondelete="CASCADE"), nullable=False
    )
    page_uid: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("media_objects.media_id", ondelete="NO ACTION"),
        nullable=False,
    )


class EtlJobModel(Base):
    __tablename__ = "etl_jobs"
    __table_args__ = (
        CheckConstraint(
            "job_type IN ('INITIAL_IMPORT', 'BATCH_IMPORT', 'RESYNC', 'CDC_UPSERT', 'DELETE')",
            name="etl_job_type_enum",
        ),
        CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED')",
            name="etl_job_status_enum",
        ),
        CheckConstraint("batch_size > 0", name="etl_batch_pos"),
        CheckConstraint("retry_count >= 0", name="etl_retry_nonneg"),
    )

    job_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    requested_by_admin_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("admins.account_id", ondelete="SET NULL"), nullable=True
    )
    job_type: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="QUEUED")
    source_system: Mapped[str | None] = mapped_column(String(100), nullable=True)
    batch_size: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)


class EtlJobItemModel(Base):
    __tablename__ = "etl_job_items"
    __table_args__ = (
        CheckConstraint(
            "status IN ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'SKIPPED')",
            name="etl_item_status_enum",
        ),
        CheckConstraint("attempt_count >= 0", name="etl_item_attempts_nonneg"),
        Index("IX_etl_job_items_job_status", "job_id", "status"),
        Index("IX_etl_job_items_pool", "pool_manga_id"),
    )

    job_item_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("etl_jobs.job_id", ondelete="CASCADE"), nullable=False
    )
    manga_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="SET NULL"), nullable=True
    )
    source_manga_id: Mapped[str] = mapped_column(String(255), nullable=False)
    pool_manga_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    enable_cdc: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    contract_name: Mapped[str] = mapped_column(
        String(100), nullable=False, default="manga-reader-package"
    )
    contract_version: Mapped[str] = mapped_column(String(20), nullable=False, default="2.0")
    exported_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    payload_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    manifest_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="QUEUED")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    checksum_validated: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class MangaSyncSubscriptionModel(Base):
    __tablename__ = "manga_sync_subscriptions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'FAILED')",
            name="sync_sub_status_enum",
        ),
    )

    subscription_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False, unique=True
    )
    provider_subscription_key: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    subscribed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    unsubscribed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_event_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class CdcEventModel(Base):
    __tablename__ = "cdc_events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')",
            name="cdc_status_enum",
        ),
        CheckConstraint("retry_count >= 0", name="cdc_retry_nonneg"),
        Index("IX_cdc_events_status_received", "status", "received_at"),
    )

    event_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    manga_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="SET NULL"), nullable=True
    )
    external_event_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    pool_manga_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    pool_chapter_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pool_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    payload_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
