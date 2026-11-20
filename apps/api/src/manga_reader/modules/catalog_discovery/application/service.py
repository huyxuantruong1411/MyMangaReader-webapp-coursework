"""Phase 5: Public Catalog, Advanced Filtering, Search, Autocomplete & Creator Pages."""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any
from uuid import UUID

from sqlalchemy import asc, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339
from manga_reader.common.errors import ResourceNotFoundError, ValidationAppError
from manga_reader.common.identities import MediaObjectRef
from manga_reader.common.security import SecurityPrincipal
from manga_reader.common.text import normalize_search_text
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    ChapterModel,
    CreatorBiographyModel,
    CreatorLinkModel,
    CreatorModel,
    MangaAltTitleModel,
    MangaCoverArtModel,
    MangaCreatorModel,
    MangaLinkModel,
    MangaModel,
    MangaStatsLanguageModel,
    MangaStatsModel,
    MangaTagModel,
    MediaObjectModel,
    RatingModel,
    ReaderProgressModel,
    ReadingHistoryModel,
    ReadingStatusRecordModel,
    TagModel,
    TagNameModel,
)

VALID_SORTS = frozenset({"UPDATED_DESC", "VIEWS_DESC", "RATING_DESC", "TITLE_ASC"})
VALID_STATUSES = frozenset({"ongoing", "completed", "hiatus", "cancelled", "unknown"})
VALID_DEMOGRAPHICS = frozenset({"shounen", "shoujo", "seinen", "josei", "kodomo", "unknown"})
VALID_CONTENT_RATINGS = frozenset({"safe", "suggestive", "erotica", "pornographic", "unknown"})


class CatalogDiscoveryService:
    """Application service for Module 3 (`catalog_discovery`).

    Central invariant: EVERY public query predicates `visibility_status == 'PUBLIC'`
    and `deletion_status == 'ACTIVE'`. `content_rating='unknown'` is NEVER safe.
    """

    def __init__(self, container: AppContainer) -> None:
        self._container = container

    def _sign_media(self, media: MediaObjectModel | None) -> str | None:
        if media is None:
            return None
        ref = MediaObjectRef(bucket=media.bucket, object_key=media.object_key)
        return self._container.media_signer.build_signed_proxy_url(ref)

    async def _resolve_public_manga(
        self, session: AsyncSession, manga_id_or_slug: str
    ) -> MangaModel:
        manga: MangaModel | None = None
        try:
            parsed_uuid = UUID(manga_id_or_slug)
            manga = await session.scalar(
                select(MangaModel).where(
                    MangaModel.manga_id == parsed_uuid,
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
        except ValueError:
            manga = await session.scalar(
                select(MangaModel).where(
                    MangaModel.slug == manga_id_or_slug,
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
        if manga is None:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")
        return manga

    async def build_manga_cards(
        self, session: AsyncSession, mangas: list[MangaModel]
    ) -> list[dict[str, Any]]:
        if not mangas:
            return []
        manga_ids = [m.manga_id for m in mangas]
        cover_ids = [
            m.primary_cover_media_id for m in mangas if m.primary_cover_media_id is not None
        ]

        media_map: dict[int, MediaObjectModel] = {}
        if cover_ids:
            media_rows = (
                await session.scalars(
                    select(MediaObjectModel).where(MediaObjectModel.media_id.in_(cover_ids))
                )
            ).all()
            media_map = {row.media_id: row for row in media_rows}

        # Batch load tags
        tag_rows = (
            await session.execute(
                select(MangaTagModel.manga_id, TagModel.slug, TagModel.name, TagModel.tag_group)
                .join(TagModel, TagModel.tag_id == MangaTagModel.tag_id)
                .where(MangaTagModel.manga_id.in_(manga_ids))
            )
        ).all()
        tags_by_manga: dict[UUID, list[dict[str, str]]] = {}
        for mid, tslug, tname, tgroup in tag_rows:
            tags_by_manga.setdefault(mid, []).append(
                {"slug": tslug, "name": tname, "group": tgroup}
            )

        # Batch load latest chapter label via canonical numeric ordering
        ch_rows = (
            await session.scalars(
                select(ChapterModel)
                .where(ChapterModel.manga_id.in_(manga_ids))
                .order_by(
                    ChapterModel.manga_id,
                    ChapterModel.chapter_numeric.desc(),
                    ChapterModel.language.asc(),
                    ChapterModel.pool_chapter_id.desc(),
                )
            )
        ).all()
        latest_ch_by_manga: dict[UUID, ChapterModel] = {}
        for ch in ch_rows:
            if ch.manga_id not in latest_ch_by_manga:
                latest_ch_by_manga[ch.manga_id] = ch

        cards: list[dict[str, Any]] = []
        for m in mangas:
            latest = latest_ch_by_manga.get(m.manga_id)
            cards.append(
                {
                    "mangaId": str(m.manga_id),
                    "slug": m.slug,
                    "title": m.title,
                    "coverUrl": self._sign_media(
                        media_map.get(m.primary_cover_media_id)
                        if m.primary_cover_media_id is not None
                        else None
                    ),
                    "publicationStatus": m.publication_status,
                    "contentRating": m.content_rating,
                    "publicationDemographic": m.publication_demographic,
                    "originalLanguage": m.original_language,
                    "year": m.year,
                    "totalViews": m.total_views,
                    "averageRating": float(m.average_rating),
                    "latestChapter": (
                        {
                            "chapterId": str(latest.chapter_id),
                            "chapterNumber": latest.chapter_number,
                            "title": latest.title,
                            "language": latest.language,
                            "publishAt": format_rfc3339(latest.publish_at)
                            if latest.publish_at
                            else None,
                        }
                        if latest
                        else None
                    ),
                    "tags": tags_by_manga.get(m.manga_id, []),
                    "updatedAt": format_rfc3339(m.updated_at),
                }
            )
        return cards

    async def list_tags(self, session: AsyncSession) -> list[dict[str, Any]]:
        tags = (
            await session.scalars(select(TagModel).order_by(TagModel.tag_group, TagModel.name))
        ).all()
        loc_rows = (await session.scalars(select(TagNameModel))).all()
        loc_map: dict[int, dict[str, str]] = {}
        for lr in loc_rows:
            loc_map.setdefault(lr.tag_id, {})[lr.language_code] = lr.tag_name
        return [
            {
                "tagId": t.tag_id,
                "slug": t.slug,
                "group": t.tag_group,
                "name": t.name,
                "localizedNames": loc_map.get(t.tag_id, {"en": t.name}),
            }
            for t in tags
        ]

    async def list_catalog(
        self,
        session: AsyncSession,
        *,
        sort: str = "UPDATED_DESC",
        include_tags: list[str] | None = None,
        exclude_tags: list[str] | None = None,
        tag_mode: str = "GROUP_OR",
        demographic: str | None = None,
        status: str | None = None,
        content_rating: list[str] | None = None,
        language: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        if sort not in VALID_SORTS:
            raise ValidationAppError(f"Invalid sort '{sort}'.", error_code="INVALID_FILTER")
        if status and status not in VALID_STATUSES:
            raise ValidationAppError(f"Invalid status '{status}'.", error_code="INVALID_FILTER")
        if demographic and demographic not in VALID_DEMOGRAPHICS:
            raise ValidationAppError(
                f"Invalid demographic '{demographic}'.", error_code="INVALID_FILTER"
            )

        inc = [t.strip().lower() for t in (include_tags or []) if t.strip()]
        exc = [t.strip().lower() for t in (exclude_tags or []) if t.strip()]
        if set(inc) & set(exc):
            raise ValidationAppError(
                "A tag cannot be both included and excluded.",
                error_code="INVALID_FILTER",
                details={"conflictingTags": sorted(set(inc) & set(exc))},
            )

        ratings_filter: list[str] = []
        for cr in content_rating or []:
            val = cr.strip().lower()
            if val not in VALID_CONTENT_RATINGS:
                raise ValidationAppError(
                    f"Invalid contentRating '{val}'.", error_code="INVALID_FILTER"
                )
            ratings_filter.append(val)

        stmt = select(MangaModel).where(
            MangaModel.visibility_status == "PUBLIC",
            MangaModel.deletion_status == "ACTIVE",
        )

        if status:
            stmt = stmt.where(MangaModel.publication_status == status)
        if demographic:
            stmt = stmt.where(MangaModel.publication_demographic == demographic)
        if language:
            stmt = stmt.where(MangaModel.original_language == language.strip().lower())
        if year_from is not None:
            stmt = stmt.where(MangaModel.year >= year_from)
        if year_to is not None:
            stmt = stmt.where(MangaModel.year <= year_to)
        if ratings_filter:
            # Strict inclusion: `safe` NEVER includes `unknown` (CAT-019)
            stmt = stmt.where(MangaModel.content_rating.in_(ratings_filter))

        # Include tags: OR within same tag_group, AND across groups (or AND across all if tag_mode=AND)
        if inc:
            matched_tags = (
                await session.scalars(select(TagModel).where(TagModel.slug.in_(inc)))
            ).all()
            if not matched_tags:
                return [], 0
            if tag_mode.upper() == "AND":
                for tag_obj in matched_tags:
                    subq = select(MangaTagModel.manga_id).where(
                        MangaTagModel.tag_id == tag_obj.tag_id
                    )
                    stmt = stmt.where(MangaModel.manga_id.in_(subq))
            else:
                groups: dict[str, list[int]] = {}
                for tag_obj in matched_tags:
                    groups.setdefault(tag_obj.tag_group, []).append(tag_obj.tag_id)
                for group_tag_ids in groups.values():
                    subq = select(MangaTagModel.manga_id).where(
                        MangaTagModel.tag_id.in_(group_tag_ids)
                    )
                    stmt = stmt.where(MangaModel.manga_id.in_(subq))

        # Exclude tags: NOT (any excluded tag disqualifies)
        if exc:
            exc_tag_ids = (
                await session.scalars(select(TagModel.tag_id).where(TagModel.slug.in_(exc)))
            ).all()
            if exc_tag_ids:
                exc_subq = select(MangaTagModel.manga_id).where(
                    MangaTagModel.tag_id.in_(exc_tag_ids)
                )
                stmt = stmt.where(~MangaModel.manga_id.in_(exc_subq))

        order_map = {
            "UPDATED_DESC": (
                desc(func.coalesce(MangaModel.latest_chapter_at, MangaModel.updated_at)),
                asc(MangaModel.manga_id),
            ),
            "VIEWS_DESC": (desc(MangaModel.total_views), asc(MangaModel.manga_id)),
            "RATING_DESC": (desc(MangaModel.average_rating), asc(MangaModel.manga_id)),
            "TITLE_ASC": (asc(MangaModel.title), asc(MangaModel.manga_id)),
        }
        order_clauses = order_map[sort]

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = int(await session.scalar(count_stmt) or 0)
        mangas = (
            await session.scalars(
                stmt.order_by(*order_clauses).offset((page - 1) * page_size).limit(page_size)
            )
        ).all()
        return await self.build_manga_cards(session, list(mangas)), total

    async def autocomplete(self, session: AsyncSession, *, q: str) -> list[dict[str, Any]]:
        norm_q = normalize_search_text(q)
        if not norm_q:
            return []

        limit = self._container.settings.autocomplete_max_results
        public_mangas = (
            await session.scalars(
                select(MangaModel).where(
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
        ).all()
        alt_rows = (await session.scalars(select(MangaAltTitleModel))).all()
        alts_by_manga: dict[UUID, list[str]] = {}
        for a in alt_rows:
            alts_by_manga.setdefault(a.manga_id, []).append(a.alternative_title)

        scored: list[tuple[float, dict[str, Any]]] = []
        for m in public_mangas:
            norm_title = normalize_search_text(m.title)
            score = 0.0
            if norm_title == norm_q:
                score = 100.0
            elif norm_title.startswith(norm_q):
                score = 90.0
            elif norm_q in norm_title:
                score = 75.0
            else:
                for alt in alts_by_manga.get(m.manga_id, []):
                    norm_alt = normalize_search_text(alt)
                    if norm_alt.startswith(norm_q):
                        score = max(score, 80.0)
                    elif norm_q in norm_alt:
                        score = max(score, 65.0)
            if score > 0:
                scored.append(
                    (
                        score,
                        {
                            "type": "MANGA",
                            "id": str(m.manga_id),
                            "slug": m.slug,
                            "label": m.title,
                            "sublabel": m.publication_status,
                        },
                    )
                )

        creators = (await session.scalars(select(CreatorModel))).all()
        for c in creators:
            norm_c = normalize_search_text(c.name)
            if norm_c.startswith(norm_q) or norm_q in norm_c:
                c_score = 70.0 if norm_c.startswith(norm_q) else 55.0
                scored.append(
                    (
                        c_score,
                        {
                            "type": "CREATOR",
                            "id": c.creator_id,
                            "slug": c.slug,
                            "label": c.name,
                            "sublabel": "Creator",
                        },
                    )
                )

        scored.sort(key=lambda pair: (-pair[0], pair[1]["label"]))
        return [item for _, item in scored[:limit]]

    async def search_manga(
        self,
        session: AsyncSession,
        *,
        q: str,
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        norm_q = normalize_search_text(q)
        if not norm_q:
            return [], 0

        public_mangas = (
            await session.scalars(
                select(MangaModel).where(
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
        ).all()
        alt_rows = (await session.scalars(select(MangaAltTitleModel))).all()
        alts_by_manga: dict[UUID, list[str]] = {}
        for a in alt_rows:
            alts_by_manga.setdefault(a.manga_id, []).append(a.alternative_title)

        ranked: list[tuple[float, MangaModel]] = []
        for m in public_mangas:
            candidates = [m.title, *alts_by_manga.get(m.manga_id, [])]
            best = 0.0
            for idx, cand in enumerate(candidates):
                norm_c = normalize_search_text(cand)
                bonus = 5.0 if idx == 0 else 0.0
                if norm_c == norm_q:
                    best = max(best, 100.0 + bonus)
                elif norm_c.startswith(norm_q):
                    best = max(best, 85.0 + bonus)
                elif norm_q in norm_c:
                    best = max(best, 70.0 + bonus)
                else:
                    # Fuzzy typo tolerance across words or full string (CAT-009)
                    ratio = SequenceMatcher(None, norm_q, norm_c).ratio()
                    word_best = max(
                        (SequenceMatcher(None, norm_q, w).ratio() for w in norm_c.split()),
                        default=0.0,
                    )
                    fuzzy = max(ratio, word_best)
                    if fuzzy >= 0.72:
                        best = max(best, fuzzy * 60.0 + bonus)
            if best > 0:
                ranked.append((best, m))

        ranked.sort(key=lambda pair: (-pair[0], -pair[1].total_views, str(pair[1].manga_id)))
        total = len(ranked)
        start = (page - 1) * page_size
        page_mangas = [m for _, m in ranked[start : start + page_size]]
        return await self.build_manga_cards(session, page_mangas), total

    async def search_creators(
        self,
        session: AsyncSession,
        *,
        q: str,
        role: str | None = None,
    ) -> list[dict[str, Any]]:
        norm_q = normalize_search_text(q)
        if not norm_q:
            return []
        if role and role not in ("author", "artist"):
            raise ValidationAppError(
                "role must be 'author' or 'artist'.", error_code="INVALID_FILTER"
            )

        creators = (await session.scalars(select(CreatorModel))).all()
        matched = [c for c in creators if norm_q in normalize_search_text(c.name)]
        if not matched:
            return []

        c_ids = [c.creator_id for c in matched]
        credit_stmt = (
            select(MangaCreatorModel.creator_id, MangaCreatorModel.role, MangaModel.manga_id)
            .join(MangaModel, MangaModel.manga_id == MangaCreatorModel.manga_id)
            .where(
                MangaCreatorModel.creator_id.in_(c_ids),
                MangaModel.visibility_status == "PUBLIC",
                MangaModel.deletion_status == "ACTIVE",
            )
        )
        if role:
            credit_stmt = credit_stmt.where(MangaCreatorModel.role == role)
        credit_rows = (await session.execute(credit_stmt)).all()

        roles_by_creator: dict[str, set[str]] = {}
        works_by_creator: dict[str, set[UUID]] = {}
        for cid, r, mid in credit_rows:
            roles_by_creator.setdefault(cid, set()).add(r)
            works_by_creator.setdefault(cid, set()).add(mid)

        results: list[dict[str, Any]] = []
        for c in matched:
            if role and c.creator_id not in roles_by_creator:
                continue
            results.append(
                {
                    "creatorId": c.creator_id,
                    "slug": c.slug,
                    "name": c.name,
                    "roles": sorted(roles_by_creator.get(c.creator_id, set())),
                    "publicWorkCount": len(works_by_creator.get(c.creator_id, set())),
                }
            )
        results.sort(key=lambda item: (-item["publicWorkCount"], item["name"]))
        return results

    async def get_manga_detail(
        self,
        session: AsyncSession,
        *,
        manga_id_or_slug: str,
        viewer: SecurityPrincipal,
    ) -> dict[str, Any]:
        manga = await self._resolve_public_manga(session, manga_id_or_slug)
        primary_cover = (
            await session.get(MediaObjectModel, manga.primary_cover_media_id)
            if manga.primary_cover_media_id is not None
            else None
        )
        alt_titles = (
            await session.scalars(
                select(MangaAltTitleModel.alternative_title)
                .where(MangaAltTitleModel.manga_id == manga.manga_id)
                .order_by(MangaAltTitleModel.display_order.asc())
            )
        ).all()

        # Deduplicate dual-role creator cards cleanly while returning all roles (ADR-017)
        cr_rows = (
            await session.execute(
                select(CreatorModel, MangaCreatorModel.role)
                .join(MangaCreatorModel, MangaCreatorModel.creator_id == CreatorModel.creator_id)
                .where(MangaCreatorModel.manga_id == manga.manga_id)
            )
        ).all()
        creators_map: dict[str, dict[str, Any]] = {}
        for creator_obj, role in cr_rows:
            entry = creators_map.setdefault(
                creator_obj.creator_id,
                {
                    "creatorId": creator_obj.creator_id,
                    "slug": creator_obj.slug,
                    "name": creator_obj.name,
                    "roles": [],
                },
            )
            if role not in entry["roles"]:
                entry["roles"].append(role)

        tag_rows = (
            await session.execute(
                select(TagModel)
                .join(MangaTagModel, MangaTagModel.tag_id == TagModel.tag_id)
                .where(MangaTagModel.manga_id == manga.manga_id)
                .order_by(TagModel.tag_group, TagModel.name)
            )
        ).all()
        links = (
            await session.scalars(
                select(MangaLinkModel).where(MangaLinkModel.manga_id == manga.manga_id)
            )
        ).all()
        cover_rows = (
            await session.execute(
                select(MangaCoverArtModel, MediaObjectModel)
                .join(MediaObjectModel, MediaObjectModel.media_id == MangaCoverArtModel.media_id)
                .where(MangaCoverArtModel.manga_id == manga.manga_id)
            )
        ).all()
        stats = await session.get(MangaStatsModel, manga.manga_id)
        stat_langs = (
            await session.scalars(
                select(MangaStatsLanguageModel.language_code)
                .where(MangaStatsLanguageModel.manga_id == manga.manga_id)
                .order_by(MangaStatsLanguageModel.language_code.asc())
            )
        ).all()
        rating_count = int(
            await session.scalar(
                select(func.count())
                .select_from(RatingModel)
                .where(RatingModel.manga_id == manga.manga_id, RatingModel.is_removed.is_(False))
            )
            or 0
        )

        viewer_state: dict[str, Any] | None = None
        if viewer.is_authenticated and viewer.account_id is not None:
            rs = await session.scalar(
                select(ReadingStatusRecordModel).where(
                    ReadingStatusRecordModel.reader_account_id == viewer.account_id,
                    ReadingStatusRecordModel.manga_id == manga.manga_id,
                )
            )
            prog = await session.get(ReaderProgressModel, (viewer.account_id, manga.manga_id))
            rating = await session.scalar(
                select(RatingModel).where(
                    RatingModel.reader_account_id == viewer.account_id,
                    RatingModel.manga_id == manga.manga_id,
                    RatingModel.is_removed.is_(False),
                )
            )
            has_opened = (
                await session.scalar(
                    select(func.count())
                    .select_from(ReadingHistoryModel)
                    .join(ChapterModel, ChapterModel.chapter_id == ReadingHistoryModel.chapter_id)
                    .where(
                        ReadingHistoryModel.reader_account_id == viewer.account_id,
                        ChapterModel.manga_id == manga.manga_id,
                    )
                )
                or 0
            ) > 0
            viewer_state = {
                "readingStatus": rs.status if rs else None,
                "progress": (
                    {
                        "chapterId": str(prog.chapter_id),
                        "pageNumber": prog.page_number,
                        "pageUid": prog.page_uid,
                        "updatedAt": format_rfc3339(prog.updated_at),
                    }
                    if prog
                    else None
                ),
                "myRating": rating.score if rating else None,
                "canRate": has_opened,
            }

        return {
            "mangaId": str(manga.manga_id),
            "slug": manga.slug,
            "title": manga.title,
            "altTitles": list(alt_titles),
            "description": manga.description,
            "publicationStatus": manga.publication_status,
            "contentRating": manga.content_rating,
            "publicationDemographic": manga.publication_demographic,
            "originalLanguage": manga.original_language,
            "year": manga.year,
            "publishedStartDate": manga.published_start_date,
            "publishedEndDate": manga.published_end_date,
            "officialVolumes": manga.official_volumes,
            "officialChapters": manga.official_chapters,
            "coverUrl": self._sign_media(primary_cover),
            "coverArts": [
                {
                    "coverId": ca.cover_id,
                    "volume": ca.volume,
                    "locale": ca.locale,
                    "description": ca.description,
                    "url": self._sign_media(mo),
                }
                for ca, mo in cover_rows
            ],
            "creators": list(creators_map.values()),
            "tags": [{"slug": t.slug, "name": t.name, "group": t.tag_group} for (t,) in tag_rows],
            "links": [{"site": lnk.site, "url": lnk.url} for lnk in links],
            "stats": {
                "exportedChapterCount": stats.chapter_count if stats else 0,
                "exportedPageCount": stats.page_count if stats else 0,
                "totalSizeBytes": stats.total_size_bytes if stats else 0,
                "languages": list(stat_langs),
            },
            "totalViews": manga.total_views,
            "averageRating": float(manga.average_rating),
            "ratingCount": rating_count,
            "updatedAt": format_rfc3339(manga.updated_at),
            "viewerState": viewer_state,
        }

    async def list_manga_chapters(
        self,
        session: AsyncSession,
        *,
        manga_id_or_slug: str,
        language: str | None = None,
        volume: str | None = None,
        order: str = "ASC",
    ) -> list[dict[str, Any]]:
        manga = await self._resolve_public_manga(session, manga_id_or_slug)
        stmt = select(ChapterModel).where(ChapterModel.manga_id == manga.manga_id)
        if language:
            stmt = stmt.where(ChapterModel.language == language.strip().lower())
        if volume is not None and volume != "":
            stmt = stmt.where(ChapterModel.volume == volume)

        # Canonical deterministic sort (ADR-013): chapter_numeric, language, pool_chapter_id
        if order.upper() == "DESC":
            stmt = stmt.order_by(
                ChapterModel.chapter_numeric.desc(),
                ChapterModel.language.desc(),
                ChapterModel.pool_chapter_id.desc(),
            )
        else:
            stmt = stmt.order_by(
                ChapterModel.chapter_numeric.asc(),
                ChapterModel.language.asc(),
                ChapterModel.pool_chapter_id.asc(),
            )

        chapters = (await session.scalars(stmt)).all()
        return [
            {
                "chapterId": str(ch.chapter_id),
                "mangaId": str(ch.manga_id),
                "chapterNumber": ch.chapter_number,
                "chapterNumeric": float(ch.chapter_numeric),
                "volume": ch.volume,
                "title": ch.title,
                "language": ch.language,
                "scanlationGroup": ch.scanlation_group,
                "pageCount": ch.page_count,
                "pagesRevision": ch.pages_revision,
                "viewCount": ch.view_count,
                "publishAt": format_rfc3339(ch.publish_at) if ch.publish_at else None,
            }
            for ch in chapters
        ]

    async def get_creator_detail(self, session: AsyncSession, creator_id: str) -> dict[str, Any]:
        creator = await session.get(CreatorModel, creator_id)
        if creator is None:
            raise ResourceNotFoundError("Creator not found.")
        bios = (
            await session.scalars(
                select(CreatorBiographyModel).where(CreatorBiographyModel.creator_id == creator_id)
            )
        ).all()
        links = (
            await session.scalars(
                select(CreatorLinkModel).where(CreatorLinkModel.creator_id == creator_id)
            )
        ).all()
        bio_map = {b.language_code: b.biography for b in bios}
        return {
            "creatorId": creator.creator_id,
            "slug": creator.slug,
            "name": creator.name,
            "biography": bio_map.get("en") or creator.biography,
            "localizedBiographies": bio_map,
            "links": {lnk.platform: lnk.url for lnk in links},
        }

    async def list_creator_manga(
        self,
        session: AsyncSession,
        *,
        creator_id: str,
        tag: str | None = None,
        status: str | None = None,
        sort: str = "UPDATED_DESC",
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        creator = await session.get(CreatorModel, creator_id)
        if creator is None:
            raise ResourceNotFoundError("Creator not found.")

        credit_rows = (
            await session.execute(
                select(MangaCreatorModel.manga_id, MangaCreatorModel.role).where(
                    MangaCreatorModel.creator_id == creator_id
                )
            )
        ).all()
        roles_by_manga: dict[UUID, list[str]] = {}
        for mid, role in credit_rows:
            roles_by_manga.setdefault(mid, [])
            if role not in roles_by_manga[mid]:
                roles_by_manga[mid].append(role)

        if not roles_by_manga:
            return [], 0

        stmt = select(MangaModel).where(
            MangaModel.manga_id.in_(list(roles_by_manga.keys())),
            MangaModel.visibility_status == "PUBLIC",
            MangaModel.deletion_status == "ACTIVE",
        )
        if status:
            stmt = stmt.where(MangaModel.publication_status == status)
        if tag:
            tag_subq = (
                select(MangaTagModel.manga_id)
                .join(TagModel, TagModel.tag_id == MangaTagModel.tag_id)
                .where(TagModel.slug == tag.strip().lower())
            )
            stmt = stmt.where(MangaModel.manga_id.in_(tag_subq))

        order_map = {
            "UPDATED_DESC": (desc(MangaModel.updated_at), asc(MangaModel.manga_id)),
            "VIEWS_DESC": (desc(MangaModel.total_views), asc(MangaModel.manga_id)),
            "RATING_DESC": (desc(MangaModel.average_rating), asc(MangaModel.manga_id)),
            "TITLE_ASC": (asc(MangaModel.title), asc(MangaModel.manga_id)),
        }
        order_clauses = order_map.get(sort, order_map["UPDATED_DESC"])
        total = int(await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
        mangas = (
            await session.scalars(
                stmt.order_by(*order_clauses).offset((page - 1) * page_size).limit(page_size)
            )
        ).all()

        cards = await self.build_manga_cards(session, list(mangas))
        for card in cards:
            card["creatorRoles"] = sorted(roles_by_manga.get(UUID(card["mangaId"]), []))
        return cards, total
