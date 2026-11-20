"""Typed Pydantic v2 DTOs for `manga-reader-package:2.0`.

Strictly separated from persistence/ORM entities (`extra='forbid'` mirrors
JSON Schema `additionalProperties: false` so undocumented fields fail closed).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PublicationStatus(StrEnum):
    ONGOING = "ongoing"
    COMPLETED = "completed"
    HIATUS = "hiatus"
    CANCELLED = "cancelled"
    UNKNOWN = "unknown"


class ContentRating(StrEnum):
    SAFE = "safe"
    SUGGESTIVE = "suggestive"
    EROTICA = "erotica"
    PORNOGRAPHIC = "pornographic"
    UNKNOWN = "unknown"

    @property
    def is_safe(self) -> bool:
        """Canonical rule: `unknown` is NEVER treated as safe."""
        return self == ContentRating.SAFE


class PublicationDemographic(StrEnum):
    SHOUNEN = "shounen"
    SHOUJO = "shoujo"
    SEINEN = "seinen"
    JOSEI = "josei"
    KODOMO = "kodomo"
    UNKNOWN = "unknown"


class CreatorRole(StrEnum):
    AUTHOR = "author"
    ARTIST = "artist"


class TagGroup(StrEnum):
    GENRE = "genre"
    THEME = "theme"
    FORMAT = "format"
    CONTENT = "content"
    OTHER = "other"


class _ClosedContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ReaderMediaRefDto(_ClosedContractModel):
    """Canonical external media locator (`bucket + object_key`, never URL)."""

    bucket: str = Field(min_length=1, max_length=63)
    object_key: str = Field(min_length=1)
    content_type: str | None = None
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)
    file_size: int = Field(default=0, ge=0)
    md5_hash: str | None = None
    sha256: str | None = None


class ReaderCreatorDto(_ClosedContractModel):
    creator_id: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1)
    role: CreatorRole
    mangadex_id: str | None = Field(default=None, max_length=64)
    biography: dict[str, str] = Field(default_factory=dict)
    links: dict[str, str] = Field(default_factory=dict)


class ReaderTagDto(_ClosedContractModel):
    slug: str = Field(min_length=1, max_length=120)
    source_tag_id: str | None = Field(default=None, max_length=100)
    mangadex_id: str | None = Field(default=None, max_length=64)
    group: TagGroup = TagGroup.GENRE
    name: dict[str, str]


class ReaderCoverArtDto(_ClosedContractModel):
    cover_id: str | None = Field(default=None, max_length=100)
    volume: str | None = None
    locale: str | None = Field(default=None, max_length=16)
    description: str | None = None
    media: ReaderMediaRefDto


class ReaderLinkDto(_ClosedContractModel):
    site: str = Field(min_length=1)
    url: str = Field(min_length=1)


class ReaderLineageDto(_ClosedContractModel):
    pool_revision: int = Field(default=1, ge=1)
    source_metadata_revision: int = Field(default=1, ge=1)
    manifest_sha256: str = ""
    published_at: datetime | None = None
    updated_at: datetime | None = None


class ReaderMangaStatsDto(_ClosedContractModel):
    chapter_count: int = Field(default=0, ge=0)
    page_count: int = Field(default=0, ge=0)
    total_size_bytes: int = Field(default=0, ge=0)
    languages: list[str] = Field(default_factory=list)


class ReaderPageDto(_ClosedContractModel):
    page_uid: str = Field(min_length=1, max_length=120)
    page_number: int = Field(ge=1)
    filename: str = Field(min_length=1)
    media: ReaderMediaRefDto


class ReaderChapterDto(_ClosedContractModel):
    pool_chapter_id: str = Field(min_length=1, max_length=100)
    pool_manga_id: str = Field(min_length=1, max_length=80)
    source_chapter_id: str = Field(min_length=1, max_length=255)
    chapter_number: str = Field(min_length=1)
    chapter_numeric: float = 0.0
    volume: str | None = None
    title: str = ""
    language: str = Field(default="en", min_length=1, max_length=16)
    scanlation_group: str | None = None
    publish_at: datetime | None = None
    source: str = "mangadex"
    source_id: str | None = None
    page_count: int = Field(default=0, ge=0)
    total_size_bytes: int = Field(default=0, ge=0)
    pages_revision: int = Field(default=1, ge=1)
    manifest_sha256: str = ""
    updated_at: datetime | None = None
    pages: list[ReaderPageDto] = Field(default_factory=list)


class ReaderMangaDto(_ClosedContractModel):
    pool_manga_id: str = Field(min_length=1, max_length=80)
    slug: str = Field(min_length=1, max_length=255)
    source_manga_id: str = Field(min_length=1, max_length=255)
    mangadex_id: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1)
    alt_titles: list[str] = Field(default_factory=list)
    description: str = ""
    status: PublicationStatus = PublicationStatus.UNKNOWN
    content_rating: ContentRating = ContentRating.UNKNOWN
    publication_demographic: PublicationDemographic = PublicationDemographic.UNKNOWN
    original_language: str | None = Field(default=None, max_length=16)
    year: int | None = Field(default=None, ge=1800, le=2200)
    published_start_date: str | None = None
    published_end_date: str | None = None
    official_volumes: int | None = Field(default=None, ge=0)
    official_chapters: int | None = Field(default=None, ge=0)
    creators: list[ReaderCreatorDto] = Field(default_factory=list)
    tags: list[ReaderTagDto] = Field(default_factory=list)
    links: list[ReaderLinkDto] = Field(default_factory=list)
    primary_cover: ReaderMediaRefDto | None = None
    cover_arts: list[ReaderCoverArtDto] = Field(default_factory=list)
    stats: ReaderMangaStatsDto | None = None
    lineage: ReaderLineageDto | None = None


class MangaReaderPackageV2Dto(_ClosedContractModel):
    contract_name: Literal["manga-reader-package"] = "manga-reader-package"
    contract_version: Literal["2.0"] = "2.0"
    exported_at: datetime
    manga: ReaderMangaDto
    chapters: list[ReaderChapterDto] | None = None

    @property
    def is_metadata_only(self) -> bool:
        """ADR-012: Omitted `chapters` means metadata-only update, NEVER delete chapters."""
        return self.chapters is None
