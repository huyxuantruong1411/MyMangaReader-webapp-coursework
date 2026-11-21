"""Full SQL Server catalog & social sync: `MangaLibrary` -> `QL_DocTruyen` + MinIO references.

Utilizes 100% of the catalog and community tables in local SQL Server (`MangaLibrary`):
- Tags (`tags`, `tag_names` EN/VI)
- Creators & biographies (`creators`, `creator_biographies`)
- Canonical MinIO media addresses (`media_objects` with `bucket='manga-media'`) WITHOUT copying image files to disk
- All manga (`mangas`, `manga_cover_arts`, `manga_alt_titles`, `manga_links`, `manga_tags`, `manga_creators`,
  `manga_stats`, `manga_stats_languages`, `manga_lineage`, `manga_content_vectors`) + 1 `unknown` content-rating test sample
- All readable chapters (`chapters`, ~1.76M rows inserted in chunked set-based T-SQL batches)
- Accounts, readers, admins, settings, reading statuses, reading histories, reader progress, ratings,
  comments, comment reactions, reading lists, list items, and reports + demo accounts (`admin`, `reader1`, `reader2`).

Safe & idempotent to re-run via `pnpm db:import-local`.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pyodbc
from sqlalchemy import func, select

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from manga_reader.common.clock import utc_now  # noqa: E402
from manga_reader.common.identities import AccountId  # noqa: E402
from manga_reader.common.security import AccountRole, AccountStatus, SecurityPrincipal  # noqa: E402
from manga_reader.config.settings import Settings  # noqa: E402
from manga_reader.infrastructure.container import AppContainer  # noqa: E402
from manga_reader.infrastructure.orm import (  # noqa: E402
    AccountModel,
    AdminModel,
    ChapterModel,
    ChapterPageModel,
    CommentModel,
    MangaContentVectorModel,
    MangaCoverArtModel,
    MangaCreatorModel,
    MangaLineageModel,
    MangaModel,
    MangaStatsLanguageModel,
    MangaStatsModel,
    MangaTagModel,
    MediaObjectModel,
    RatingModel,
    ReaderModel,
    ReaderProgressModel,
    ReaderSettingsModel,
    ReadingHistoryModel,
    ReadingStatusRecordModel,
    TagModel,
    TagNameModel,
)
from manga_reader.modules.etl_cdc.application.service import (  # noqa: E402
    compute_content_feature_vector,
)
from manga_reader.modules.moderation_reporting.application.service import (  # noqa: E402
    ModerationReportingService,
)
from manga_reader.modules.reading_lists.application.service import (  # noqa: E402
    ReadingListService,
)

SOURCE_DB = "MangaLibrary"
TARGET_DB = "QL_DocTruyen"
MINIO_DEFAULT_BUCKET = "manga-media"

TARGET_MSSQL_CONN = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    f"SERVER=localhost;DATABASE={TARGET_DB};"
    "Trusted_Connection=yes;TrustServerCertificate=yes;MARS_Connection=yes;"
)

VI_TAG_NAMES: dict[str, str] = {
    "action": "Hành động",
    "adventure": "Phiêu lưu",
    "comedy": "Hài hước",
    "drama": "Chính kịch",
    "fantasy": "Giả tưởng",
    "horror": "Kinh dị",
    "isekai": "Dị giới (Isekai)",
    "mystery": "Bí ẩn",
    "psychological": "Tâm lý",
    "romance": "Lãng mạn",
    "school-life": "Học đường",
    "sci-fi": "Khoa học viễn tưởng",
    "slice-of-life": "Đời thường",
    "sports": "Thể thao",
    "supernatural": "Siêu nhiên",
    "thriller": "Giật gân",
    "tragedy": "Bi kịch",
    "historical": "Lịch sử",
    "martial-arts": "Võ thuật",
    "magic": "Phép thuật",
    "monsters": "Quái vật",
    "demons": "Ác quỷ",
    "reincarnation": "Chuyển sinh",
    "long-strip": "Webtoon cuộn dọc",
}


def _slugify(value: str, fallback: str, max_len: int = 180) -> str:
    clean = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (clean[:max_len] or fallback).strip("-")


def _reconcile_ql_doctruyen_schema(cur: pyodbc.Cursor) -> None:
    """Apply non-destructive M-001..M-011 schema reconciliation to local `QL_DocTruyen`."""
    print("[import-local] Setting SIMPLE recovery model & reconciling `QL_DocTruyen` schema...")
    cur.execute(f"ALTER DATABASE [{TARGET_DB}] SET RECOVERY SIMPLE;")

    ddl_statements = [
        # Missing tables (`reader_progress`, `manga_deletion_tombstones`, `outbox_events`, alembic metadata)
        """
        IF OBJECT_ID('dbo.reader_progress', 'U') IS NULL
        CREATE TABLE dbo.reader_progress (
            reader_account_id UNIQUEIDENTIFIER NOT NULL,
            manga_id UNIQUEIDENTIFIER NOT NULL,
            chapter_id UNIQUEIDENTIFIER NOT NULL,
            page_number INT NOT NULL CONSTRAINT DF_reader_progress_page DEFAULT 1,
            page_uid VARCHAR(255) NULL,
            pages_revision INT NOT NULL CONSTRAINT DF_reader_progress_rev DEFAULT 1,
            client_sequence INT NOT NULL CONSTRAINT DF_reader_progress_seq DEFAULT 0,
            updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_reader_progress_updated DEFAULT SYSUTCDATETIME(),
            CONSTRAINT PK_reader_progress PRIMARY KEY (reader_account_id, manga_id),
            CONSTRAINT CK_reader_progress_progress_page_pos CHECK (page_number >= 1),
            CONSTRAINT CK_reader_progress_progress_rev_pos CHECK (pages_revision >= 1),
            CONSTRAINT FK_reader_progress_readers_reader_account_id
                FOREIGN KEY (reader_account_id) REFERENCES dbo.readers(account_id) ON DELETE CASCADE,
            CONSTRAINT FK_reader_progress_mangas_manga_id
                FOREIGN KEY (manga_id) REFERENCES dbo.mangas(manga_id) ON DELETE CASCADE,
            CONSTRAINT FK_reader_progress_chapters_chapter_id
                FOREIGN KEY (chapter_id) REFERENCES dbo.chapters(chapter_id) ON DELETE NO ACTION
        );
        """,
        """
        IF OBJECT_ID('dbo.manga_deletion_tombstones', 'U') IS NULL
        CREATE TABLE dbo.manga_deletion_tombstones (
            pool_manga_id VARCHAR(80) NOT NULL,
            manga_id UNIQUEIDENTIFIER NOT NULL,
            manga_title_snapshot NVARCHAR(500) NOT NULL,
            reason NVARCHAR(500) NOT NULL,
            deleted_by_admin_account_id UNIQUEIDENTIFIER NULL,
            deleted_at DATETIME2(3) NOT NULL CONSTRAINT DF_manga_tombstones_deleted DEFAULT SYSUTCDATETIME(),
            CONSTRAINT PK_manga_deletion_tombstones PRIMARY KEY (pool_manga_id)
        );
        """,
        """
        IF OBJECT_ID('dbo.outbox_events', 'U') IS NULL
        CREATE TABLE dbo.outbox_events (
            event_id UNIQUEIDENTIFIER NOT NULL,
            idempotency_key VARCHAR(200) NOT NULL,
            event_type VARCHAR(80) NOT NULL,
            aggregate_type VARCHAR(60) NOT NULL,
            aggregate_id VARCHAR(128) NOT NULL,
            payload_json NVARCHAR(MAX) NOT NULL,
            status VARCHAR(16) NOT NULL CONSTRAINT DF_outbox_status DEFAULT 'PENDING',
            attempt_count INT NOT NULL CONSTRAINT DF_outbox_attempt DEFAULT 0,
            last_error NVARCHAR(MAX) NULL,
            created_at DATETIME2(3) NOT NULL CONSTRAINT DF_outbox_created DEFAULT SYSUTCDATETIME(),
            processed_at DATETIME2(3) NULL,
            CONSTRAINT PK_outbox_events PRIMARY KEY (event_id),
            CONSTRAINT UQ_outbox_events_idempotency_key UNIQUE (idempotency_key),
            CONSTRAINT CK_outbox_events_outbox_status_enum CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED'))
        );
        """,
        """
        IF OBJECT_ID('dbo.schema_foundation_metadata', 'U') IS NULL
        CREATE TABLE dbo.schema_foundation_metadata (
            metadata_key VARCHAR(100) NOT NULL,
            metadata_value VARCHAR(500) NOT NULL,
            recorded_at_utc DATETIME2(3) NOT NULL,
            CONSTRAINT PK_schema_foundation_metadata PRIMARY KEY (metadata_key)
        );
        """,
        """
        IF OBJECT_ID('dbo.alembic_version', 'U') IS NULL
        CREATE TABLE dbo.alembic_version (
            version_num VARCHAR(32) NOT NULL,
            CONSTRAINT PK_alembic_version PRIMARY KEY (version_num)
        );
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM dbo.alembic_version)
        INSERT INTO dbo.alembic_version (version_num) VALUES ('0002_canonical_domain_schema');
        ELSE
        UPDATE dbo.alembic_version SET version_num = '0002_canonical_domain_schema';
        """,
        # Missing columns across tables (`M-002..M-011` reconciliation)
        """
        IF COL_LENGTH('dbo.accounts', 'failed_login_attempts') IS NULL
            ALTER TABLE dbo.accounts ADD failed_login_attempts INT NOT NULL CONSTRAINT DF_accounts_failed_login DEFAULT 0;
        IF COL_LENGTH('dbo.accounts', 'locked_at') IS NULL
            ALTER TABLE dbo.accounts ADD locked_at DATETIME2(3) NULL;
        IF COL_LENGTH('dbo.accounts', 'locked_by_admin_account_id') IS NULL
            ALTER TABLE dbo.accounts ADD locked_by_admin_account_id UNIQUEIDENTIFIER NULL;
        """,
        """
        IF OBJECT_ID('dbo.CK_accounts_locked_until', 'C') IS NOT NULL
            ALTER TABLE dbo.accounts DROP CONSTRAINT CK_accounts_locked_until;
        """,
        """
        IF COL_LENGTH('dbo.cdc_events', 'pool_manga_id') IS NULL
            ALTER TABLE dbo.cdc_events ADD pool_manga_id VARCHAR(80) NOT NULL CONSTRAINT DF_cdc_pool_manga DEFAULT '';
        IF COL_LENGTH('dbo.cdc_events', 'pool_revision') IS NULL
            ALTER TABLE dbo.cdc_events ADD pool_revision INT NULL;
        """,
        """
        IF COL_LENGTH('dbo.comment_edit_histories', 'previous_is_spoiler') IS NULL
            ALTER TABLE dbo.comment_edit_histories ADD previous_is_spoiler BIT NOT NULL CONSTRAINT DF_ceh_spoiler DEFAULT 0;
        IF COL_LENGTH('dbo.comments', 'parent_comment_id') IS NULL
            ALTER TABLE dbo.comments ADD parent_comment_id UNIQUEIDENTIFIER NULL;
        IF COL_LENGTH('dbo.creators', 'biography') IS NULL
            ALTER TABLE dbo.creators ADD biography NVARCHAR(MAX) NULL;
        IF COL_LENGTH('dbo.etl_job_items', 'enable_cdc') IS NULL
            ALTER TABLE dbo.etl_job_items ADD enable_cdc BIT NOT NULL CONSTRAINT DF_etl_item_cdc DEFAULT 0;
        IF COL_LENGTH('dbo.manga_alt_titles', 'language_code') IS NULL
            ALTER TABLE dbo.manga_alt_titles ADD language_code VARCHAR(16) NULL;
        IF COL_LENGTH('dbo.manga_content_vectors', 'model_version') IS NULL
            ALTER TABLE dbo.manga_content_vectors ADD model_version VARCHAR(32) NOT NULL CONSTRAINT DF_mcv_version DEFAULT 'tfidf-v1';
        IF COL_LENGTH('dbo.mangas', 'deletion_status') IS NULL
            ALTER TABLE dbo.mangas ADD deletion_status VARCHAR(16) NOT NULL CONSTRAINT DF_mangas_deletion DEFAULT 'ACTIVE';
        """,
        """
        IF COL_LENGTH('dbo.media_objects', 'gc_status') IS NULL
            ALTER TABLE dbo.media_objects ADD gc_status VARCHAR(16) NOT NULL CONSTRAINT DF_mo_gc DEFAULT 'ACTIVE';
        IF COL_LENGTH('dbo.media_objects', 'deleted_at') IS NULL
            ALTER TABLE dbo.media_objects ADD deleted_at DATETIME2(3) NULL;
        IF COL_LENGTH('dbo.media_objects', 'last_verified_at') IS NULL
            ALTER TABLE dbo.media_objects ADD last_verified_at DATETIME2(3) NULL;
        IF COL_LENGTH('dbo.readers', 'avatar_bucket') IS NULL
            ALTER TABLE dbo.readers ADD avatar_bucket VARCHAR(63) NULL;
        IF COL_LENGTH('dbo.readers', 'avatar_object_key') IS NULL
            ALTER TABLE dbo.readers ADD avatar_object_key VARCHAR(500) NULL;
        IF COL_LENGTH('dbo.report_action_histories', 'actor_type') IS NULL
            ALTER TABLE dbo.report_action_histories ADD actor_type VARCHAR(10) NOT NULL CONSTRAINT DF_rah_actor DEFAULT 'ADMIN';
        IF COL_LENGTH('dbo.tags', 'name') IS NULL
            ALTER TABLE dbo.tags ADD name NVARCHAR(200) NOT NULL CONSTRAINT DF_tags_name DEFAULT N'';
        """,
        """
        ALTER TABLE dbo.account_reports ALTER COLUMN target_account_id UNIQUEIDENTIFIER NULL;
        ALTER TABLE dbo.report_action_histories ALTER COLUMN admin_account_id UNIQUEIDENTIFIER NULL;
        """,
        """
        IF OBJECT_ID('dbo.UQ_user_sessions_jwt', 'UQ') IS NOT NULL
            ALTER TABLE dbo.user_sessions DROP CONSTRAINT UQ_user_sessions_jwt;
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.user_sessions') AND name = 'UQ_user_sessions_jwt')
            DROP INDEX UQ_user_sessions_jwt ON dbo.user_sessions;
        ALTER TABLE dbo.user_sessions ALTER COLUMN jwt_token_hash VARCHAR(255) NULL;
        IF NOT EXISTS (
            SELECT 1 FROM sys.default_constraints
            WHERE parent_object_id = OBJECT_ID('dbo.user_sessions')
              AND COL_NAME(parent_object_id, parent_column_id) = 'is_active'
        )
            ALTER TABLE dbo.user_sessions ADD CONSTRAINT DF_user_sessions_is_active DEFAULT 1 FOR is_active;
        IF COL_LENGTH('dbo.user_sessions', 'refresh_token_hash') IS NULL
            ALTER TABLE dbo.user_sessions ADD refresh_token_hash VARCHAR(255) NULL;
        IF COL_LENGTH('dbo.user_sessions', 'user_agent') IS NULL
            ALTER TABLE dbo.user_sessions ADD user_agent NVARCHAR(500) NULL;
        IF COL_LENGTH('dbo.user_sessions', 'revoke_reason') IS NULL
            ALTER TABLE dbo.user_sessions ADD revoke_reason VARCHAR(30) NULL;
        """,
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.user_sessions') AND name = 'UX_user_sessions_refresh_token')
            CREATE UNIQUE INDEX UX_user_sessions_refresh_token ON dbo.user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
        """,
        # Align CHECK constraints that drifted from ORM enum expansions
        """
        IF OBJECT_ID('dbo.CK_report_action_histories_action_type', 'C') IS NOT NULL
            ALTER TABLE dbo.report_action_histories DROP CONSTRAINT CK_report_action_histories_action_type;
        IF OBJECT_ID('dbo.CK_reports_action_taken', 'C') IS NOT NULL
            ALTER TABLE dbo.reports DROP CONSTRAINT CK_reports_action_taken;
        IF OBJECT_ID('dbo.CK_etl_jobs_job_type', 'C') IS NOT NULL
            ALTER TABLE dbo.etl_jobs DROP CONSTRAINT CK_etl_jobs_job_type;
        IF OBJECT_ID('dbo.CK_etl_jobs_status', 'C') IS NOT NULL
            ALTER TABLE dbo.etl_jobs DROP CONSTRAINT CK_etl_jobs_status;
        IF OBJECT_ID('dbo.CK_cdc_events_event_type', 'C') IS NOT NULL
            ALTER TABLE dbo.cdc_events DROP CONSTRAINT CK_cdc_events_event_type;
        IF OBJECT_ID('dbo.CK_manga_sync_subscriptions_status', 'C') IS NOT NULL
            ALTER TABLE dbo.manga_sync_subscriptions DROP CONSTRAINT CK_manga_sync_subscriptions_status;
        """,
        # Query-scale indexes for 86,867 manga & 1.76M chapters
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.mangas') AND name = 'IX_mangas_title')
            CREATE INDEX IX_mangas_title ON dbo.mangas(title);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.mangas') AND name = 'IX_mangas_visibility_updated')
            CREATE INDEX IX_mangas_visibility_updated ON dbo.mangas(visibility_status, deletion_status, latest_chapter_at DESC, total_views DESC);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.manga_alt_titles') AND name = 'IX_manga_alt_titles_manga')
            CREATE INDEX IX_manga_alt_titles_manga ON dbo.manga_alt_titles(manga_id);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.creators') AND name = 'IX_creators_name')
            CREATE INDEX IX_creators_name ON dbo.creators(name);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.chapters') AND name = 'IX_chapters_canonical_order')
            CREATE INDEX IX_chapters_canonical_order ON dbo.chapters(manga_id, chapter_numeric, language, pool_chapter_id);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.manga_tags') AND name = 'IX_manga_tags_tag')
            CREATE INDEX IX_manga_tags_tag ON dbo.manga_tags(tag_id, manga_id);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.manga_creators') AND name = 'IX_manga_creators_creator')
            CREATE INDEX IX_manga_creators_creator ON dbo.manga_creators(creator_id, role, manga_id);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.mangas') AND name = 'IX_mangas_sort_updated')
            CREATE INDEX IX_mangas_sort_updated ON dbo.mangas(visibility_status, deletion_status, latest_chapter_at DESC, updated_at DESC, manga_id ASC);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.mangas') AND name = 'IX_mangas_sort_views')
            CREATE INDEX IX_mangas_sort_views ON dbo.mangas(visibility_status, deletion_status, total_views DESC, manga_id ASC);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.mangas') AND name = 'IX_mangas_sort_rating')
            CREATE INDEX IX_mangas_sort_rating ON dbo.mangas(visibility_status, deletion_status, average_rating DESC, total_views DESC, manga_id ASC);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.mangas') AND name = 'IX_mangas_sort_created')
            CREATE INDEX IX_mangas_sort_created ON dbo.mangas(visibility_status, deletion_status, created_at DESC, manga_id ASC);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.mangas') AND name = 'IX_mangas_sort_title')
            CREATE INDEX IX_mangas_sort_title ON dbo.mangas(visibility_status, deletion_status, title ASC, manga_id ASC);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.manga_stats_languages') AND name = 'IX_manga_stats_languages_lang')
            CREATE INDEX IX_manga_stats_languages_lang ON dbo.manga_stats_languages(language_code, manga_id);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.chapters') AND name = 'IX_chapters_manga_volume')
            CREATE INDEX IX_chapters_manga_volume ON dbo.chapters(manga_id, volume, chapter_numeric);
        """,
    ]
    for stmt in ddl_statements:
        cur.execute(stmt)


def _sync_tags_and_mangas_staging(cur: pyodbc.Cursor) -> tuple[int, int]:
    """Generate clean collision-free slugs for all tags & mangas and push via temp tables."""
    # 1. Tags (76 rows)
    src_tags = cur.execute(
        f"SELECT LOWER(CAST(TagId AS VARCHAR(36))), LOWER(ISNULL(GroupName, 'genre')), ISNULL(NameEn, 'Tag') "  # noqa: S608
        f"FROM [{SOURCE_DB}].dbo.Tag"
    ).fetchall()
    existing_tag_slugs = {row[0] for row in cur.execute("SELECT slug FROM dbo.tags").fetchall()}
    tag_rows: list[tuple[str, str, str, str, str]] = []
    for raw_id, grp, name_en in src_tags:
        tslug = _slugify(name_en, raw_id[:12], max_len=120)
        tgroup = grp if grp in ("genre", "theme", "format", "content") else "other"
        if tslug not in existing_tag_slugs:
            tag_rows.append((tslug, raw_id, raw_id, tgroup, name_en[:200]))
            existing_tag_slugs.add(tslug)
    if tag_rows:
        cur.executemany(
            "INSERT INTO dbo.tags (slug, source_tag_id, mangadex_id, tag_group, name) VALUES (?, ?, ?, ?, ?)",
            tag_rows,
        )

    cur.execute(
        """
        UPDATE t
        SET t.name = COALESCE(NULLIF(t.name, N''), src.NameEn)
        FROM dbo.tags t
        JOIN MangaLibrary.dbo.Tag src ON LOWER(CAST(src.TagId AS VARCHAR(36))) = t.source_tag_id
        WHERE t.name IS NULL OR t.name = N'';
        """
    )
    # Tag localized names (en + vi)
    cur.execute(
        """
        INSERT INTO dbo.tag_names (tag_id, language_code, tag_name)
        SELECT t.tag_id, 'en', LEFT(t.name, 200)
        FROM dbo.tags t
        WHERE t.name <> N''
          AND NOT EXISTS (SELECT 1 FROM dbo.tag_names tn WHERE tn.tag_id = t.tag_id AND tn.language_code = 'en');
        """
    )
    for tslug, vi_name in VI_TAG_NAMES.items():
        cur.execute(
            """
            INSERT INTO dbo.tag_names (tag_id, language_code, tag_name)
            SELECT t.tag_id, 'vi', ?
            FROM dbo.tags t
            WHERE t.slug = ?
              AND NOT EXISTS (SELECT 1 FROM dbo.tag_names tn WHERE tn.tag_id = t.tag_id AND tn.language_code = 'vi');
            """,
            vi_name,
            tslug,
        )

    # 2. All 86,866 mangas -> build clean ASCII collision-free slugs in Python -> stage into #stage_manga
    print(f"[import-local] Generating canonical slugs for all titles in `{SOURCE_DB}.dbo.Manga`...")
    raw_mangas = cur.execute(
        f"""
        SELECT
            LOWER(CAST(m.MangaId AS VARCHAR(36))) AS manga_id,
            COALESCE(
                NULLIF(LTRIM(RTRIM(m.TitleEn)), N''),
                alt_fb.alt_title,
                N'Untitled Manga ' + LEFT(CAST(m.MangaId AS NVARCHAR(36)), 8)
            ) AS title_resolved
        FROM [{SOURCE_DB}].dbo.Manga m
        OUTER APPLY (
            SELECT TOP 1 NULLIF(LTRIM(RTRIM(CAST(a.AltTitle AS NVARCHAR(500)))), N'') AS alt_title
            FROM [{SOURCE_DB}].dbo.MangaAltTitle a
            WHERE a.MangaId = m.MangaId AND a.AltTitle IS NOT NULL AND LEN(LTRIM(RTRIM(CAST(a.AltTitle AS NVARCHAR(500))))) > 0
            ORDER BY a.AltTitleId ASC
        ) alt_fb
        ORDER BY m.CreatedAt ASC, m.MangaId ASC
        """  # noqa: S608
    ).fetchall()

    used_slugs: set[str] = {r[0] for r in cur.execute("SELECT slug FROM dbo.mangas").fetchall()}
    staged_rows: list[tuple[str, str, str]] = []
    for mid, raw_title in raw_mangas:
        clean_title = str(raw_title or f"Manga {mid[:8]}").strip()[:480]
        while len(clean_title.encode("utf-16-le")) > 960:
            clean_title = clean_title[:-8]
        base_slug = _slugify(clean_title, f"manga-{mid[:8]}", max_len=200)
        slug = base_slug
        if slug in used_slugs:
            slug = f"{base_slug[:185]}-{mid[:8]}"
            if slug in used_slugs:
                slug = f"m-{mid}"
        used_slugs.add(slug)
        staged_rows.append((mid, slug[:255], clean_title))

    cur.execute(
        """
        IF OBJECT_ID('tempdb..#stage_manga') IS NOT NULL DROP TABLE #stage_manga;
        CREATE TABLE #stage_manga (
            manga_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
            slug VARCHAR(255) NOT NULL,
            title NVARCHAR(500) NOT NULL
        );
        """
    )
    cur.fast_executemany = True
    cur.setinputsizes(
        [
            (pyodbc.SQL_VARCHAR, 36, 0),
            (pyodbc.SQL_VARCHAR, 255, 0),
            (pyodbc.SQL_WVARCHAR, 500, 0),
        ]
    )
    cur.executemany(
        "INSERT INTO #stage_manga (manga_id, slug, title) VALUES (?, ?, ?)", staged_rows
    )
    cur.fast_executemany = False
    cur.setinputsizes([])
    return len(src_tags), len(staged_rows)


def _bulk_sync_catalog_and_community(cur: pyodbc.Cursor) -> dict[str, int]:
    """Execute set-based T-SQL sync from `MangaLibrary` -> `QL_DocTruyen`."""
    t0 = time.perf_counter()

    # 1. Creators (49,937) + Biographies
    print("[import-local] Syncing creators & biographies (set-based T-SQL)...")
    cur.execute(
        f"""
        INSERT INTO dbo.creators (creator_id, slug, name, mangadex_id, biography)
        SELECT
            LOWER(CAST(c.CreatorId AS VARCHAR(36))),
            'cr-' + LOWER(CAST(c.CreatorId AS VARCHAR(36))),
            LEFT(COALESCE(NULLIF(LTRIM(RTRIM(c.Name)), N''), N'Unknown Creator'), 200),
            LOWER(CAST(c.CreatorId AS VARCHAR(36))),
            COALESCE(
                NULLIF(LTRIM(RTRIM(c.BiographyEn)), N''),
                NULLIF(LTRIM(RTRIM(c.BiographyJa)), N''),
                NULLIF(LTRIM(RTRIM(c.BiographyPtBr)), N'')
            )
        FROM [{SOURCE_DB}].dbo.Creator c
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.creators dst WHERE dst.creator_id = LOWER(CAST(c.CreatorId AS VARCHAR(36)))
        );
        """  # noqa: S608
    )
    for lang_col, lang_code in (
        ("BiographyEn", "en"),
        ("BiographyJa", "ja"),
        ("BiographyPtBr", "pt-br"),
    ):
        cur.execute(
            f"""
            INSERT INTO dbo.creator_biographies (creator_id, language_code, biography)
            SELECT
                LOWER(CAST(c.CreatorId AS VARCHAR(36))),
                '{lang_code}',
                LTRIM(RTRIM(c.{lang_col}))
            FROM [{SOURCE_DB}].dbo.Creator c
            WHERE c.{lang_col} IS NOT NULL AND LEN(LTRIM(RTRIM(c.{lang_col}))) > 0
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.creator_biographies cb
                  WHERE cb.creator_id = LOWER(CAST(c.CreatorId AS VARCHAR(36))) AND cb.language_code = '{lang_code}'
              );
            """  # noqa: S608
        )

    # 2. Zero-copy MinIO media_objects (covers + avatars; bucket='manga-media', NO file copying)
    print("[import-local] Registering canonical MinIO `manga-media` addresses (zero disk copy)...")
    cur.execute(
        f"""
        ;WITH cover_sources AS (
            SELECT
                LEFT(
                    CASE
                        WHEN c.url LIKE 'covers/%' THEN REPLACE(LTRIM(RTRIM(c.url)), '\\', '/')
                        WHEN c.fileName IS NOT NULL AND LTRIM(RTRIM(c.fileName)) <> N''
                            THEN 'covers/' + LOWER(CAST(c.manga_id AS VARCHAR(36))) + '/' + LTRIM(RTRIM(c.fileName))
                        ELSE NULL
                    END,
                    500
                ) AS object_key,
                CASE
                    WHEN LOWER(ISNULL(c.fileName, c.url)) LIKE '%.png' THEN 'image/png'
                    WHEN LOWER(ISNULL(c.fileName, c.url)) LIKE '%.webp' THEN 'image/webp'
                    ELSE 'image/jpeg'
                END AS content_type
            FROM [{SOURCE_DB}].dbo.Covers c
            UNION ALL
            SELECT
                LEFT(
                    CASE
                        WHEN mc.file_path LIKE 'covers%' THEN REPLACE(LTRIM(RTRIM(mc.file_path)), '\\', '/')
                        WHEN mc.file_name IS NOT NULL AND LTRIM(RTRIM(mc.file_name)) <> N''
                            THEN 'covers/' + LOWER(CAST(mc.manga_id AS VARCHAR(36))) + '/' + LTRIM(RTRIM(mc.file_name))
                        ELSE NULL
                    END,
                    500
                ) AS object_key,
                CASE
                    WHEN LOWER(ISNULL(mc.file_name, mc.file_path)) LIKE '%.png' THEN 'image/png'
                    WHEN LOWER(ISNULL(mc.file_name, mc.file_path)) LIKE '%.webp' THEN 'image/webp'
                    ELSE 'image/jpeg'
                END AS content_type
            FROM [{SOURCE_DB}].dbo.MangaCovers mc
            UNION ALL
            SELECT
                LEFT(REPLACE(LTRIM(RTRIM(u.AvatarObjectKey)), '\\', '/'), 500) AS object_key,
                CASE
                    WHEN LOWER(u.AvatarObjectKey) LIKE '%.png' THEN 'image/png'
                    WHEN LOWER(u.AvatarObjectKey) LIKE '%.webp' THEN 'image/webp'
                    ELSE 'image/jpeg'
                END AS content_type
            FROM [{SOURCE_DB}].dbo.[User] u
            WHERE u.AvatarObjectKey IS NOT NULL AND LTRIM(RTRIM(u.AvatarObjectKey)) <> N''
        ),
        deduped AS (
            SELECT object_key, MAX(content_type) AS content_type
            FROM cover_sources
            WHERE object_key IS NOT NULL AND object_key <> N''
            GROUP BY object_key
        )
        INSERT INTO dbo.media_objects (bucket, object_key, content_type, file_size, gc_status, created_at)
        SELECT '{MINIO_DEFAULT_BUCKET}', d.object_key, d.content_type, 0, 'ACTIVE', SYSUTCDATETIME()
        FROM deduped d
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.media_objects mo
            WHERE mo.bucket = '{MINIO_DEFAULT_BUCKET}' AND mo.object_key = d.object_key
        );
        """  # noqa: S608
    )

    # 3. All 86,866 Mangas (boost `latest_chapter_at` priority for titles with verified MinIO covers)
    print("[import-local] Inserting all 86,866 manga records & metadata...")
    cur.execute(
        f"""
        INSERT INTO dbo.mangas (
            manga_id, pool_manga_id, slug, source_manga_id, mangadex_id, title, description,
            publication_status, content_rating, publication_demographic, original_language, year,
            official_volumes, official_chapters, primary_cover_media_id, visibility_status,
            deletion_status, is_cdc_enabled, is_syncing, ignore_all_reports,
            total_views, average_rating, latest_chapter_at, created_at, updated_at
        )
        SELECT
            m.MangaId,
            'mangadex:' + LOWER(CAST(m.MangaId AS VARCHAR(36))),
            sm.slug,
            LOWER(CAST(m.MangaId AS VARCHAR(36))),
            LOWER(CAST(m.MangaId AS VARCHAR(36))),
            sm.title,
            COALESCE(desc_pick.description, N''),
            CASE
                WHEN LOWER(ISNULL(m.Status, '')) IN ('ongoing', 'completed', 'hiatus', 'cancelled')
                    THEN LOWER(m.Status)
                ELSE 'unknown'
            END,
            CASE
                WHEN LOWER(ISNULL(m.ContentRating, '')) IN ('safe', 'suggestive', 'erotica', 'pornographic')
                    THEN LOWER(m.ContentRating)
                ELSE 'unknown'
            END,
            CASE
                WHEN LOWER(ISNULL(m.PublicationDemographic, '')) IN ('shounen', 'shoujo', 'seinen', 'josei', 'kodomo')
                    THEN LOWER(m.PublicationDemographic)
                ELSE 'unknown'
            END,
            LEFT(LOWER(COALESCE(NULLIF(LTRIM(RTRIM(m.OriginalLanguage)), ''), 'ja')), 16),
            CASE WHEN m.Year BETWEEN 1800 AND 2200 THEN m.Year ELSE NULL END,
            CASE WHEN TRY_CAST(TRY_CAST(m.LastVolume AS FLOAT) AS INT) >= 0 THEN TRY_CAST(TRY_CAST(m.LastVolume AS FLOAT) AS INT) ELSE NULL END,
            CASE WHEN TRY_CAST(TRY_CAST(m.LastChapter AS FLOAT) AS INT) >= 0 THEN TRY_CAST(TRY_CAST(m.LastChapter AS FLOAT) AS INT) ELSE NULL END,
            cover_pick.media_id,
            'PUBLIC',
            'ACTIVE',
            0, 0, 0,
            CASE WHEN ISNULL(ms.Follows, 0) > 0 THEN ms.Follows / 25 ELSE 0 END,
            CASE WHEN ISNULL(ms.AverageRating, 0) > 0 THEN CAST(ROUND(ms.AverageRating, 3) AS DECIMAL(6, 3)) ELSE CAST(0.000 AS DECIMAL(6, 3)) END,
            CASE
                WHEN cover_pick.has_local_minio = 1
                    THEN COALESCE(m.UpdatedAt, SYSUTCDATETIME())
                ELSE DATEADD(YEAR, -5, COALESCE(m.UpdatedAt, m.CreatedAt, SYSUTCDATETIME()))
            END,
            COALESCE(m.CreatedAt, SYSUTCDATETIME()),
            COALESCE(m.UpdatedAt, m.CreatedAt, SYSUTCDATETIME())
        FROM [{SOURCE_DB}].dbo.Manga m
        JOIN #stage_manga sm ON sm.manga_id = m.MangaId
        OUTER APPLY (
            SELECT TOP 1 LTRIM(RTRIM(d.Description)) AS description
            FROM [{SOURCE_DB}].dbo.MangaDescription d
            WHERE d.MangaId = m.MangaId AND d.Description IS NOT NULL AND LEN(LTRIM(RTRIM(d.Description))) > 0
            ORDER BY CASE WHEN LOWER(d.LangCode) = 'vi' THEN 0 WHEN LOWER(d.LangCode) = 'en' THEN 1 ELSE 2 END, d.DescriptionId ASC
        ) desc_pick
        OUTER APPLY (
            SELECT TOP 1
                mo.media_id,
                CASE WHEN cv.has_url = 1 THEN 1 ELSE 0 END AS has_local_minio
            FROM (
                SELECT
                    LEFT(
                        CASE
                            WHEN c.url LIKE 'covers/%' THEN REPLACE(LTRIM(RTRIM(c.url)), '\\', '/')
                            ELSE 'covers/' + LOWER(CAST(c.manga_id AS VARCHAR(36))) + '/' + LTRIM(RTRIM(c.fileName))
                        END, 500
                    ) AS object_key,
                    CASE WHEN c.url LIKE 'covers/%' THEN 1 ELSE 0 END AS has_url,
                    c.updatedAt AS sort_dt
                FROM [{SOURCE_DB}].dbo.Covers c
                WHERE c.manga_id = m.MangaId AND (c.url LIKE 'covers/%' OR (c.fileName IS NOT NULL AND LTRIM(RTRIM(c.fileName)) <> N''))
                UNION ALL
                SELECT
                    LEFT(
                        CASE
                            WHEN mc.file_path LIKE 'covers%' THEN REPLACE(LTRIM(RTRIM(mc.file_path)), '\\', '/')
                            ELSE 'covers/' + LOWER(CAST(mc.manga_id AS VARCHAR(36))) + '/' + LTRIM(RTRIM(mc.file_name))
                        END, 500
                    ) AS object_key,
                    CASE WHEN mc.file_path IS NOT NULL THEN 1 ELSE 0 END AS has_url,
                    mc.updated_at AS sort_dt
                FROM [{SOURCE_DB}].dbo.MangaCovers mc
                WHERE mc.manga_id = m.MangaId AND (mc.file_path LIKE 'covers%' OR (mc.file_name IS NOT NULL AND LTRIM(RTRIM(mc.file_name)) <> N''))
            ) cv
            JOIN dbo.media_objects mo ON mo.bucket = '{MINIO_DEFAULT_BUCKET}' AND mo.object_key = cv.object_key
            ORDER BY cv.has_url DESC, cv.sort_dt DESC
        ) cover_pick
        OUTER APPLY (
            SELECT TOP 1 s.Follows, s.AverageRating
            FROM [{SOURCE_DB}].dbo.MangaStatistics s
            WHERE s.MangaId = m.MangaId
            ORDER BY s.FetchedAt DESC
        ) ms
        WHERE NOT EXISTS (SELECT 1 FROM dbo.mangas dst WHERE dst.manga_id = m.MangaId);
        """  # noqa: S608
    )

    # 4. Cover arts, alt titles, external links, tags, creators
    print("[import-local] Syncing cover arts, alt titles, external links, tags & creators...")
    cur.execute(
        f"""
        INSERT INTO dbo.manga_cover_arts (manga_id, cover_id, volume, locale, description, media_id)
        SELECT
            c.manga_id,
            LOWER(CAST(c.cover_id AS VARCHAR(36))),
            LEFT(NULLIF(LTRIM(RTRIM(c.volume)), N''), 40),
            LEFT(NULLIF(LOWER(LTRIM(RTRIM(c.locale))), ''), 16),
            LEFT(NULLIF(LTRIM(RTRIM(c.description)), N''), 500),
            mo.media_id
        FROM [{SOURCE_DB}].dbo.Covers c
        JOIN dbo.mangas m ON m.manga_id = c.manga_id
        JOIN dbo.media_objects mo
          ON mo.bucket = '{MINIO_DEFAULT_BUCKET}'
         AND mo.object_key = LEFT(
             CASE
                 WHEN c.url LIKE 'covers/%' THEN REPLACE(LTRIM(RTRIM(c.url)), '\\', '/')
                 ELSE 'covers/' + LOWER(CAST(c.manga_id AS VARCHAR(36))) + '/' + LTRIM(RTRIM(c.fileName))
             END, 500
         )
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.manga_cover_arts mca
            WHERE mca.manga_id = c.manga_id AND mca.cover_id = LOWER(CAST(c.cover_id AS VARCHAR(36)))
        );

        INSERT INTO dbo.manga_cover_arts (manga_id, cover_id, volume, locale, description, media_id)
        SELECT
            mc.manga_id,
            LOWER(CAST(mc.cover_id AS VARCHAR(36))),
            LEFT(NULLIF(LTRIM(RTRIM(mc.volume)), N''), 40),
            LEFT(NULLIF(LOWER(LTRIM(RTRIM(mc.locale))), ''), 16),
            LEFT(NULLIF(LTRIM(RTRIM(mc.description)), N''), 500),
            mo.media_id
        FROM [{SOURCE_DB}].dbo.MangaCovers mc
        JOIN dbo.mangas m ON m.manga_id = mc.manga_id
        JOIN dbo.media_objects mo
          ON mo.bucket = '{MINIO_DEFAULT_BUCKET}'
         AND mo.object_key = LEFT(
             CASE
                 WHEN mc.file_path LIKE 'covers%' THEN REPLACE(LTRIM(RTRIM(mc.file_path)), '\\', '/')
                 ELSE 'covers/' + LOWER(CAST(mc.manga_id AS VARCHAR(36))) + '/' + LTRIM(RTRIM(mc.file_name))
             END, 500
         )
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.manga_cover_arts mca
            WHERE mca.manga_id = mc.manga_id AND mca.cover_id = LOWER(CAST(mc.cover_id AS VARCHAR(36)))
        );
        """  # noqa: S608
    )

    cur.execute(
        f"""
        ;WITH alts AS (
            SELECT
                a.MangaId,
                LEFT(NULLIF(LOWER(LTRIM(RTRIM(CAST(a.LangCode AS VARCHAR(32))))), ''), 16) AS lang_code,
                LEFT(LTRIM(RTRIM(CAST(a.AltTitle AS NVARCHAR(500)))), 500) AS alt_title,
                ROW_NUMBER() OVER (PARTITION BY a.MangaId ORDER BY a.AltTitleId ASC) - 1 AS disp_ord
            FROM [{SOURCE_DB}].dbo.MangaAltTitle a
            JOIN dbo.mangas m ON m.manga_id = a.MangaId
            WHERE a.AltTitle IS NOT NULL AND LEN(LTRIM(RTRIM(CAST(a.AltTitle AS NVARCHAR(500))))) > 0
        )
        INSERT INTO dbo.manga_alt_titles (manga_id, language_code, alternative_title, display_order)
        SELECT a.MangaId, a.lang_code, a.alt_title, CAST(a.disp_ord AS SMALLINT)
        FROM alts a
        WHERE a.disp_ord < 30000
          AND NOT EXISTS (
              SELECT 1 FROM dbo.manga_alt_titles dst
              WHERE dst.manga_id = a.MangaId AND dst.display_order = a.disp_ord
          );

        ;WITH alts_upd AS (
            SELECT
                a.MangaId,
                LEFT(NULLIF(LOWER(LTRIM(RTRIM(CAST(a.LangCode AS VARCHAR(32))))), ''), 16) AS lang_code,
                ROW_NUMBER() OVER (PARTITION BY a.MangaId ORDER BY a.AltTitleId ASC) - 1 AS disp_ord
            FROM [{SOURCE_DB}].dbo.MangaAltTitle a
            WHERE a.AltTitle IS NOT NULL AND LEN(LTRIM(RTRIM(CAST(a.AltTitle AS NVARCHAR(500))))) > 0
        )
        UPDATE dst
        SET dst.language_code = au.lang_code
        FROM dbo.manga_alt_titles dst
        JOIN alts_upd au
          ON au.MangaId = dst.manga_id AND au.disp_ord = dst.display_order
        WHERE dst.language_code IS NULL AND au.lang_code IS NOT NULL;
        """  # noqa: S608
    )

    cur.execute(
        f"""
        INSERT INTO dbo.manga_links (manga_id, site, url)
        SELECT
            ml.MangaId,
            LEFT(COALESCE(NULLIF(LTRIM(RTRIM(ml.Provider)), N''), N'link'), 100),
            LEFT(LTRIM(RTRIM(CAST(ml.Url AS NVARCHAR(1000)))), 1000)
        FROM [{SOURCE_DB}].dbo.MangaLink ml
        JOIN dbo.mangas m ON m.manga_id = ml.MangaId
        WHERE ml.Url IS NOT NULL AND LTRIM(RTRIM(CAST(ml.Url AS NVARCHAR(1000)))) LIKE 'http%'
          AND NOT EXISTS (SELECT 1 FROM dbo.manga_links dst WHERE dst.manga_id = ml.MangaId);
        """  # noqa: S608
    )

    cur.execute(
        f"""
        INSERT INTO dbo.manga_tags (manga_id, tag_id)
        SELECT DISTINCT mt.MangaId, t.tag_id
        FROM [{SOURCE_DB}].dbo.MangaTag mt
        JOIN dbo.mangas m ON m.manga_id = mt.MangaId
        JOIN dbo.tags t ON t.source_tag_id = LOWER(CAST(mt.TagId AS VARCHAR(36)))
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.manga_tags dst WHERE dst.manga_id = mt.MangaId AND dst.tag_id = t.tag_id
        );
        """  # noqa: S608
    )

    cur.execute(
        f"""
        ;WITH mc_dedup AS (
            SELECT DISTINCT
                cr.RelatedId AS manga_id,
                LOWER(CAST(cr.CreatorId AS VARCHAR(36))) AS creator_id,
                CASE WHEN LOWER(ISNULL(c.Type, 'author')) = 'artist' THEN 'artist' ELSE 'author' END AS role
            FROM [{SOURCE_DB}].dbo.CreatorRelationship cr
            JOIN [{SOURCE_DB}].dbo.Creator c ON c.CreatorId = cr.CreatorId
            JOIN dbo.mangas m ON m.manga_id = cr.RelatedId
            WHERE LOWER(ISNULL(cr.RelatedType, 'manga')) = 'manga'
            UNION
            SELECT DISTINCT
                mr.MangaId AS manga_id,
                LOWER(CAST(mr.RelatedId AS VARCHAR(36))) AS creator_id,
                LOWER(mr.Type) AS role
            FROM [{SOURCE_DB}].dbo.MangaRelated mr
            JOIN dbo.mangas m ON m.manga_id = mr.MangaId
            JOIN dbo.creators c ON c.creator_id = LOWER(CAST(mr.RelatedId AS VARCHAR(36)))
            WHERE LOWER(mr.Type) IN ('author', 'artist')
        )
        INSERT INTO dbo.manga_creators (manga_id, creator_id, role)
        SELECT d.manga_id, d.creator_id, d.role
        FROM mc_dedup d
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.manga_creators dst
            WHERE dst.manga_id = d.manga_id AND dst.creator_id = d.creator_id AND dst.role = d.role
        );

        ;WITH mc_generic AS (
            SELECT DISTINCT
                mr.MangaId AS manga_id,
                LOWER(CAST(mr.RelatedId AS VARCHAR(36))) AS creator_id,
                'author' AS role
            FROM [{SOURCE_DB}].dbo.MangaRelated mr
            JOIN dbo.mangas m ON m.manga_id = mr.MangaId
            JOIN dbo.creators c ON c.creator_id = LOWER(CAST(mr.RelatedId AS VARCHAR(36)))
            WHERE LOWER(mr.Type) = 'creator'
        )
        INSERT INTO dbo.manga_creators (manga_id, creator_id, role)
        SELECT g.manga_id, g.creator_id, g.role
        FROM mc_generic g
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.manga_creators dst
            WHERE dst.manga_id = g.manga_id AND dst.creator_id = g.creator_id
        );
        """  # noqa: S608
    )

    # 5. All 1,762,155 readable chapters in keyset chunks (keeps log compact & fast)
    existing_ch_count = int(cur.execute("SELECT COUNT(*) FROM dbo.chapters").fetchone()[0] or 0)
    if existing_ch_count < 1_700_000:
        print(f"[import-local] Syncing all readable chapters from `{SOURCE_DB}.dbo.Chapter`...")
        cur.execute(
            f"""
            IF OBJECT_ID('tempdb..#src_ch') IS NOT NULL DROP TABLE #src_ch;
            SELECT
                ROW_NUMBER() OVER (ORDER BY ch.ChapterId) AS seq_id,
                ch.ChapterId
            INTO #src_ch
            FROM [{SOURCE_DB}].dbo.Chapter ch
            WHERE ISNULL(ch.IsUnavailable, 0) = 0
              AND ISNULL(ch.Pages, 0) > 0
              AND EXISTS (SELECT 1 FROM dbo.mangas m WHERE m.manga_id = ch.MangaId);
            CREATE CLUSTERED INDEX IX_tmp_src_ch ON #src_ch(seq_id);
            """  # noqa: S608
        )
        total_eligible = int(cur.execute("SELECT COUNT(*) FROM #src_ch").fetchone()[0] or 0)
        batch_size = 200_000
        start_seq = 1
        while start_seq <= total_eligible:
            end_seq = min(start_seq + batch_size - 1, total_eligible)
            cur.execute(
                f"""
                INSERT INTO dbo.chapters (
                    chapter_id, manga_id, pool_chapter_id, source_chapter_id,
                    chapter_number, chapter_numeric, volume, title, language,
                    scanlation_group, publish_at, source, page_count,
                    total_size_bytes, pages_revision, manifest_sha256, view_count,
                    updated_at, created_at
                )
                SELECT
                    ch.ChapterId,
                    ch.MangaId,
                    'mangadex:' + LOWER(CAST(ch.ChapterId AS VARCHAR(36))),
                    LOWER(CAST(ch.ChapterId AS VARCHAR(36))),
                    LEFT(COALESCE(NULLIF(LTRIM(RTRIM(ch.ChapterNumber)), N''), N'0'), 50),
                    CASE
                        WHEN TRY_CAST(NULLIF(LTRIM(RTRIM(ch.ChapterNumber)), N'') AS DECIMAL(18, 6))
                             BETWEEN -999999999 AND 999999999
                        THEN TRY_CAST(NULLIF(LTRIM(RTRIM(ch.ChapterNumber)), N'') AS DECIMAL(18, 6))
                        ELSE CAST(0 AS DECIMAL(18, 6))
                    END,
                    LEFT(NULLIF(LTRIM(RTRIM(ch.Volume)), N''), 40),
                    LEFT(ISNULL(CAST(ch.Title AS NVARCHAR(500)), N''), 500),
                    LEFT(LOWER(COALESCE(NULLIF(LTRIM(RTRIM(ch.TranslatedLang)), ''), 'en')), 16),
                    N'MangaLibrary Archive',
                    ch.PublishAt,
                    'mangadex-local',
                    ch.Pages,
                    CAST(ch.Pages AS BIGINT) * 45000,
                    1,
                    '',
                    0,
                    COALESCE(ch.UpdatedAt, ch.PublishAt, SYSUTCDATETIME()),
                    COALESCE(ch.CreatedAt, SYSUTCDATETIME())
                FROM #src_ch sc
                JOIN [{SOURCE_DB}].dbo.Chapter ch ON ch.ChapterId = sc.ChapterId
                WHERE sc.seq_id BETWEEN ? AND ?
                  AND NOT EXISTS (SELECT 1 FROM dbo.chapters dst WHERE dst.chapter_id = ch.ChapterId);
                """,  # noqa: S608
                start_seq,
                end_seq,
            )
            print(
                f"[import-local]   Chapters batch {start_seq:,}..{end_seq:,} / {total_eligible:,}"
            )
            start_seq += batch_size

    # 6. Manga stats, languages, lineage
    print("[import-local] Computing `manga_stats`, `manga_stats_languages`, & `manga_lineage`...")
    cur.execute(
        """
        ;WITH ch_agg AS (
            SELECT
                manga_id,
                COUNT(*) AS chapter_cnt,
                SUM(CAST(page_count AS BIGINT)) AS page_cnt,
                SUM(total_size_bytes) AS size_bytes
            FROM dbo.chapters
            GROUP BY manga_id
        )
        INSERT INTO dbo.manga_stats (manga_id, chapter_count, page_count, total_size_bytes, updated_at)
        SELECT
            m.manga_id,
            ISNULL(ca.chapter_cnt, 0),
            CASE WHEN ISNULL(ca.page_cnt, 0) > 2000000000 THEN 2000000000 ELSE CAST(ISNULL(ca.page_cnt, 0) AS INT) END,
            ISNULL(ca.size_bytes, 0),
            SYSUTCDATETIME()
        FROM dbo.mangas m
        LEFT JOIN ch_agg ca ON ca.manga_id = m.manga_id
        WHERE NOT EXISTS (SELECT 1 FROM dbo.manga_stats dst WHERE dst.manga_id = m.manga_id);
        """
    )

    cur.execute(
        f"""
        ;WITH all_langs AS (
            SELECT manga_id, language AS lang_code FROM dbo.chapters
            UNION
            SELECT al.MangaId, LEFT(LOWER(LTRIM(RTRIM(al.LangCode))), 16)
            FROM [{SOURCE_DB}].dbo.MangaAvailableLanguage al
            JOIN dbo.mangas m ON m.manga_id = al.MangaId
            WHERE al.LangCode IS NOT NULL AND LTRIM(RTRIM(al.LangCode)) <> ''
        )
        INSERT INTO dbo.manga_stats_languages (manga_id, language_code)
        SELECT DISTINCT l.manga_id, l.lang_code
        FROM all_langs l
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.manga_stats_languages dst
            WHERE dst.manga_id = l.manga_id AND dst.language_code = l.lang_code
        );
        """  # noqa: S608
    )

    cur.execute(
        """
        INSERT INTO dbo.manga_lineage (
            manga_id, pool_revision, source_metadata_revision, manifest_sha256, published_at, updated_at
        )
        SELECT
            m.manga_id, 1, 1, '', m.created_at, m.updated_at
        FROM dbo.mangas m
        WHERE NOT EXISTS (SELECT 1 FROM dbo.manga_lineage dst WHERE dst.manga_id = m.manga_id);
        """
    )

    # 7. Import all 614 real `User` accounts from MangaLibrary (deduping username collisions)
    print(
        "[import-local] Syncing all community accounts, statuses, histories, ratings, comments, lists & reports..."
    )
    cur.execute(
        f"""
        ;WITH src_users AS (
            SELECT
                u.UserId,
                CASE
                    WHEN LOWER(LTRIM(RTRIM(u.Username))) IN ('admin', 'reader1', 'reader2')
                      OR ROW_NUMBER() OVER (
                          PARTITION BY LOWER(LEFT(LTRIM(RTRIM(u.Username)), 40))
                          ORDER BY u.CreatedAt ASC, u.UserId ASC
                      ) > 1
                    THEN LEFT(LTRIM(RTRIM(u.Username)), 40) + '_' + LEFT(LOWER(CAST(u.UserId AS VARCHAR(36))), 6)
                    ELSE LEFT(LTRIM(RTRIM(u.Username)), 50)
                END AS clean_username,
                LEFT(LTRIM(RTRIM(u.Email)), 254) AS clean_email,
                LEFT(COALESCE(NULLIF(u.PasswordHash, ''), '$argon2id$stub'), 255) AS pwd_hash,
                CASE
                    WHEN ISNULL(u.IsLocked, 0) = 1 THEN 'LOCKED'
                    WHEN ISNULL(u.IsVerified, 0) = 1 THEN 'ACTIVE'
                    ELSE 'PENDING_VERIFICATION'
                END AS acc_status,
                LOWER(ISNULL(u.Role, 'user')) AS src_role,
                LEFT(COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)), N''), LTRIM(RTRIM(u.Username))), 100) AS disp_name,
                LEFT(NULLIF(LTRIM(RTRIM(REPLACE(u.AvatarObjectKey, '\\', '/'))), ''), 500) AS avatar_key,
                LEFT(u.Bio, 1000) AS bio_text,
                COALESCE(u.CreatedAt, SYSUTCDATETIME()) AS created_at,
                COALESCE(u.UpdatedAt, u.CreatedAt, SYSUTCDATETIME()) AS updated_at
            FROM [{SOURCE_DB}].dbo.[User] u
            WHERE u.Email IS NOT NULL AND LTRIM(RTRIM(u.Email)) <> ''
        )
        INSERT INTO dbo.accounts (
            account_id, username, email, password_hash, status, failed_login_attempts,
            last_status_change_at, created_at
        )
        SELECT
            su.UserId, su.clean_username, su.clean_email, su.pwd_hash, su.acc_status, 0,
            su.updated_at, su.created_at
        FROM src_users su
        WHERE NOT EXISTS (SELECT 1 FROM dbo.accounts a WHERE a.account_id = su.UserId OR a.email = su.clean_email OR a.username = su.clean_username);
        """  # noqa: S608
    )

    cur.execute(
        f"""
        INSERT INTO dbo.readers (
            account_id, display_name, avatar_url, avatar_bucket, avatar_object_key, bio, is_birth_date_public
        )
        SELECT
            a.account_id,
            LEFT(COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)), N''), a.username), 100),
            NULL,
            CASE WHEN u.AvatarObjectKey IS NOT NULL AND LTRIM(RTRIM(u.AvatarObjectKey)) <> '' THEN '{MINIO_DEFAULT_BUCKET}' ELSE NULL END,
            LEFT(NULLIF(REPLACE(LTRIM(RTRIM(u.AvatarObjectKey)), '\\', '/'), ''), 500),
            LEFT(u.Bio, 1000),
            0
        FROM [{SOURCE_DB}].dbo.[User] u
        JOIN dbo.accounts a ON a.account_id = u.UserId
        WHERE NOT EXISTS (SELECT 1 FROM dbo.readers r WHERE r.account_id = a.account_id);
        """  # noqa: S608
    )

    cur.execute(
        f"""
        INSERT INTO dbo.admins (account_id, admin_code, role_level)
        SELECT
            a.account_id,
            'ADM-' + UPPER(LEFT(CAST(a.account_id AS VARCHAR(36)), 12)),
            'SUPER_ADMIN'
        FROM [{SOURCE_DB}].dbo.[User] u
        JOIN dbo.accounts a ON a.account_id = u.UserId
        WHERE LOWER(ISNULL(u.Role, 'user')) = 'admin'
          AND NOT EXISTS (SELECT 1 FROM dbo.admins ad WHERE ad.account_id = a.account_id);
        """  # noqa: S608
    )

    cur.execute(
        """
        INSERT INTO dbo.reader_settings (
            settings_id, reader_account_id, display_mode, reading_direction, fit_mode, preload_page_count, updated_at
        )
        SELECT NEWID(), r.account_id, 'VERTICAL_WEBTOON', 'LTR', 'FIT_WIDTH', 3, SYSUTCDATETIME()
        FROM dbo.readers r
        WHERE NOT EXISTS (SELECT 1 FROM dbo.reader_settings rs WHERE rs.reader_account_id = r.account_id);
        """
    )

    # 8. Reading status records (6,347)
    cur.execute(
        f"""
        INSERT INTO dbo.reading_status_records (record_id, reader_account_id, manga_id, status, updated_at)
        SELECT
            NEWID(),
            ums.UserId,
            ums.MangaId,
            UPPER(LTRIM(RTRIM(ums.Status))),
            COALESCE(ums.UpdatedAt, SYSUTCDATETIME())
        FROM [{SOURCE_DB}].dbo.UserMangaStatus ums
        JOIN dbo.readers r ON r.account_id = ums.UserId
        JOIN dbo.mangas m ON m.manga_id = ums.MangaId
        WHERE UPPER(LTRIM(RTRIM(ums.Status))) IN ('READING', 'PLAN_TO_READ', 'COMPLETED', 'ON_HOLD', 'DROPPED')
          AND NOT EXISTS (
              SELECT 1 FROM dbo.reading_status_records dst
              WHERE dst.reader_account_id = ums.UserId AND dst.manga_id = ums.MangaId
          );
        """  # noqa: S608
    )

    # 9. Reading histories (15,307) & ReaderProgress (latest per reader+manga)
    cur.execute(
        f"""
        INSERT INTO dbo.reading_histories (
            history_id, reader_account_id, chapter_id, opened_at, last_read_at, reading_duration_seconds, is_valid_view
        )
        SELECT
            rh.HistoryId,
            rh.UserId,
            rh.ChapterId,
            COALESCE(rh.ReadAt, SYSUTCDATETIME()),
            COALESCE(rh.ReadAt, SYSUTCDATETIME()),
            60,
            1
        FROM [{SOURCE_DB}].dbo.ReadingHistory rh
        JOIN dbo.readers r ON r.account_id = rh.UserId
        JOIN dbo.chapters ch ON ch.chapter_id = rh.ChapterId
        WHERE NOT EXISTS (SELECT 1 FROM dbo.reading_histories dst WHERE dst.history_id = rh.HistoryId);
        """  # noqa: S608
    )

    cur.execute(
        f"""
        ;WITH latest_prog AS (
            SELECT
                rh.UserId,
                ch.manga_id,
                rh.ChapterId,
                CASE WHEN ISNULL(rh.LastPageRead, 1) >= 1 THEN rh.LastPageRead ELSE 1 END AS page_num,
                COALESCE(rh.ReadAt, SYSUTCDATETIME()) AS read_at,
                ROW_NUMBER() OVER (PARTITION BY rh.UserId, ch.manga_id ORDER BY rh.ReadAt DESC, rh.HistoryId DESC) AS rn
            FROM [{SOURCE_DB}].dbo.ReadingHistory rh
            JOIN dbo.readers r ON r.account_id = rh.UserId
            JOIN dbo.chapters ch ON ch.chapter_id = rh.ChapterId
        )
        INSERT INTO dbo.reader_progress (
            reader_account_id, manga_id, chapter_id, page_number, page_uid, pages_revision, client_sequence, updated_at
        )
        SELECT lp.UserId, lp.manga_id, lp.ChapterId, lp.page_num, NULL, 1, 1, lp.read_at
        FROM latest_prog lp
        WHERE lp.rn = 1
          AND NOT EXISTS (
              SELECT 1 FROM dbo.reader_progress dst
              WHERE dst.reader_account_id = lp.UserId AND dst.manga_id = lp.manga_id
          );
        """  # noqa: S608
    )

    # 10. Import 100% of historical ratings (temporarily bypass UC-4.7 insert trigger for archival data)
    try:
        cur.execute("DISABLE TRIGGER ALL ON dbo.ratings;")
        cur.execute(
            f"""
            INSERT INTO dbo.ratings (rating_id, reader_account_id, manga_id, score, is_removed, updated_at)
            SELECT rt.RatingId, rt.UserId, rt.MangaId, rt.Score, 0, SYSUTCDATETIME()
            FROM [{SOURCE_DB}].dbo.Rating rt
            JOIN dbo.readers r ON r.account_id = rt.UserId
            JOIN dbo.mangas m ON m.manga_id = rt.MangaId
            WHERE rt.Score BETWEEN 1 AND 10
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.ratings dst
                  WHERE dst.rating_id = rt.RatingId
                     OR (dst.reader_account_id = rt.UserId AND dst.manga_id = rt.MangaId)
              );
            """  # noqa: S608
        )
    finally:
        cur.execute("ENABLE TRIGGER ALL ON dbo.ratings;")

    # 11. Comments (4,972) & Comment reactions (1,195)
    cur.execute(
        f"""
        INSERT INTO dbo.comments (
            comment_id, reader_account_id, manga_id, chapter_id, parent_comment_id, content,
            is_spoiler, is_spoiler_locked_by_admin, is_edited, is_deleted,
            like_count, dislike_count, created_at, updated_at
        )
        SELECT
            c.CommentId,
            c.UserId,
            c.MangaId,
            CASE WHEN ch.chapter_id IS NOT NULL THEN c.ChapterId ELSE NULL END,
            NULL,
            LEFT(LTRIM(RTRIM(c.Content)), 4000),
            ISNULL(c.IsSpoiler, 0),
            0,
            0,
            ISNULL(c.IsDeleted, 0),
            CASE WHEN ISNULL(c.LikeCount, 0) >= 0 THEN c.LikeCount ELSE 0 END,
            CASE WHEN ISNULL(c.DislikeCount, 0) >= 0 THEN c.DislikeCount ELSE 0 END,
            COALESCE(c.CreatedAt, SYSUTCDATETIME()),
            COALESCE(c.UpdatedAt, c.CreatedAt, SYSUTCDATETIME())
        FROM [{SOURCE_DB}].dbo.Comment c
        JOIN dbo.readers r ON r.account_id = c.UserId
        JOIN dbo.mangas m ON m.manga_id = c.MangaId
        LEFT JOIN dbo.chapters ch ON ch.chapter_id = c.ChapterId
        WHERE c.Content IS NOT NULL AND LEN(LTRIM(RTRIM(c.Content))) > 0
          AND NOT EXISTS (SELECT 1 FROM dbo.comments dst WHERE dst.comment_id = c.CommentId);
        """  # noqa: S608
    )

    cur.execute(
        f"""
        ;WITH dedup_rx AS (
            SELECT
                cr.ReactionId,
                cr.UserId,
                cr.CommentId,
                UPPER(LTRIM(RTRIM(cr.Type))) AS rtype,
                COALESCE(cr.CreatedAt, SYSUTCDATETIME()) AS created_at,
                ROW_NUMBER() OVER (PARTITION BY cr.UserId, cr.CommentId ORDER BY cr.CreatedAt DESC) AS rn
            FROM [{SOURCE_DB}].dbo.CommentReaction cr
            JOIN dbo.readers r ON r.account_id = cr.UserId
            JOIN dbo.comments c ON c.comment_id = cr.CommentId
            WHERE UPPER(LTRIM(RTRIM(cr.Type))) IN ('LIKE', 'DISLIKE')
        )
        INSERT INTO dbo.comment_reactions (reaction_id, reader_account_id, comment_id, reaction_type, updated_at)
        SELECT dx.ReactionId, dx.UserId, dx.CommentId, dx.rtype, dx.created_at
        FROM dedup_rx dx
        WHERE dx.rn = 1
          AND NOT EXISTS (
              SELECT 1 FROM dbo.comment_reactions dst
              WHERE dst.reaction_id = dx.ReactionId
                 OR (dst.reader_account_id = dx.UserId AND dst.comment_id = dx.CommentId)
          );
        """  # noqa: S608
    )

    # 12. Reading lists (20) & List items (137)
    cur.execute(
        f"""
        ;WITH lists_src AS (
            SELECT
                l.ListId,
                l.UserId,
                LEFT(COALESCE(NULLIF(LTRIM(RTRIM(l.Name)), N''), N'Untitled List'), 100) AS clean_name,
                LOWER(LEFT(COALESCE(NULLIF(LTRIM(RTRIM(l.Name)), N''), N'untitled list'), 150)) AS norm_name,
                LEFT(LTRIM(RTRIM(l.Description)), 500) AS clean_desc,
                COALESCE(l.CreatedAt, SYSUTCDATETIME()) AS created_at,
                COALESCE(l.UpdatedAt, SYSUTCDATETIME()) AS updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY l.UserId, LOWER(LEFT(COALESCE(NULLIF(LTRIM(RTRIM(l.Name)), N''), N'untitled list'), 150))
                    ORDER BY l.CreatedAt ASC, l.ListId ASC
                ) AS dup_rn
            FROM [{SOURCE_DB}].dbo.[List] l
            JOIN dbo.readers r ON r.account_id = l.UserId
        )
        INSERT INTO dbo.reading_lists (
            list_id, owner_reader_account_id, name, normalized_name, description, item_count, created_at, updated_at
        )
        SELECT
            ls.ListId,
            ls.UserId,
            CASE WHEN ls.dup_rn > 1 THEN LEFT(ls.clean_name, 90) + ' ' + CAST(ls.dup_rn AS NVARCHAR(8)) ELSE ls.clean_name END,
            CASE WHEN ls.dup_rn > 1 THEN LEFT(ls.norm_name, 140) + '-' + CAST(ls.dup_rn AS VARCHAR(8)) ELSE ls.norm_name END,
            ls.clean_desc,
            0,
            ls.created_at,
            ls.updated_at
        FROM lists_src ls
        WHERE NOT EXISTS (SELECT 1 FROM dbo.reading_lists dst WHERE dst.list_id = ls.ListId);
        """  # noqa: S608
    )

    cur.execute(
        f"""
        INSERT INTO dbo.list_items (list_item_id, list_id, manga_id, added_at)
        SELECT
            NEWID(),
            lm.ListId,
            lm.MangaId,
            COALESCE(lm.AddedAt, SYSUTCDATETIME())
        FROM [{SOURCE_DB}].dbo.ListManga lm
        JOIN dbo.reading_lists rl ON rl.list_id = lm.ListId
        JOIN dbo.mangas m ON m.manga_id = lm.MangaId
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.list_items dst WHERE dst.list_id = lm.ListId AND dst.manga_id = lm.MangaId
        );

        UPDATE rl
        SET rl.item_count = (SELECT COUNT(*) FROM dbo.list_items li WHERE li.list_id = rl.list_id)
        FROM dbo.reading_lists rl;
        """  # noqa: S608
    )

    # 13. Reports from `MangaLibrary.dbo.Report` -> COMMENT reports (obey `CK_reports_resolved` & `trg_comment_reports_guard`)
    cur.execute(
        f"""
        ;WITH rep_src AS (
            SELECT
                rep.ReportId,
                rep.UserId,
                rep.CommentId,
                LEFT(LTRIM(RTRIM(rep.Reason)), 2000) AS reason_txt,
                CASE
                    WHEN UPPER(ISNULL(rep.Status, 'PENDING')) IN ('RESOLVED', 'IGNORED', 'CLOSED')
                        THEN UPPER(LTRIM(RTRIM(rep.Status)))
                    ELSE 'PENDING'
                END AS norm_status,
                COALESCE(rep.CreatedAt, SYSUTCDATETIME()) AS created_at,
                LEFT(c.content, 500) AS comment_snap,
                ROW_NUMBER() OVER (PARTITION BY rep.UserId, rep.CommentId ORDER BY rep.CreatedAt ASC, rep.ReportId ASC) AS dup_rn
            FROM [{SOURCE_DB}].dbo.[Report] rep
            JOIN dbo.readers r ON r.account_id = rep.UserId
            JOIN dbo.comments c ON c.comment_id = rep.CommentId
            WHERE c.reader_account_id <> rep.UserId
        )
        INSERT INTO dbo.reports (
            report_id, reporter_reader_account_id, report_type, reason_category,
            description, status, resolution_note, action_taken, resolved_by_admin_account_id,
            created_at, resolved_at
        )
        SELECT
            rs.ReportId,
            rs.UserId,
            'COMMENT',
            N'COMMUNITY_REPORT',
            rs.reason_txt,
            rs.norm_status,
            NULL,
            NULL,
            NULL,
            rs.created_at,
            CASE WHEN rs.norm_status <> 'PENDING' THEN rs.created_at ELSE NULL END
        FROM rep_src rs
        WHERE rs.dup_rn = 1
          AND NOT EXISTS (SELECT 1 FROM dbo.reports dst WHERE dst.report_id = rs.ReportId);

        INSERT INTO dbo.comment_reports (report_id, target_comment_id, target_comment_snapshot)
        SELECT
            rep.ReportId,
            c.comment_id,
            LEFT(c.content, 500)
        FROM [{SOURCE_DB}].dbo.[Report] rep
        JOIN dbo.reports dst ON dst.report_id = rep.ReportId
        JOIN dbo.comments c ON c.comment_id = rep.CommentId
        WHERE c.reader_account_id <> rep.UserId
          AND NOT EXISTS (SELECT 1 FROM dbo.comment_reports cr WHERE cr.report_id = rep.ReportId);
        """  # noqa: S608
    )

    # Collect final counts
    counts: dict[str, int] = {}
    for tbl in (
        "mangas",
        "chapters",
        "media_objects",
        "manga_cover_arts",
        "manga_alt_titles",
        "manga_links",
        "manga_tags",
        "manga_creators",
        "creators",
        "tags",
        "accounts",
        "reading_status_records",
        "reading_histories",
        "reader_progress",
        "ratings",
        "comments",
        "comment_reactions",
        "reading_lists",
        "list_items",
        "reports",
    ):
        counts[tbl] = int(cur.execute(f"SELECT COUNT(*) FROM dbo.{tbl}").fetchone()[0] or 0)  # noqa: S608
    elapsed = time.perf_counter() - t0
    print(f"[import-local] Bulk T-SQL sync complete in {elapsed:.1f}s.")
    return counts


async def _ensure_account(
    container: AppContainer,
    *,
    username: str,
    email: str,
    password: str,
    display_name: str,
    bio: str,
    is_admin: bool = False,
) -> AccountModel:
    async with container.db.session() as db:
        existing = await db.scalar(select(AccountModel).where(AccountModel.username == username))
        if existing is not None:
            return existing
        now = utc_now()
        acc = AccountModel(
            account_id=uuid4(),
            username=username,
            email=email,
            password_hash=container.password_hasher.hash(password),
            status="ACTIVE",
            failed_login_attempts=0,
            last_status_change_at=now,
            created_at=now,
        )
        db.add(acc)
        await db.flush()
        if is_admin:
            db.add(
                AdminModel(
                    account_id=acc.account_id,
                    admin_code=f"ADM-{username.upper()}",
                    role_level="SUPER_ADMIN",
                )
            )
        db.add(
            ReaderModel(
                account_id=acc.account_id,
                display_name=display_name,
                bio=bio,
                is_birth_date_public=False,
            )
        )
        db.add(ReaderSettingsModel(reader_account_id=acc.account_id, updated_at=now))
        await db.commit()
        return acc


async def _ensure_demo_sample_and_vectors(container: AppContainer) -> None:
    """Seed demo accounts, `unknown` test manga, TF-IDF vectors (top 300), and reader1 interactions."""
    bucket = container.settings.s3_default_bucket
    now = utc_now()

    await _ensure_account(
        container,
        username="admin",
        email="admin@manga-reader.local",
        password="Admin@123456",
        display_name="Platform Admin",
        bio="System administrator for QL-DocTruyen.",
        is_admin=True,
    )
    reader1 = await _ensure_account(
        container,
        username="reader1",
        email="reader1@manga-reader.local",
        password="Reader@123456",
        display_name="Minh Anh",
        bio="Avid shounen & fantasy reader.",
    )
    reader2 = await _ensure_account(
        container,
        username="reader2",
        email="reader2@manga-reader.local",
        password="Reader@123456",
        display_name="Quoc Bao",
        bio="Seinen & mystery enthusiast.",
    )

    async with container.db.session() as db:
        # 1. Ensure 1 `content_rating='unknown'` test manga (`Mystery of the Silent Bell`)
        unknown_uuid = uuid5(NAMESPACE_URL, "ql-doctruyen:unknown-rating-sample")
        if await db.get(MangaModel, unknown_uuid) is None:
            u_key = "covers/local/unknown-sample/cover.webp"
            u_media = await db.scalar(
                select(MediaObjectModel).where(
                    MediaObjectModel.bucket == bucket,
                    MediaObjectModel.object_key == u_key,
                )
            )
            if u_media is None:
                u_media = MediaObjectModel(
                    bucket=bucket,
                    object_key=u_key,
                    content_type="image/webp",
                    width=600,
                    height=860,
                    file_size=0,
                    created_at=now,
                )
                db.add(u_media)
                await db.flush()
            u_manga = MangaModel(
                manga_id=unknown_uuid,
                pool_manga_id="local:unknown-sample",
                source_manga_id="local-unknown-001",
                slug="mystery-of-the-silent-bell",
                title="Mystery of the Silent Bell",
                description="An unrated folklore mystery anthology (verifies `safe` excludes `unknown`).",
                publication_status="hiatus",
                content_rating="unknown",
                publication_demographic="josei",
                original_language="ja",
                year=2021,
                primary_cover_media_id=u_media.media_id,
                visibility_status="PUBLIC",
                deletion_status="ACTIVE",
                total_views=42,
                average_rating=0,
                latest_chapter_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(u_manga)
            await db.flush()
            db.add(
                MangaCoverArtModel(
                    manga_id=unknown_uuid,
                    cover_id="local-unknown-cover",
                    volume="1",
                    locale="ja",
                    description="In-memory fallback cover",
                    media_id=u_media.media_id,
                )
            )
            u_ch_id = uuid5(NAMESPACE_URL, "ql-doctruyen:unknown-sample:ch1")
            db.add(
                ChapterModel(
                    chapter_id=u_ch_id,
                    manga_id=unknown_uuid,
                    pool_chapter_id="local:unknown-sample:ch1",
                    source_chapter_id="local-unknown-ch1",
                    chapter_number="1",
                    chapter_numeric=1,
                    volume="1",
                    title="Fog Over Kiri Pass",
                    language="en",
                    scanlation_group="Demo Studio",
                    publish_at=now,
                    source="local-demo",
                    page_count=4,
                    pages_revision=1,
                    view_count=42,
                    created_at=now,
                    updated_at=now,
                )
            )
            await db.flush()
            for p_num in range(1, 5):
                pk = f"demo-pages/{u_ch_id}/{p_num:03d}.webp"
                pm = MediaObjectModel(
                    bucket=bucket,
                    object_key=pk,
                    content_type="image/webp",
                    width=840,
                    height=1200,
                    file_size=0,
                    created_at=now,
                )
                db.add(pm)
                await db.flush()
                db.add(
                    ChapterPageModel(
                        chapter_id=u_ch_id,
                        page_uid=f"demo_unk_{p_num:03d}",
                        page_number=p_num,
                        filename=f"{p_num:03d}.webp",
                        media_id=pm.media_id,
                    )
                )
            db.add(
                MangaStatsModel(
                    manga_id=unknown_uuid,
                    chapter_count=1,
                    page_count=4,
                    total_size_bytes=180_000,
                    updated_at=now,
                )
            )
            await db.flush()
            db.add(MangaStatsLanguageModel(manga_id=unknown_uuid, language_code="en"))
            db.add(
                MangaLineageModel(
                    manga_id=unknown_uuid,
                    pool_revision=1,
                    source_metadata_revision=1,
                    manifest_sha256="",
                    published_at=now,
                    updated_at=now,
                )
            )
            mystery_tag = await db.scalar(select(TagModel).where(TagModel.slug == "mystery"))
            if mystery_tag is None:
                mystery_tag = TagModel(
                    slug="mystery", name="Mystery", tag_group="theme", source_tag_id="mystery"
                )
                db.add(mystery_tag)
                await db.flush()
                db.add(
                    TagNameModel(tag_id=mystery_tag.tag_id, language_code="en", tag_name="Mystery")
                )
            db.add(MangaTagModel(manga_id=unknown_uuid, tag_id=mystery_tag.tag_id))
            await db.commit()

        # 2. Populate TF-IDF content feature vectors for top 300 popular mangas (if not already present)
        vec_count = int(
            await db.scalar(select(func.count()).select_from(MangaContentVectorModel)) or 0
        )
        if vec_count < 250:
            top_mangas = (
                await db.scalars(
                    select(MangaModel)
                    .where(
                        MangaModel.visibility_status == "PUBLIC",
                        MangaModel.deletion_status == "ACTIVE",
                    )
                    .order_by(MangaModel.total_views.desc())
                    .limit(300)
                )
            ).all()
            top_ids = [m.manga_id for m in top_mangas]
            existing_vecs = set(
                (
                    await db.scalars(
                        select(MangaContentVectorModel.manga_id).where(
                            MangaContentVectorModel.manga_id.in_(top_ids)
                        )
                    )
                ).all()
            )
            t_pairs = (
                await db.execute(
                    select(MangaTagModel.manga_id, TagModel.slug)
                    .join(TagModel, TagModel.tag_id == MangaTagModel.tag_id)
                    .where(MangaTagModel.manga_id.in_(top_ids))
                )
            ).all()
            c_pairs = (
                await db.execute(
                    select(MangaCreatorModel.manga_id, MangaCreatorModel.creator_id).where(
                        MangaCreatorModel.manga_id.in_(top_ids)
                    )
                )
            ).all()
            t_map: dict[UUID, list[str]] = defaultdict(list)
            for mid, tslug in t_pairs:
                t_map[mid].append(tslug)
            c_map: dict[UUID, list[str]] = defaultdict(list)
            for mid, cid in c_pairs:
                c_map[mid].append(cid)

            for m in top_mangas:
                if m.manga_id in existing_vecs:
                    continue
                vec = compute_content_feature_vector(
                    tag_slugs=t_map.get(m.manga_id, []),
                    creator_ids=c_map.get(m.manga_id, []),
                    demographic=m.publication_demographic,
                    title=m.title,
                    description=m.description,
                )
                db.add(
                    MangaContentVectorModel(
                        manga_id=m.manga_id,
                        feature_vector_json=json.dumps(vec),
                        model_version="tfidf-v1",
                        updated_at=now,
                    )
                )
            await db.commit()

        # 3. Ensure rich demo library, history, lists & reports for `reader1` and `reader2`
        r1_status_cnt = int(
            await db.scalar(
                select(func.count())
                .select_from(ReadingStatusRecordModel)
                .where(ReadingStatusRecordModel.reader_account_id == reader1.account_id)
            )
            or 0
        )
        if r1_status_cnt == 0:
            sample_mangas = (
                await db.scalars(
                    select(MangaModel)
                    .join(MangaStatsModel, MangaStatsModel.manga_id == MangaModel.manga_id)
                    .where(
                        MangaModel.visibility_status == "PUBLIC",
                        MangaModel.deletion_status == "ACTIVE",
                        MangaModel.content_rating != "unknown",
                        MangaStatsModel.chapter_count > 0,
                    )
                    .order_by(MangaModel.latest_chapter_at.desc(), MangaModel.total_views.desc())
                    .limit(12)
                )
            ).all()
            statuses = ("READING", "READING", "READING", "PLAN_TO_READ", "COMPLETED", "ON_HOLD")
            r1_rated: list[tuple[UUID, int]] = []
            r2_rated: list[tuple[UUID, int]] = []
            for idx, m in enumerate(sample_mangas[:6]):
                ch = await db.scalar(
                    select(ChapterModel)
                    .where(ChapterModel.manga_id == m.manga_id)
                    .order_by(ChapterModel.chapter_numeric.asc())
                )
                db.add(
                    ReadingStatusRecordModel(
                        reader_account_id=reader1.account_id,
                        manga_id=m.manga_id,
                        status=statuses[idx],
                        updated_at=now,
                    )
                )
                if ch is not None:
                    db.add(
                        ReadingHistoryModel(
                            history_id=uuid4(),
                            reader_account_id=reader1.account_id,
                            chapter_id=ch.chapter_id,
                            opened_at=now,
                            last_read_at=now,
                            reading_duration_seconds=55 + idx * 10,
                            is_valid_view=True,
                        )
                    )
                    db.add(
                        ReaderProgressModel(
                            reader_account_id=reader1.account_id,
                            manga_id=m.manga_id,
                            chapter_id=ch.chapter_id,
                            page_number=min(3, max(1, ch.page_count)),
                            pages_revision=1,
                            client_sequence=1,
                            updated_at=now,
                        )
                    )
                    r1_rated.append((m.manga_id, 8 + (idx % 3)))

            for idx, m in enumerate(sample_mangas[2:8]):
                ch2 = await db.scalar(
                    select(ChapterModel)
                    .where(ChapterModel.manga_id == m.manga_id)
                    .order_by(ChapterModel.chapter_numeric.asc())
                )
                db.add(
                    ReadingStatusRecordModel(
                        reader_account_id=reader2.account_id,
                        manga_id=m.manga_id,
                        status="READING" if idx < 4 else "COMPLETED",
                        updated_at=now,
                    )
                )
                if ch2 is not None:
                    db.add(
                        ReadingHistoryModel(
                            history_id=uuid4(),
                            reader_account_id=reader2.account_id,
                            chapter_id=ch2.chapter_id,
                            opened_at=now,
                            last_read_at=now,
                            reading_duration_seconds=45 + idx * 8,
                            is_valid_view=True,
                        )
                    )
                    r2_rated.append((m.manga_id, 7 + (idx % 4)))

            # Flush reading histories BEFORE inserting ratings (`trg_ratings_require_reading_history` UC-4.7)
            await db.flush()
            for mid, sc in r1_rated:
                db.add(
                    RatingModel(
                        rating_id=uuid4(),
                        reader_account_id=reader1.account_id,
                        manga_id=mid,
                        score=sc,
                        updated_at=now,
                    )
                )
            for mid, sc in r2_rated:
                db.add(
                    RatingModel(
                        rating_id=uuid4(),
                        reader_account_id=reader2.account_id,
                        manga_id=mid,
                        score=sc,
                        updated_at=now,
                    )
                )
            await db.commit()

            p1 = SecurityPrincipal(
                account_id=AccountId(reader1.account_id),
                role=AccountRole.READER,
                status=AccountStatus.ACTIVE,
            )
            list_svc = ReadingListService(container)
            la = await list_svc.create_list(
                db,
                principal=p1,
                name="Top Action & Fantasy",
                description="My favorite high-energy manga from the catalog.",
            )
            lb = await list_svc.create_list(
                db,
                principal=p1,
                name="Weekend Binge List",
                description="Series saved for weekend reading sessions.",
            )
            await list_svc.create_list(
                db,
                principal=p1,
                name="Empty Starter List",
                description="An empty list ready to test empty metadata statistics.",
            )
            for m in sample_mangas[:4]:
                await list_svc.sync_manga_memberships(
                    db, principal=p1, manga_id=m.manga_id, selected_list_ids=[UUID(la["listId"])]
                )
            for m in sample_mangas[3:7]:
                sids = [UUID(lb["listId"])]
                if m in sample_mangas[:4]:
                    sids.append(UUID(la["listId"]))
                await list_svc.sync_manga_memberships(
                    db, principal=p1, manga_id=m.manga_id, selected_list_ids=sids
                )

            if sample_mangas:
                mod_svc = ModerationReportingService(container)
                await mod_svc.submit_manga_report(
                    db,
                    principal=p1,
                    target_manga_id=sample_mangas[0].manga_id,
                    target_chapter_id=None,
                    reason_category="WRONG_METADATA",
                    description="Sample pending report to test Admin Moderation Queue.",
                )
                cm = await db.scalar(
                    select(CommentModel).where(CommentModel.reader_account_id != reader1.account_id)
                )
                if cm is not None:
                    await mod_svc.submit_comment_report(
                        db,
                        principal=p1,
                        target_comment_id=cm.comment_id,
                        reason_category="UNMARKED_SPOILER",
                        description="Sample pending comment report for Admin Spoiler Lock test.",
                    )


def _cleanup_old_local_media_copies() -> None:
    """Remove previously copied cover/cache files from `storage/local-dev/` to reclaim disk."""
    local_root = REPO_ROOT / "storage" / "local-dev"
    for rel in ("manga-reader-media", "manga-media"):
        target = local_root / rel
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            print(f"[import-local] Removed old local copy directory: {target}")


async def run_import() -> int:
    _cleanup_old_local_media_copies()

    with pyodbc.connect(TARGET_MSSQL_CONN, autocommit=True, timeout=60) as conn:
        cur = conn.cursor()
        _reconcile_ql_doctruyen_schema(cur)
        tag_n, manga_n = _sync_tags_and_mangas_staging(cur)
        print(f"[import-local] Prepared {tag_n} tags and {manga_n:,} manga slugs.")
        counts = _bulk_sync_catalog_and_community(cur)
        cur.execute("DBCC SHRINKFILE (N'QL_DocTruyen_log', 16);")

    mssql_url = (
        f"mssql+aioodbc://@localhost/{TARGET_DB}"
        f"?driver={quote('ODBC Driver 17 for SQL Server', safe='')}"
        "&Trusted_Connection=yes&TrustServerCertificate=yes&MARS_Connection=yes"
    )
    settings = Settings(
        _env_file=None,
        database_backend="mssql",
        database_url=mssql_url,
        storage_backend="minio",
        s3_endpoint_url="http://127.0.0.1:9010",
        s3_default_bucket=MINIO_DEFAULT_BUCKET,
        s3_allowed_buckets="manga-media,manga-reader-media",
    )
    container = AppContainer(settings)
    try:
        await _ensure_demo_sample_and_vectors(container)
    finally:
        await container.shutdown()

    print("[import-local] DONE! `QL_DocTruyen` row summary:")
    for k, v in counts.items():
        print(f"  - {k}: {v:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_import()))
