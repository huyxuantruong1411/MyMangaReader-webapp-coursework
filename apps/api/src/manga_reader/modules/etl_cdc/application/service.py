"""Phase 3 & 4: Idempotent ETL ingestion (`manga-reader-package:2.0`) and CDC event processor."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    ConflictError,
    ContractValidationError,
    ForbiddenError,
    ResourceNotFoundError,
)
from manga_reader.common.identities import (
    ChapterId,
    MangaId,
    PoolChapterId,
    PoolMangaId,
)
from manga_reader.common.security import SecurityPrincipal
from manga_reader.common.text import normalize_search_text
from manga_reader.infrastructure.audit_outbox import append_activity_log, enqueue_outbox_event
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    CdcEventModel,
    ChapterModel,
    ChapterPageModel,
    CreatorBiographyModel,
    CreatorLinkModel,
    CreatorModel,
    EtlJobItemModel,
    EtlJobModel,
    MangaAltTitleModel,
    MangaContentVectorModel,
    MangaCoverArtModel,
    MangaCreatorModel,
    MangaDeletionTombstoneModel,
    MangaLineageModel,
    MangaLinkModel,
    MangaModel,
    MangaStatsLanguageModel,
    MangaStatsModel,
    MangaSyncSubscriptionModel,
    MangaTagModel,
    MediaObjectModel,
    ReaderProgressModel,
    TagModel,
    TagNameModel,
)
from manga_reader.modules.etl_cdc.contracts import (
    MappedMangaImportPlan,
    PackageV2Validator,
    map_package_to_import_plan,
)
from manga_reader.modules.etl_cdc.contracts.mapper import MappedMediaAsset
from manga_reader.modules.etl_cdc.infrastructure.sample_upstream import (
    build_sample_packages,
    serialize_package,
)

_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_STOPWORDS = frozenset(
    {"the", "and", "for", "with", "that", "this", "from", "into", "over", "about", "across"}
)


def compute_content_feature_vector(
    *,
    tag_slugs: list[str],
    creator_ids: list[str],
    demographic: str,
    title: str,
    description: str,
) -> dict[str, float]:
    """Compute normalized sparse TF-IDF-style feature vector for Content-Based Recommendations."""
    weights: dict[str, float] = {}
    for tag in tag_slugs:
        key = f"tag:{tag.lower()}"
        weights[key] = weights.get(key, 0.0) + 3.0
    for cid in creator_ids:
        key = f"creator:{cid}"
        weights[key] = weights.get(key, 0.0) + 2.5
    if demographic and demographic != "unknown":
        weights[f"demo:{demographic}"] = 1.5
    for token in _TOKEN_RE.findall(normalize_search_text(f"{title} {description}")):
        if token not in _STOPWORDS:
            key = f"kw:{token}"
            weights[key] = weights.get(key, 0.0) + 1.0

    norm = math.sqrt(sum(v * v for v in weights.values()))
    if norm <= 0:
        return {}
    return {k: round(v / norm, 6) for k, v in sorted(weights.items())}


class _SqlIdentityResolver:
    """In-memory snapshot resolver backed by existing DB rows for one import item."""

    def __init__(
        self,
        manga_map: dict[PoolMangaId, MangaId],
        chapter_map: dict[PoolChapterId, ChapterId],
    ) -> None:
        self._manga_map = manga_map
        self._chapter_map = chapter_map

    def find_manga_id(self, pool_manga_id: PoolMangaId) -> MangaId | None:
        return self._manga_map.get(pool_manga_id)

    def find_chapter_id(self, pool_chapter_id: PoolChapterId) -> ChapterId | None:
        return self._chapter_map.get(pool_chapter_id)


class EtlCdcService:
    """Application service for Module 4 (`etl_cdc`)."""

    def __init__(self, container: AppContainer) -> None:
        self._container = container
        self._validator = PackageV2Validator(
            max_package_bytes=container.settings.etl_max_package_bytes
        )

    async def _upsert_media(
        self, session: AsyncSession, asset: MappedMediaAsset
    ) -> MediaObjectModel:
        existing = await session.scalar(
            select(MediaObjectModel).where(
                MediaObjectModel.bucket == asset.ref.bucket,
                MediaObjectModel.object_key == asset.ref.object_key,
            )
        )
        now = utc_now()
        if existing is not None:
            existing.content_type = asset.content_type or existing.content_type
            existing.width = asset.width or existing.width
            existing.height = asset.height or existing.height
            existing.file_size = asset.file_size
            existing.md5_hash = asset.md5_hash or existing.md5_hash
            existing.sha256 = asset.sha256 or existing.sha256
            existing.gc_status = "ACTIVE"
            existing.deleted_at = None
            existing.last_verified_at = now
            return existing

        media = MediaObjectModel(
            bucket=asset.ref.bucket,
            object_key=asset.ref.object_key,
            content_type=asset.content_type,
            width=asset.width,
            height=asset.height,
            file_size=asset.file_size,
            md5_hash=asset.md5_hash,
            sha256=asset.sha256,
            gc_status="ACTIVE",
            last_verified_at=now,
            created_at=now,
        )
        session.add(media)
        await session.flush()
        return media

    async def _recompute_manga_stats(self, session: AsyncSession, manga_id: UUID) -> None:
        chapters = (
            await session.scalars(select(ChapterModel).where(ChapterModel.manga_id == manga_id))
        ).all()
        chapter_count = len(chapters)
        page_count = sum(c.page_count for c in chapters)
        total_bytes = sum(c.total_size_bytes for c in chapters)
        languages = sorted({c.language.lower() for c in chapters})
        latest_pub = max(
            (c.publish_at or c.updated_at or c.created_at for c in chapters),
            default=None,
        )

        manga = await session.get(MangaModel, manga_id)
        if manga is not None and latest_pub is not None:
            manga.latest_chapter_at = latest_pub

        now = utc_now()
        stats = await session.get(MangaStatsModel, manga_id)
        if stats is None:
            session.add(
                MangaStatsModel(
                    manga_id=manga_id,
                    chapter_count=chapter_count,
                    page_count=page_count,
                    total_size_bytes=total_bytes,
                    updated_at=now,
                )
            )
            await session.flush()
        else:
            stats.chapter_count = chapter_count
            stats.page_count = page_count
            stats.total_size_bytes = total_bytes
            stats.updated_at = now

        await session.execute(
            delete(MangaStatsLanguageModel).where(MangaStatsLanguageModel.manga_id == manga_id)
        )
        for lang in languages:
            session.add(MangaStatsLanguageModel(manga_id=manga_id, language_code=lang))

    async def ingest_package_bytes(
        self,
        session: AsyncSession,
        raw_bytes: bytes,
        *,
        allow_tombstoned: bool = False,
    ) -> tuple[UUID, str, MappedMangaImportPlan]:
        """Validate and atomically upsert ONE manga package inside the caller's transaction."""
        envelope = self._validator.validate_bytes(raw_bytes)
        dto = envelope.package
        pool_manga_id_str = dto.manga.pool_manga_id

        if not allow_tombstoned:
            tombstone = await session.get(MangaDeletionTombstoneModel, pool_manga_id_str)
            if tombstone is not None:
                raise ConflictError(
                    f"Manga '{pool_manga_id_str}' was deleted (tombstoned) and cannot be recreated.",
                    error_code="MANGA_TOMBSTONED",
                )

        existing_manga = await session.scalar(
            select(MangaModel).where(MangaModel.pool_manga_id == pool_manga_id_str)
        )
        slug_conflict = await session.scalar(
            select(MangaModel).where(MangaModel.slug == dto.manga.slug)
        )
        if slug_conflict is not None and (
            existing_manga is None or slug_conflict.manga_id != existing_manga.manga_id
        ):
            raise ConflictError(
                f"Slug '{dto.manga.slug}' already belongs to a different pool_manga_id.",
                error_code="DUPLICATE_RESOURCE",
            )

        manga_map: dict[PoolMangaId, MangaId] = {}
        chapter_map: dict[PoolChapterId, ChapterId] = {}
        if existing_manga is not None:
            manga_map[PoolMangaId(existing_manga.pool_manga_id)] = MangaId(existing_manga.manga_id)
            existing_chs = (
                await session.scalars(
                    select(ChapterModel).where(ChapterModel.manga_id == existing_manga.manga_id)
                )
            ).all()
            for ch in existing_chs:
                chapter_map[PoolChapterId(ch.pool_chapter_id)] = ChapterId(ch.chapter_id)

        plan = map_package_to_import_plan(
            dto, resolver=_SqlIdentityResolver(manga_map, chapter_map)
        )
        now = utc_now()

        # Primary cover media
        primary_cover_id: int | None = None
        if plan.primary_cover is not None:
            cover_media = await self._upsert_media(session, plan.primary_cover)
            primary_cover_id = cover_media.media_id

        if existing_manga is None:
            manga = MangaModel(
                manga_id=plan.manga_id,
                pool_manga_id=str(plan.pool_manga_id),
                slug=plan.slug,
                source_manga_id=str(plan.source_manga_id),
                mangadex_id=plan.mangadex_id,
                title=plan.title,
                description=plan.description,
                publication_status=plan.publication_status.value,
                content_rating=plan.content_rating.value,
                publication_demographic=plan.publication_demographic.value,
                original_language=plan.original_language,
                year=plan.year,
                published_start_date=dto.manga.published_start_date,
                published_end_date=dto.manga.published_end_date,
                official_volumes=plan.official_volumes,
                official_chapters=plan.official_chapters,
                primary_cover_media_id=primary_cover_id,
                visibility_status="PUBLIC",
                deletion_status="ACTIVE",
                created_at=now,
                updated_at=now,
            )
            session.add(manga)
            await session.flush()
        else:
            manga = existing_manga
            manga.slug = plan.slug
            manga.source_manga_id = str(plan.source_manga_id)
            manga.mangadex_id = plan.mangadex_id
            manga.title = plan.title
            manga.description = plan.description
            manga.publication_status = plan.publication_status.value
            manga.content_rating = plan.content_rating.value
            manga.publication_demographic = plan.publication_demographic.value
            manga.original_language = plan.original_language
            manga.year = plan.year
            manga.published_start_date = dto.manga.published_start_date
            manga.published_end_date = dto.manga.published_end_date
            manga.official_volumes = plan.official_volumes
            manga.official_chapters = plan.official_chapters
            if primary_cover_id is not None:
                manga.primary_cover_media_id = primary_cover_id
            manga.updated_at = now

        # Replace alt titles deterministically
        await session.execute(
            delete(MangaAltTitleModel).where(MangaAltTitleModel.manga_id == manga.manga_id)
        )
        for idx, alt in enumerate(plan.alt_titles):
            session.add(
                MangaAltTitleModel(
                    manga_id=manga.manga_id,
                    alternative_title=alt,
                    display_order=idx,
                )
            )

        # Upsert Creators + localized biographies + links + dual-role credits (ADR-007 & ADR-017)
        for cr in plan.creators:
            creator_row = await session.get(CreatorModel, str(cr.creator_id))
            en_bio = cr.biographies_by_locale.get("en") or next(
                iter(cr.biographies_by_locale.values()), None
            )
            if creator_row is None:
                creator_row = CreatorModel(
                    creator_id=str(cr.creator_id),
                    slug=cr.slug,
                    name=cr.name,
                    mangadex_id=cr.mangadex_id,
                    biography=en_bio,
                )
                session.add(creator_row)
                await session.flush()
            else:
                creator_row.name = cr.name
                creator_row.slug = cr.slug
                creator_row.biography = en_bio

            for lang_code, bio_text in cr.biographies_by_locale.items():
                bio_row = await session.get(CreatorBiographyModel, (str(cr.creator_id), lang_code))
                if bio_row is None:
                    session.add(
                        CreatorBiographyModel(
                            creator_id=str(cr.creator_id),
                            language_code=lang_code,
                            biography=bio_text,
                        )
                    )
                else:
                    bio_row.biography = bio_text

            for platform, url in cr.links_by_platform.items():
                link_row = await session.get(CreatorLinkModel, (str(cr.creator_id), platform))
                if link_row is None:
                    session.add(
                        CreatorLinkModel(
                            creator_id=str(cr.creator_id),
                            platform=platform,
                            url=url,
                        )
                    )
                else:
                    link_row.url = url

        await session.execute(
            delete(MangaCreatorModel).where(MangaCreatorModel.manga_id == manga.manga_id)
        )
        for credit in plan.creator_credits:
            session.add(
                MangaCreatorModel(
                    manga_id=manga.manga_id,
                    creator_id=str(credit.creator_id),
                    role=credit.role.value,
                )
            )

        # Upsert Tags + localized names (ADR-007)
        await session.execute(delete(MangaTagModel).where(MangaTagModel.manga_id == manga.manga_id))
        tag_slugs: list[str] = []
        for t in plan.tags:
            tag_slugs.append(t.slug)
            tag_row = await session.scalar(select(TagModel).where(TagModel.slug == t.slug))
            en_name = t.names_by_locale.get("en") or t.slug
            if tag_row is None:
                tag_row = TagModel(
                    slug=t.slug,
                    source_tag_id=t.source_tag_id,
                    mangadex_id=t.mangadex_id,
                    tag_group=t.group.value,
                    name=en_name,
                )
                session.add(tag_row)
                await session.flush()
            else:
                tag_row.name = en_name
                tag_row.tag_group = t.group.value

            for lang_code, loc_name in t.names_by_locale.items():
                tn = await session.get(TagNameModel, (tag_row.tag_id, lang_code))
                if tn is None:
                    session.add(
                        TagNameModel(
                            tag_id=tag_row.tag_id,
                            language_code=lang_code,
                            tag_name=loc_name,
                        )
                    )
                else:
                    tn.tag_name = loc_name

            session.add(MangaTagModel(manga_id=manga.manga_id, tag_id=tag_row.tag_id))

        # Manga links & cover arts
        await session.execute(
            delete(MangaLinkModel).where(MangaLinkModel.manga_id == manga.manga_id)
        )
        for lnk in dto.manga.links:
            session.add(MangaLinkModel(manga_id=manga.manga_id, site=lnk.site, url=lnk.url))

        await session.execute(
            delete(MangaCoverArtModel).where(MangaCoverArtModel.manga_id == manga.manga_id)
        )
        for cov in dto.manga.cover_arts:
            cov_media = await self._upsert_media(
                session,
                MappedMediaAsset(
                    ref=plan.primary_cover.ref
                    if (
                        plan.primary_cover
                        and plan.primary_cover.ref.bucket == cov.media.bucket
                        and plan.primary_cover.ref.object_key == cov.media.object_key
                    )
                    else __import__(
                        "manga_reader.common.identities", fromlist=["MediaObjectRef"]
                    ).MediaObjectRef(bucket=cov.media.bucket, object_key=cov.media.object_key),
                    content_type=cov.media.content_type,
                    width=cov.media.width,
                    height=cov.media.height,
                    file_size=cov.media.file_size,
                    md5_hash=cov.media.md5_hash,
                    sha256=cov.media.sha256,
                ),
            )
            session.add(
                MangaCoverArtModel(
                    manga_id=manga.manga_id,
                    cover_id=cov.cover_id,
                    volume=cov.volume,
                    locale=cov.locale,
                    description=cov.description,
                    media_id=cov_media.media_id,
                )
            )

        # Lineage upsert with revision monotonicity check
        if dto.manga.lineage is not None:
            lin = await session.get(MangaLineageModel, manga.manga_id)
            if lin is None:
                session.add(
                    MangaLineageModel(
                        manga_id=manga.manga_id,
                        pool_revision=dto.manga.lineage.pool_revision,
                        source_metadata_revision=dto.manga.lineage.source_metadata_revision,
                        manifest_sha256=dto.manga.lineage.manifest_sha256,
                        published_at=dto.manga.lineage.published_at,
                        updated_at=dto.manga.lineage.updated_at,
                    )
                )
            elif dto.manga.lineage.pool_revision >= lin.pool_revision:
                lin.pool_revision = dto.manga.lineage.pool_revision
                lin.source_metadata_revision = dto.manga.lineage.source_metadata_revision
                lin.manifest_sha256 = dto.manga.lineage.manifest_sha256
                lin.published_at = dto.manga.lineage.published_at
                lin.updated_at = dto.manga.lineage.updated_at

        # Chapters (ADR-012: ONLY mutate when `chapters` array is explicitly present!)
        if plan.chapters is not None:
            for mapped_ch in plan.chapters:
                existing_ch = await session.scalar(
                    select(ChapterModel).where(
                        ChapterModel.pool_chapter_id == str(mapped_ch.pool_chapter_id)
                    )
                )
                if existing_ch is not None:
                    if existing_ch.manga_id != manga.manga_id:
                        raise ContractValidationError(
                            f"pool_chapter_id '{mapped_ch.pool_chapter_id}' already belongs to "
                            "another manga."
                        )
                    # Stale revision guard
                    if mapped_ch.pages_revision < existing_ch.pages_revision:
                        continue
                    existing_ch.chapter_number = mapped_ch.chapter_number
                    existing_ch.chapter_numeric = Decimal(str(mapped_ch.chapter_numeric))
                    existing_ch.volume = mapped_ch.volume
                    existing_ch.title = mapped_ch.title
                    existing_ch.language = mapped_ch.language
                    existing_ch.scanlation_group = mapped_ch.scanlation_group
                    existing_ch.publish_at = mapped_ch.publish_at_utc
                    existing_ch.page_count = mapped_ch.page_count
                    existing_ch.total_size_bytes = mapped_ch.total_size_bytes
                    existing_ch.pages_revision = mapped_ch.pages_revision
                    existing_ch.manifest_sha256 = mapped_ch.manifest_sha256
                    existing_ch.updated_at = mapped_ch.updated_at_utc or now
                    ch_row = existing_ch
                    await session.execute(
                        delete(ChapterPageModel).where(
                            ChapterPageModel.chapter_id == ch_row.chapter_id
                        )
                    )
                else:
                    ch_row = ChapterModel(
                        chapter_id=mapped_ch.chapter_id,
                        manga_id=manga.manga_id,
                        pool_chapter_id=str(mapped_ch.pool_chapter_id),
                        source_chapter_id=str(mapped_ch.source_chapter_id),
                        chapter_number=mapped_ch.chapter_number,
                        chapter_numeric=Decimal(str(mapped_ch.chapter_numeric)),
                        volume=mapped_ch.volume,
                        title=mapped_ch.title,
                        language=mapped_ch.language,
                        scanlation_group=mapped_ch.scanlation_group,
                        publish_at=mapped_ch.publish_at_utc,
                        source=mapped_ch.source,
                        source_id=mapped_ch.source_id,
                        page_count=mapped_ch.page_count,
                        total_size_bytes=mapped_ch.total_size_bytes,
                        pages_revision=mapped_ch.pages_revision,
                        manifest_sha256=mapped_ch.manifest_sha256,
                        updated_at=mapped_ch.updated_at_utc or now,
                        created_at=now,
                    )
                    session.add(ch_row)
                    await session.flush()

                for pg in mapped_ch.pages:
                    pg_media = await self._upsert_media(session, pg.media)
                    session.add(
                        ChapterPageModel(
                            chapter_id=ch_row.chapter_id,
                            page_uid=str(pg.page_uid),
                            page_number=pg.page_number,
                            filename=pg.filename,
                            media_id=pg_media.media_id,
                        )
                    )

        # Recompute manga_stats + content vector for recommendations
        await self._recompute_manga_stats(session, manga.manga_id)
        vec = compute_content_feature_vector(
            tag_slugs=tag_slugs,
            creator_ids=[str(c.creator_id) for c in plan.creators],
            demographic=plan.publication_demographic.value,
            title=plan.title,
            description=plan.description,
        )
        vec_row = await session.get(MangaContentVectorModel, manga.manga_id)
        vec_json = json.dumps(vec, ensure_ascii=False)
        if vec_row is None:
            session.add(
                MangaContentVectorModel(
                    manga_id=manga.manga_id,
                    feature_vector_json=vec_json,
                    model_version="tfidf-v1",
                    updated_at=now,
                )
            )
        else:
            vec_row.feature_vector_json = vec_json
            vec_row.updated_at = now

        return manga.manga_id, envelope.payload_sha256, plan

    async def list_external_sources(self) -> list[dict[str, Any]]:
        samples = await build_sample_packages(
            self._container.storage, bucket=self._container.settings.s3_default_bucket
        )
        return [
            {
                "sourceMangaId": s.source_manga_id,
                "poolMangaId": s.pool_manga_id,
                "title": s.title,
                "slug": s.payload["manga"]["slug"],
                "contentRating": s.payload["manga"]["content_rating"],
                "status": s.payload["manga"]["status"],
                "chapterCount": len(s.payload.get("chapters", [])),
                "contractName": "manga-reader-package",
                "contractVersion": "2.0",
            }
            for s in samples
        ]

    async def create_and_execute_batch_job(
        self,
        *,
        admin_principal: SecurityPrincipal,
        items: list[dict[str, Any]],
        source_system: str = "local-sample-upstream",
    ) -> dict[str, Any]:
        """Execute batch ETL with strict per-manga transaction & failure isolation (ETL-015)."""
        assert admin_principal.account_id is not None
        samples = await build_sample_packages(
            self._container.storage, bucket=self._container.settings.s3_default_bucket
        )
        sample_by_pool = {s.pool_manga_id: s for s in samples}

        now = utc_now()
        job_id = uuid4()
        async with self._container.db.session() as db:
            job = EtlJobModel(
                job_id=job_id,
                requested_by_admin_id=admin_principal.account_id,
                job_type="BATCH_IMPORT",
                status="RUNNING",
                source_system=source_system,
                batch_size=max(len(items), 1),
                created_at=now,
                started_at=now,
            )
            db.add(job)
            await db.flush()
            item_rows: list[tuple[UUID, dict[str, Any]]] = []
            for spec in items:
                item_id = uuid4()
                db.add(
                    EtlJobItemModel(
                        job_item_id=item_id,
                        job_id=job_id,
                        source_manga_id=str(spec.get("sourceMangaId") or spec.get("poolMangaId")),
                        pool_manga_id=spec.get("poolMangaId"),
                        enable_cdc=bool(spec.get("enableCdc", False)),
                        status="QUEUED",
                        attempt_count=0,
                    )
                )
                item_rows.append((item_id, spec))
            await db.commit()

        succeeded = 0
        failed = 0
        for item_id, spec in item_rows:
            item_start = utc_now()
            async with self._container.db.session() as item_db:
                item_row = await item_db.get(EtlJobItemModel, item_id)
                assert item_row is not None
                item_row.status = "PROCESSING"
                item_row.attempt_count += 1
                item_row.started_at = item_start
                try:
                    raw_payload_obj = spec.get("packagePayload")
                    if raw_payload_obj is not None:
                        raw_bytes = serialize_package(raw_payload_obj)
                    else:
                        pool_id = str(spec.get("poolMangaId", ""))
                        sample = sample_by_pool.get(pool_id)
                        if sample is None:
                            raise ResourceNotFoundError(
                                f"External package '{pool_id}' not found in upstream catalog."
                            )
                        raw_bytes = serialize_package(sample.payload)

                    async with item_db.begin_nested():
                        manga_id, payload_sha, plan = await self.ingest_package_bytes(
                            item_db, raw_bytes
                        )
                        if item_row.enable_cdc:
                            await self._upsert_cdc_subscription(
                                item_db, manga_id=manga_id, enable=True
                            )

                    item_row.manga_id = manga_id
                    item_row.pool_manga_id = str(plan.pool_manga_id)
                    item_row.exported_at = plan.exported_at_utc
                    item_row.payload_sha256 = payload_sha
                    item_row.checksum_validated = True
                    item_row.status = "SUCCEEDED"
                    item_row.completed_at = utc_now()
                    item_row.error_message = None
                    append_activity_log(
                        item_db,
                        event_type="MANGA_IMPORTED",
                        account_id=admin_principal.account_id,
                        target_type="MANGA",
                        target_id=str(manga_id),
                        details={
                            "job_id": str(job_id),
                            "pool_manga_id": str(plan.pool_manga_id),
                            "enable_cdc": item_row.enable_cdc,
                        },
                    )
                    await item_db.commit()
                    succeeded += 1
                except Exception as exc:
                    # Only this single manga savepoint rolls back; job continues (ETL-015)
                    item_row.status = "FAILED"
                    item_row.checksum_validated = False
                    item_row.completed_at = utc_now()
                    item_row.error_message = f"{type(exc).__name__}: {exc}"
                    await item_db.commit()
                    failed += 1

        async with self._container.db.session() as db:
            job_row = await db.get(EtlJobModel, job_id)
            assert job_row is not None
            if failed == 0:
                job_row.status = "SUCCEEDED"
            elif succeeded > 0:
                job_row.status = "PARTIAL_FAILED"
                job_row.error_summary = f"{succeeded} succeeded, {failed} failed."
            else:
                job_row.status = "FAILED"
                job_row.error_summary = f"All {failed} item(s) failed."
            job_row.completed_at = utc_now()
            await db.commit()
            return await self.get_job_detail(db, job_id)

    async def _upsert_cdc_subscription(
        self, session: AsyncSession, *, manga_id: UUID, enable: bool
    ) -> MangaSyncSubscriptionModel | None:
        manga = await session.get(MangaModel, manga_id)
        if manga is None:
            raise ResourceNotFoundError("Manga not found.")
        now = utc_now()
        sub = await session.scalar(
            select(MangaSyncSubscriptionModel).where(
                MangaSyncSubscriptionModel.manga_id == manga_id
            )
        )
        if enable:
            if sub is None:
                sub = MangaSyncSubscriptionModel(
                    manga_id=manga_id,
                    provider_subscription_key=f"cdc_{manga.pool_manga_id}_{uuid4().hex[:8]}",
                    status="ACTIVE",
                    subscribed_at=now,
                    updated_at=now,
                )
                session.add(sub)
            else:
                sub.status = "ACTIVE"
                sub.unsubscribed_at = None
                sub.updated_at = now
            manga.is_cdc_enabled = True
        else:
            if sub is not None:
                sub.status = "CANCELLED"
                sub.unsubscribed_at = now
                sub.updated_at = now
            manga.is_cdc_enabled = False
        return sub

    async def toggle_cdc(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        manga_id: UUID,
        enable: bool,
    ) -> dict[str, Any]:
        sub = await self._upsert_cdc_subscription(session, manga_id=manga_id, enable=enable)
        append_activity_log(
            session,
            event_type="CDC_SUBSCRIPTION_CHANGED",
            account_id=admin_principal.account_id,
            target_type="MANGA",
            target_id=str(manga_id),
            details={"is_cdc_enabled": enable},
        )
        await session.commit()
        return {
            "mangaId": str(manga_id),
            "isCdcEnabled": enable,
            "subscriptionStatus": sub.status if sub else "CANCELLED",
        }

    async def list_jobs(
        self,
        session: AsyncSession,
        *,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        stmt = select(EtlJobModel)
        count_stmt = select(func.count()).select_from(EtlJobModel)
        if status:
            stmt = stmt.where(EtlJobModel.status == status)
            count_stmt = count_stmt.where(EtlJobModel.status == status)
        total = int(await session.scalar(count_stmt) or 0)
        jobs = (
            await session.scalars(
                stmt.order_by(EtlJobModel.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return [
            {
                "jobId": str(j.job_id),
                "jobType": j.job_type,
                "status": j.status,
                "sourceSystem": j.source_system,
                "batchSize": j.batch_size,
                "retryCount": j.retry_count,
                "errorSummary": j.error_summary,
                "createdAt": format_rfc3339(j.created_at),
                "completedAt": format_rfc3339(j.completed_at) if j.completed_at else None,
            }
            for j in jobs
        ], total

    async def get_job_detail(self, session: AsyncSession, job_id: UUID) -> dict[str, Any]:
        job = await session.get(EtlJobModel, job_id)
        if job is None:
            raise ResourceNotFoundError("ETL job not found.")
        items = (
            await session.scalars(select(EtlJobItemModel).where(EtlJobItemModel.job_id == job_id))
        ).all()
        return {
            "jobId": str(job.job_id),
            "jobType": job.job_type,
            "status": job.status,
            "sourceSystem": job.source_system,
            "batchSize": job.batch_size,
            "errorSummary": job.error_summary,
            "createdAt": format_rfc3339(job.created_at),
            "completedAt": format_rfc3339(job.completed_at) if job.completed_at else None,
            "items": [
                {
                    "jobItemId": str(it.job_item_id),
                    "mangaId": str(it.manga_id) if it.manga_id else None,
                    "sourceMangaId": it.source_manga_id,
                    "poolMangaId": it.pool_manga_id,
                    "enableCdc": it.enable_cdc,
                    "status": it.status,
                    "attemptCount": it.attempt_count,
                    "checksumValidated": it.checksum_validated,
                    "payloadSha256": it.payload_sha256,
                    "errorMessage": it.error_message,
                }
                for it in items
            ],
        }

    async def retry_job_item(
        self,
        *,
        admin_principal: SecurityPrincipal,
        job_item_id: UUID,
    ) -> dict[str, Any]:
        async with self._container.db.session() as db:
            item = await db.get(EtlJobItemModel, job_item_id)
            if item is None:
                raise ResourceNotFoundError("ETL job item not found.")
            if item.status != "FAILED":
                raise ConflictError("Only FAILED ETL job items can be retried.")
            spec = {
                "sourceMangaId": item.source_manga_id,
                "poolMangaId": item.pool_manga_id,
                "enableCdc": item.enable_cdc,
            }
        return await self.create_and_execute_batch_job(
            admin_principal=admin_principal,
            items=[spec],
            source_system="retry",
        )

    async def receive_cdc_event(
        self,
        session: AsyncSession,
        *,
        raw_body: bytes,
        signature_header: str | None = None,
    ) -> dict[str, Any]:
        """Idempotent CDC webhook receiver (`05_PACKAGE_V2_ETL_CDC.md` §7, `ETL-019..025`)."""
        secret = self._container.settings.upstream_webhook_secret.get_secret_value()
        if secret:
            expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
            if not signature_header or not hmac.compare_digest(signature_header, expected):
                raise ForbiddenError("Invalid CDC webhook signature.")

        payload_sha = hashlib.sha256(raw_body).hexdigest()
        envelope = json.loads(raw_body.decode("utf-8"))
        ext_event_id = str(envelope.get("eventId", "")).strip()
        event_type = str(envelope.get("eventType", "")).strip()
        pool_manga_id = str(envelope.get("poolMangaId", "")).strip()
        pool_chapter_id = envelope.get("poolChapterId")
        pool_revision = envelope.get("poolRevision")

        if not ext_event_id or not event_type or not pool_manga_id:
            raise ContractValidationError("CDC event requires eventId, eventType, and poolMangaId.")

        # Idempotent duplicate event detection (ETL-019)
        existing_evt = await session.scalar(
            select(CdcEventModel).where(CdcEventModel.external_event_id == ext_event_id)
        )
        if existing_evt is not None:
            return {
                "eventId": str(existing_evt.event_id),
                "externalEventId": ext_event_id,
                "status": existing_evt.status,
                "duplicate": True,
            }

        now = utc_now()
        evt = CdcEventModel(
            external_event_id=ext_event_id,
            pool_manga_id=pool_manga_id,
            pool_chapter_id=str(pool_chapter_id) if pool_chapter_id else None,
            pool_revision=int(pool_revision) if pool_revision is not None else None,
            event_type=event_type,
            status="PROCESSING",
            payload_sha256=payload_sha,
            payload_json=raw_body.decode("utf-8"),
            received_at=now,
        )
        session.add(evt)
        await session.flush()

        # Check tombstone to prevent resurrecting deleted manga (ETL-024 / ADR-011)
        tombstone = await session.get(MangaDeletionTombstoneModel, pool_manga_id)
        if tombstone is not None:
            evt.status = "FAILED"
            evt.last_error = "Rejected: manga was deleted (tombstoned)."
            await session.commit()
            return {
                "eventId": str(evt.event_id),
                "externalEventId": ext_event_id,
                "status": "FAILED",
                "reason": "MANGA_TOMBSTONED",
            }

        manga = await session.scalar(
            select(MangaModel).where(MangaModel.pool_manga_id == pool_manga_id)
        )
        if manga is None:
            evt.status = "FAILED"
            evt.last_error = "Target manga is not imported."
            await session.commit()
            return {"eventId": str(evt.event_id), "status": "FAILED", "reason": "NOT_IMPORTED"}

        evt.manga_id = manga.manga_id
        # Out-of-order revision guard (ETL-020)
        lineage = await session.get(MangaLineageModel, manga.manga_id)
        if (
            lineage is not None
            and pool_revision is not None
            and int(pool_revision) < lineage.pool_revision
        ):
            evt.status = "PROCESSED"
            evt.processed_at = utc_now()
            evt.last_error = "Ignored stale out-of-order pool_revision."
            await session.commit()
            return {
                "eventId": str(evt.event_id),
                "status": "PROCESSED",
                "staleIgnored": True,
            }

        try:
            if event_type == "CHAPTER_DELETED":
                if pool_chapter_id:
                    ch_del = await session.scalar(
                        select(ChapterModel).where(
                            ChapterModel.pool_chapter_id == str(pool_chapter_id),
                            ChapterModel.manga_id == manga.manga_id,
                        )
                    )
                    if ch_del is not None:
                        await session.execute(
                            delete(ReaderProgressModel).where(
                                ReaderProgressModel.chapter_id == ch_del.chapter_id
                            )
                        )
                        await session.delete(ch_del)
                        await self._recompute_manga_stats(session, manga.manga_id)
            else:
                inner_pkg = envelope.get("payload")
                if not isinstance(inner_pkg, dict):
                    raise ContractValidationError("CDC event missing v2.0 package payload object.")
                async with session.begin_nested():
                    await self.ingest_package_bytes(session, serialize_package(inner_pkg))

            sub = await session.scalar(
                select(MangaSyncSubscriptionModel).where(
                    MangaSyncSubscriptionModel.manga_id == manga.manga_id
                )
            )
            if sub is not None:
                sub.last_event_at = utc_now()
            evt.status = "PROCESSED"
            evt.processed_at = utc_now()
            await enqueue_outbox_event(
                session,
                idempotency_key=f"cdc-processed:{ext_event_id}",
                event_type="CHAPTER_UPSERTED",
                aggregate_type="MANGA",
                aggregate_id=str(manga.manga_id),
                payload={"externalEventId": ext_event_id, "eventType": event_type},
            )
            await session.commit()
        except Exception as exc:
            evt.status = "FAILED"
            evt.last_error = f"{type(exc).__name__}: {exc}"
            await session.commit()

        return {
            "eventId": str(evt.event_id),
            "externalEventId": ext_event_id,
            "status": evt.status,
            "error": evt.last_error,
        }
