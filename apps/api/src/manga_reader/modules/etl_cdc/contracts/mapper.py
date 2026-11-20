"""External-to-Internal identity mapper for `manga-reader-package:2.0`.

Enforces:
- Internal UUIDs (`MangaId`, `ChapterId`) stay strictly decoupled from external
  stable upsert keys (`PoolMangaId`, `PoolChapterId`).
- Dual-role Creators (`author` + `artist`) deduplicate to ONE canonical Creator
  entity while preserving separate credit rows (`ADR-017`).
- Localized maps (`creator.biography`, `tag.name`) are preserved verbatim (`ADR-007`).
- Missing `chapters` produces `chapters_instruction = None` (metadata-only, `ADR-012`).
- Deterministic chapter order by `(chapter_numeric, language, pool_chapter_id)` (`ADR-013`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from manga_reader.common.clock import ensure_utc
from manga_reader.common.identities import (
    ChapterId,
    CreatorId,
    MangaId,
    MediaObjectRef,
    PageUid,
    PoolChapterId,
    PoolMangaId,
    SourceChapterId,
    SourceMangaId,
)
from manga_reader.modules.etl_cdc.contracts.dto import (
    ContentRating,
    CreatorRole,
    MangaReaderPackageV2Dto,
    PublicationDemographic,
    PublicationStatus,
    ReaderMediaRefDto,
    TagGroup,
)


class IdentityResolver(Protocol):
    """Port looking up existing internal UUIDs from external stable pool IDs."""

    def find_manga_id(self, pool_manga_id: PoolMangaId) -> MangaId | None: ...
    def find_chapter_id(self, pool_chapter_id: PoolChapterId) -> ChapterId | None: ...


class EphemeralIdentityResolver:
    """Stateless resolver generating fresh internal UUIDs (used for dry-runs & tests)."""

    def __init__(
        self,
        *,
        existing_mangas: dict[PoolMangaId, MangaId] | None = None,
        existing_chapters: dict[PoolChapterId, ChapterId] | None = None,
    ) -> None:
        self._mangas = existing_mangas or {}
        self._chapters = existing_chapters or {}

    def find_manga_id(self, pool_manga_id: PoolMangaId) -> MangaId | None:
        return self._mangas.get(pool_manga_id)

    def find_chapter_id(self, pool_chapter_id: PoolChapterId) -> ChapterId | None:
        return self._chapters.get(pool_chapter_id)


@dataclass(frozen=True, slots=True)
class MappedMediaAsset:
    ref: MediaObjectRef
    content_type: str | None
    width: int | None
    height: int | None
    file_size: int
    md5_hash: str | None
    sha256: str | None


@dataclass(frozen=True, slots=True)
class MappedCreatorEntity:
    creator_id: CreatorId
    slug: str
    name: str
    mangadex_id: str | None
    biographies_by_locale: dict[str, str]
    links_by_platform: dict[str, str]


@dataclass(frozen=True, slots=True)
class MappedCreatorCredit:
    creator_id: CreatorId
    role: CreatorRole


@dataclass(frozen=True, slots=True)
class MappedTagEntity:
    slug: str
    source_tag_id: str | None
    mangadex_id: str | None
    group: TagGroup
    names_by_locale: dict[str, str]


@dataclass(frozen=True, slots=True)
class MappedPageEntity:
    page_uid: PageUid
    page_number: int
    filename: str
    media: MappedMediaAsset


@dataclass(frozen=True, slots=True)
class MappedChapterEntity:
    chapter_id: ChapterId
    manga_id: MangaId
    pool_chapter_id: PoolChapterId
    source_chapter_id: SourceChapterId
    chapter_number: str
    chapter_numeric: float
    volume: str | None
    title: str
    language: str
    scanlation_group: str | None
    publish_at_utc: datetime | None
    source: str
    source_id: str | None
    page_count: int
    total_size_bytes: int
    pages_revision: int
    manifest_sha256: str
    updated_at_utc: datetime | None
    pages: tuple[MappedPageEntity, ...]


@dataclass(frozen=True, slots=True)
class MappedMangaImportPlan:
    """Normalized internal import command decoupled from raw transport JSON."""

    manga_id: MangaId
    is_new_manga: bool
    pool_manga_id: PoolMangaId
    source_manga_id: SourceMangaId
    slug: str
    mangadex_id: str | None
    title: str
    alt_titles: tuple[str, ...]
    description: str
    publication_status: PublicationStatus
    content_rating: ContentRating
    publication_demographic: PublicationDemographic
    original_language: str | None
    year: int | None
    official_volumes: int | None
    official_chapters: int | None
    primary_cover: MappedMediaAsset | None
    creators: tuple[MappedCreatorEntity, ...]
    creator_credits: tuple[MappedCreatorCredit, ...]
    tags: tuple[MappedTagEntity, ...]
    exported_at_utc: datetime
    # None strictly denotes metadata-only update (ADR-012): do NOT mutate chapters!
    chapters: tuple[MappedChapterEntity, ...] | None


def _map_media(dto: ReaderMediaRefDto) -> MappedMediaAsset:
    return MappedMediaAsset(
        ref=MediaObjectRef(bucket=dto.bucket, object_key=dto.object_key),
        content_type=dto.content_type,
        width=dto.width,
        height=dto.height,
        file_size=dto.file_size,
        md5_hash=dto.md5_hash,
        sha256=dto.sha256,
    )


def map_package_to_import_plan(
    dto: MangaReaderPackageV2Dto,
    *,
    resolver: IdentityResolver,
) -> MappedMangaImportPlan:
    """Map validated `MangaReaderPackageV2Dto` into internal identities and entities."""
    pool_manga_id = PoolMangaId(dto.manga.pool_manga_id)
    existing_manga_id = resolver.find_manga_id(pool_manga_id)
    manga_id = existing_manga_id if existing_manga_id is not None else MangaId(uuid4())

    # Deduplicate Creators by canonical creator_id while preserving all role credits (ADR-017)
    creators_by_id: dict[CreatorId, MappedCreatorEntity] = {}
    credits: list[MappedCreatorCredit] = []
    seen_credits: set[tuple[CreatorId, CreatorRole]] = set()
    for creator in dto.manga.creators:
        cid = CreatorId(creator.creator_id)
        if cid not in creators_by_id:
            creators_by_id[cid] = MappedCreatorEntity(
                creator_id=cid,
                slug=creator.slug,
                name=creator.name,
                mangadex_id=creator.mangadex_id,
                biographies_by_locale=dict(creator.biography),
                links_by_platform=dict(creator.links),
            )
        credit_key = (cid, creator.role)
        if credit_key not in seen_credits:
            seen_credits.add(credit_key)
            credits.append(MappedCreatorCredit(creator_id=cid, role=creator.role))

    tags = tuple(
        MappedTagEntity(
            slug=tag.slug,
            source_tag_id=tag.source_tag_id,
            mangadex_id=tag.mangadex_id,
            group=tag.group,
            names_by_locale=dict(tag.name),
        )
        for tag in dto.manga.tags
    )

    mapped_chapters: tuple[MappedChapterEntity, ...] | None = None
    if dto.chapters is not None:
        # Canonical deterministic order per ADR-013: (chapter_numeric, language, pool_chapter_id)
        ordered_chapters = sorted(
            dto.chapters,
            key=lambda ch: (ch.chapter_numeric, ch.language.lower(), ch.pool_chapter_id),
        )
        chapter_items: list[MappedChapterEntity] = []
        for ch in ordered_chapters:
            pool_ch_id = PoolChapterId(ch.pool_chapter_id)
            existing_ch_id = resolver.find_chapter_id(pool_ch_id)
            chapter_id = (
                existing_ch_id if existing_ch_id is not None else ChapterId(UUID(int=uuid4().int))
            )
            pages = tuple(
                MappedPageEntity(
                    page_uid=PageUid(p.page_uid),
                    page_number=p.page_number,
                    filename=p.filename,
                    media=_map_media(p.media),
                )
                for p in sorted(ch.pages, key=lambda p: p.page_number)
            )
            chapter_items.append(
                MappedChapterEntity(
                    chapter_id=chapter_id,
                    manga_id=manga_id,
                    pool_chapter_id=pool_ch_id,
                    source_chapter_id=SourceChapterId(ch.source_chapter_id),
                    chapter_number=ch.chapter_number,
                    chapter_numeric=ch.chapter_numeric,
                    volume=ch.volume,
                    title=ch.title,
                    language=ch.language.lower(),
                    scanlation_group=ch.scanlation_group,
                    publish_at_utc=ensure_utc(ch.publish_at) if ch.publish_at else None,
                    source=ch.source,
                    source_id=ch.source_id,
                    page_count=ch.page_count,
                    total_size_bytes=ch.total_size_bytes,
                    pages_revision=ch.pages_revision,
                    manifest_sha256=ch.manifest_sha256,
                    updated_at_utc=ensure_utc(ch.updated_at) if ch.updated_at else None,
                    pages=pages,
                )
            )
        mapped_chapters = tuple(chapter_items)

    return MappedMangaImportPlan(
        manga_id=manga_id,
        is_new_manga=existing_manga_id is None,
        pool_manga_id=pool_manga_id,
        source_manga_id=SourceMangaId(dto.manga.source_manga_id),
        slug=dto.manga.slug,
        mangadex_id=dto.manga.mangadex_id,
        title=dto.manga.title,
        alt_titles=tuple(dto.manga.alt_titles),
        description=dto.manga.description,
        publication_status=dto.manga.status,
        content_rating=dto.manga.content_rating,
        publication_demographic=dto.manga.publication_demographic,
        original_language=dto.manga.original_language,
        year=dto.manga.year,
        official_volumes=dto.manga.official_volumes,
        official_chapters=dto.manga.official_chapters,
        primary_cover=_map_media(dto.manga.primary_cover) if dto.manga.primary_cover else None,
        creators=tuple(creators_by_id.values()),
        creator_credits=tuple(credits),
        tags=tags,
        exported_at_utc=ensure_utc(dto.exported_at),
        chapters=mapped_chapters,
    )
