"""Phase 5: Public Catalog, Advanced Filtering, Search, Autocomplete & Creator Pages."""

from __future__ import annotations

from datetime import timedelta
from difflib import SequenceMatcher
from typing import Any
from uuid import UUID

from sqlalchemy import asc, desc, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
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
    ListItemModel,
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
    ReadingListModel,
    ReadingStatusRecordModel,
    TagModel,
    TagNameModel,
)

VALID_SORTS = frozenset(
    {
        "UPDATED_DESC",
        "VIEWS_DESC",
        "RATING_DESC",
        "TITLE_ASC",
        "TITLE_DESC",
        "CREATED_DESC",
        "YEAR_DESC",
        "YEAR_ASC",
        "CHAPTERS_DESC",
        "RELEVANCE",
    }
)
VALID_TAG_MODES = frozenset({"GROUP_OR", "ALL_AND", "AND", "ANY_OR", "OR"})
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

        # Batch load latest chapter label via window function (avoids scanning thousands of chapters)
        rn_col = (
            func.row_number()
            .over(
                partition_by=ChapterModel.manga_id,
                order_by=(
                    ChapterModel.chapter_numeric.desc(),
                    ChapterModel.language.asc(),
                    ChapterModel.pool_chapter_id.desc(),
                ),
            )
            .label("rn")
        )
        latest_subq = (
            select(ChapterModel.chapter_id, rn_col)
            .where(ChapterModel.manga_id.in_(manga_ids))
            .subquery()
        )
        ch_rows = (
            await session.scalars(
                select(ChapterModel).join(
                    latest_subq,
                    (latest_subq.c.chapter_id == ChapterModel.chapter_id) & (latest_subq.c.rn == 1),
                )
            )
        ).all()
        latest_ch_by_manga: dict[UUID, ChapterModel] = {}
        langs_by_manga: dict[UUID, set[str]] = {}
        for ch in ch_rows:
            if ch.manga_id not in latest_ch_by_manga:
                latest_ch_by_manga[ch.manga_id] = ch
            if ch.language:
                langs_by_manga.setdefault(ch.manga_id, set()).add(ch.language)

        # Batch load exported chapter stats and materialized language rows
        stats_rows = (
            await session.scalars(
                select(MangaStatsModel).where(MangaStatsModel.manga_id.in_(manga_ids))
            )
        ).all()
        stats_by_manga = {s.manga_id: s for s in stats_rows}

        stat_lang_rows = (
            await session.execute(
                select(
                    MangaStatsLanguageModel.manga_id, MangaStatsLanguageModel.language_code
                ).where(MangaStatsLanguageModel.manga_id.in_(manga_ids))
            )
        ).all()
        for mid, lang_code in stat_lang_rows:
            if lang_code:
                langs_by_manga.setdefault(mid, set()).add(lang_code)

        # Batch load deduplicated creators for horizontal/list cards
        creator_rows = (
            await session.execute(
                select(MangaCreatorModel.manga_id, CreatorModel, MangaCreatorModel.role)
                .join(CreatorModel, CreatorModel.creator_id == MangaCreatorModel.creator_id)
                .where(MangaCreatorModel.manga_id.in_(manga_ids))
            )
        ).all()
        creators_by_manga: dict[UUID, dict[str, dict[str, Any]]] = {}
        for mid, creator_obj, role in creator_rows:
            m_map = creators_by_manga.setdefault(mid, {})
            entry = m_map.setdefault(
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

        cards: list[dict[str, Any]] = []
        for m in mangas:
            latest = latest_ch_by_manga.get(m.manga_id)
            st = stats_by_manga.get(m.manga_id)
            cards.append(
                {
                    "mangaId": str(m.manga_id),
                    "slug": m.slug,
                    "title": m.title,
                    "description": m.description[:280] if m.description else "",
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
                    "exportedChapterCount": st.chapter_count if st else 0,
                    "chapterLanguages": sorted(langs_by_manga.get(m.manga_id, set())),
                    "creators": list(creators_by_manga.get(m.manga_id, {}).values()),
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

    def _normalize_enum_values(
        self,
        raw: list[str] | str | None,
        valid_set: frozenset[str],
        field_name: str,
    ) -> list[str]:
        if raw is None:
            return []
        parts = raw.split(",") if isinstance(raw, str) else raw
        values: list[str] = []
        for item in parts:
            val = item.strip().lower()
            if not val:
                continue
            if val not in valid_set:
                raise ValidationAppError(
                    f"Invalid {field_name} '{val}'.", error_code="INVALID_FILTER"
                )
            if val not in values:
                values.append(val)
        return values

    def _score_title_match(self, norm_q: str, title: str, alt_titles: list[str]) -> float:
        candidates = [title, *alt_titles]
        best = 0.0
        for idx, cand in enumerate(candidates):
            norm_c = normalize_search_text(cand)
            if not norm_c:
                continue
            bonus = 5.0 if idx == 0 else 0.0
            if norm_c == norm_q:
                best = max(best, 100.0 + bonus)
            elif norm_c.startswith(norm_q):
                best = max(best, 85.0 + bonus)
            elif norm_q in norm_c:
                best = max(best, 70.0 + bonus)
            else:
                ratio = SequenceMatcher(None, norm_q, norm_c).ratio()
                word_best = max(
                    (SequenceMatcher(None, norm_q, w).ratio() for w in norm_c.split()),
                    default=0.0,
                )
                fuzzy = max(ratio, word_best)
                if fuzzy >= 0.72:
                    best = max(best, fuzzy * 60.0 + bonus)
        return best

    async def _is_large_table(
        self, session: AsyncSession, col: Any, *, threshold: int = 500
    ) -> bool:
        subq = select(col).limit(threshold + 1).subquery()
        cnt = int(await session.scalar(select(func.count()).select_from(subq)) or 0)
        return cnt > threshold

    async def _find_matching_creator_ids(
        self, session: AsyncSession, query_or_ids: str
    ) -> list[str]:
        terms = [part.strip() for part in query_or_ids.split(",") if part.strip()]
        if not terms:
            return []
        norm_terms = [normalize_search_text(t) for t in terms if normalize_search_text(t)]
        if await self._is_large_table(session, CreatorModel.creator_id):
            filters = [CreatorModel.creator_id.in_(terms), CreatorModel.slug.in_(terms)]
            for term in terms:
                filters.append(CreatorModel.name.ilike(f"%{term}%"))
            for nterm in norm_terms:
                if nterm not in terms:
                    filters.append(CreatorModel.name.ilike(f"%{nterm}%"))
            creators = (
                await session.scalars(select(CreatorModel).where(or_(*filters)).limit(200))
            ).all()
        else:
            creators = (await session.scalars(select(CreatorModel))).all()
        matched: list[str] = []
        for c in creators:
            if c.creator_id in terms or c.slug in terms:
                matched.append(c.creator_id)
                continue
            norm_name = normalize_search_text(c.name)
            if any(nt in norm_name for nt in norm_terms):
                matched.append(c.creator_id)
        return matched[:200]

    async def list_catalog(
        self,
        session: AsyncSession,
        *,
        q: str | None = None,
        sort: str = "UPDATED_DESC",
        include_tags: list[str] | None = None,
        exclude_tags: list[str] | None = None,
        tag_mode: str = "GROUP_OR",
        demographic: list[str] | str | None = None,
        status: list[str] | str | None = None,
        content_rating: list[str] | None = None,
        language: list[str] | str | None = None,
        chapter_language: list[str] | None = None,
        author: str | None = None,
        artist: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        chapters_min: int | None = None,
        chapters_max: int | None = None,
        rating_min: float | None = None,
        include_unrated: bool = False,
        views_min: int | None = None,
        added_days: int | None = None,
        hide_in_status: bool = False,
        hide_in_lists: bool = False,
        viewer: SecurityPrincipal | None = None,
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        sort_key = sort.strip().upper()
        if sort_key not in VALID_SORTS:
            raise ValidationAppError(f"Invalid sort '{sort}'.", error_code="INVALID_FILTER")

        mode_key = tag_mode.strip().upper()
        if mode_key not in VALID_TAG_MODES:
            raise ValidationAppError(f"Invalid tagMode '{tag_mode}'.", error_code="INVALID_FILTER")

        status_filter = self._normalize_enum_values(status, VALID_STATUSES, "status")
        demo_filter = self._normalize_enum_values(demographic, VALID_DEMOGRAPHICS, "demographic")
        ratings_filter = self._normalize_enum_values(
            content_rating, VALID_CONTENT_RATINGS, "contentRating"
        )

        if year_from is not None and year_to is not None and year_from > year_to:
            raise ValidationAppError("yearFrom cannot exceed yearTo.", error_code="INVALID_FILTER")
        if chapters_min is not None and chapters_min < 0:
            raise ValidationAppError("chaptersMin must be >= 0.", error_code="INVALID_FILTER")
        if chapters_max is not None and chapters_max < 0:
            raise ValidationAppError("chaptersMax must be >= 0.", error_code="INVALID_FILTER")
        if chapters_min is not None and chapters_max is not None and chapters_min > chapters_max:
            raise ValidationAppError(
                "chaptersMin cannot exceed chaptersMax.", error_code="INVALID_FILTER"
            )
        if rating_min is not None and (rating_min < 0 or rating_min > 10):
            raise ValidationAppError(
                "ratingMin must be between 0 and 10.", error_code="INVALID_FILTER"
            )
        if views_min is not None and views_min < 0:
            raise ValidationAppError("viewsMin must be >= 0.", error_code="INVALID_FILTER")
        if added_days is not None and added_days < 1:
            raise ValidationAppError("addedDays must be >= 1.", error_code="INVALID_FILTER")

        inc = [t.strip().lower() for t in (include_tags or []) if t.strip()]
        exc = [t.strip().lower() for t in (exclude_tags or []) if t.strip()]
        if set(inc) & set(exc):
            raise ValidationAppError(
                "A tag cannot be both included and excluded.",
                error_code="INVALID_FILTER",
                details={"conflictingTags": sorted(set(inc) & set(exc))},
            )

        stmt = select(MangaModel).where(
            MangaModel.visibility_status == "PUBLIC",
            MangaModel.deletion_status == "ACTIVE",
        )

        needs_stats_join = (
            chapters_min is not None or chapters_max is not None or sort_key == "CHAPTERS_DESC"
        )
        if needs_stats_join:
            stmt = stmt.outerjoin(MangaStatsModel, MangaStatsModel.manga_id == MangaModel.manga_id)

        if status_filter:
            stmt = stmt.where(MangaModel.publication_status.in_(status_filter))
        if demo_filter:
            stmt = stmt.where(MangaModel.publication_demographic.in_(demo_filter))

        orig_langs = (
            [p.strip().lower() for p in language.split(",") if p.strip()]
            if isinstance(language, str)
            else [p.strip().lower() for p in (language or []) if p.strip()]
        )
        if orig_langs:
            stmt = stmt.where(MangaModel.original_language.in_(orig_langs))

        ch_langs = [p.strip().lower() for p in (chapter_language or []) if p.strip()]
        if ch_langs:
            if await self._is_large_table(session, MangaStatsLanguageModel.manga_id, threshold=0):
                ch_subq = select(MangaStatsLanguageModel.manga_id).where(
                    MangaStatsLanguageModel.language_code.in_(ch_langs)
                )
            else:
                ch_subq = select(ChapterModel.manga_id).where(ChapterModel.language.in_(ch_langs))
            stmt = stmt.where(MangaModel.manga_id.in_(ch_subq))

        if year_from is not None:
            stmt = stmt.where(MangaModel.year >= year_from)
        if year_to is not None:
            stmt = stmt.where(MangaModel.year <= year_to)
        if ratings_filter:
            # Strict inclusion: `safe` NEVER includes `unknown` (CAT-019)
            stmt = stmt.where(MangaModel.content_rating.in_(ratings_filter))

        if chapters_min is not None and chapters_min > 0:
            stmt = stmt.where(MangaStatsModel.chapter_count >= chapters_min)
        if chapters_max is not None:
            if chapters_max == 0:
                stmt = stmt.where(func.coalesce(MangaStatsModel.chapter_count, 0) == 0)
            else:
                stmt = stmt.where(MangaStatsModel.chapter_count <= chapters_max)

        if rating_min is not None and rating_min > 0:
            if include_unrated:
                stmt = stmt.where(
                    (MangaModel.average_rating >= rating_min) | (MangaModel.average_rating == 0)
                )
            else:
                stmt = stmt.where(MangaModel.average_rating >= rating_min)
        if views_min is not None and views_min > 0:
            stmt = stmt.where(MangaModel.total_views >= views_min)
        if added_days is not None:
            cutoff = utc_now() - timedelta(days=added_days)
            stmt = stmt.where(MangaModel.created_at >= cutoff)

        if author and author.strip():
            author_ids = await self._find_matching_creator_ids(session, author)
            if not author_ids:
                return [], 0
            author_subq = select(MangaCreatorModel.manga_id).where(
                MangaCreatorModel.creator_id.in_(author_ids),
                MangaCreatorModel.role == "author",
            )
            stmt = stmt.where(MangaModel.manga_id.in_(author_subq))

        if artist and artist.strip():
            artist_ids = await self._find_matching_creator_ids(session, artist)
            if not artist_ids:
                return [], 0
            artist_subq = select(MangaCreatorModel.manga_id).where(
                MangaCreatorModel.creator_id.in_(artist_ids),
                MangaCreatorModel.role == "artist",
            )
            stmt = stmt.where(MangaModel.manga_id.in_(artist_subq))

        # Include tags:
        # - ALL_AND / AND: every selected tag must exist on the manga (BUG-01 fix)
        # - ANY_OR / OR: any selected tag across any group matches
        # - GROUP_OR (canonical default): OR within same tag_group, AND across different groups
        if inc:
            matched_tags = (
                await session.scalars(select(TagModel).where(TagModel.slug.in_(inc)))
            ).all()
            if not matched_tags:
                return [], 0
            if mode_key in ("AND", "ALL_AND"):
                if len(matched_tags) < len(set(inc)):
                    return [], 0
                for tag_obj in matched_tags:
                    subq = select(MangaTagModel.manga_id).where(
                        MangaTagModel.tag_id == tag_obj.tag_id
                    )
                    stmt = stmt.where(MangaModel.manga_id.in_(subq))
            elif mode_key in ("OR", "ANY_OR"):
                any_subq = select(MangaTagModel.manga_id).where(
                    MangaTagModel.tag_id.in_([t.tag_id for t in matched_tags])
                )
                stmt = stmt.where(MangaModel.manga_id.in_(any_subq))
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

        # Personal exclusion filters (`04_ADVANCED_SEARCH_UX_SPEC.md` §3.15)
        if viewer and viewer.is_authenticated and viewer.account_id is not None:
            if hide_in_status:
                rs_subq = select(ReadingStatusRecordModel.manga_id).where(
                    ReadingStatusRecordModel.reader_account_id == viewer.account_id
                )
                stmt = stmt.where(~MangaModel.manga_id.in_(rs_subq))
            if hide_in_lists:
                list_subq = (
                    select(ListItemModel.manga_id)
                    .join(ReadingListModel, ReadingListModel.list_id == ListItemModel.list_id)
                    .where(ReadingListModel.owner_reader_account_id == viewer.account_id)
                )
                stmt = stmt.where(~MangaModel.manga_id.in_(list_subq))

        effective_sort = (
            "UPDATED_DESC" if (sort_key == "RELEVANCE" and not (q and q.strip())) else sort_key
        )
        order_map: dict[str, tuple[Any, ...]] = {
            "UPDATED_DESC": (
                desc(MangaModel.latest_chapter_at),
                desc(MangaModel.updated_at),
                asc(MangaModel.manga_id),
            ),
            "VIEWS_DESC": (desc(MangaModel.total_views), asc(MangaModel.manga_id)),
            "RATING_DESC": (desc(MangaModel.average_rating), asc(MangaModel.manga_id)),
            "TITLE_ASC": (asc(MangaModel.title), asc(MangaModel.manga_id)),
            "TITLE_DESC": (desc(MangaModel.title), asc(MangaModel.manga_id)),
            "CREATED_DESC": (desc(MangaModel.created_at), asc(MangaModel.manga_id)),
            "YEAR_DESC": (desc(func.coalesce(MangaModel.year, 0)), asc(MangaModel.manga_id)),
            "YEAR_ASC": (asc(func.coalesce(MangaModel.year, 9999)), asc(MangaModel.manga_id)),
            "CHAPTERS_DESC": (
                desc(func.coalesce(MangaStatsModel.chapter_count, 0)),
                asc(MangaModel.manga_id),
            ),
            "RELEVANCE": (
                desc(MangaModel.latest_chapter_at),
                desc(MangaModel.updated_at),
                asc(MangaModel.manga_id),
            ),
        }
        order_clauses = order_map[effective_sort]

        norm_q = normalize_search_text(q) if q else ""
        if norm_q:
            if await self._is_large_table(session, MangaModel.manga_id):
                raw_q = (q or "").strip()
                alt_match_subq = select(MangaAltTitleModel.manga_id).where(
                    or_(
                        MangaAltTitleModel.alternative_title.ilike(f"%{raw_q}%"),
                        MangaAltTitleModel.alternative_title.ilike(f"%{norm_q}%"),
                    )
                )
                slug_q = norm_q.replace(" ", "-")
                q_stmt = stmt.where(
                    or_(
                        MangaModel.title.ilike(f"%{raw_q}%"),
                        MangaModel.title.ilike(f"%{norm_q}%"),
                        MangaModel.slug.ilike(f"%{slug_q}%"),
                        MangaModel.manga_id.in_(alt_match_subq),
                    )
                )
                candidates = (
                    await session.scalars(q_stmt.order_by(*order_clauses).limit(200))
                ).all()
            else:
                candidates = (await session.scalars(stmt.order_by(*order_clauses))).all()
            if not candidates:
                return [], 0
            cand_ids = [m.manga_id for m in candidates]
            alt_rows = (
                await session.scalars(
                    select(MangaAltTitleModel).where(MangaAltTitleModel.manga_id.in_(cand_ids))
                )
            ).all()
            alts_by_manga: dict[UUID, list[str]] = {}
            for a in alt_rows:
                alts_by_manga.setdefault(a.manga_id, []).append(a.alternative_title)

            scored_matches: list[tuple[float, MangaModel]] = []
            for m in candidates:
                score = self._score_title_match(norm_q, m.title, alts_by_manga.get(m.manga_id, []))
                if score > 0:
                    scored_matches.append((score, m))

            if effective_sort == "RELEVANCE":
                scored_matches.sort(
                    key=lambda pair: (-pair[0], -pair[1].total_views, str(pair[1].manga_id))
                )

            total = len(scored_matches)
            start = (page - 1) * page_size
            page_mangas = [m for _, m in scored_matches[start : start + page_size]]
            return await self.build_manga_cards(session, page_mangas), total

        count_stmt = stmt.with_only_columns(func.count(MangaModel.manga_id)).order_by(None)
        total = int(await session.scalar(count_stmt) or 0)
        if total == 0:
            return [], 0
        page_ids = list(
            (
                await session.scalars(
                    stmt.with_only_columns(MangaModel.manga_id)
                    .order_by(*order_clauses)
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            ).all()
        )
        if not page_ids:
            return [], total
        fetched = (
            await session.scalars(select(MangaModel).where(MangaModel.manga_id.in_(page_ids)))
        ).all()
        by_id = {m.manga_id: m for m in fetched}
        ordered_mangas = [by_id[mid] for mid in page_ids if mid in by_id]
        return await self.build_manga_cards(session, ordered_mangas), total

    async def autocomplete(self, session: AsyncSession, *, q: str) -> list[dict[str, Any]]:
        norm_q = normalize_search_text(q)
        if not norm_q:
            return []

        limit = self._container.settings.autocomplete_max_results
        raw_q = q.strip()
        if await self._is_large_table(session, MangaModel.manga_id):
            alt_match_subq = select(MangaAltTitleModel.manga_id).where(
                or_(
                    MangaAltTitleModel.alternative_title.ilike(f"%{raw_q}%"),
                    MangaAltTitleModel.alternative_title.ilike(f"%{norm_q}%"),
                )
            )
            slug_q = norm_q.replace(" ", "-")
            public_mangas = (
                await session.scalars(
                    select(MangaModel)
                    .where(
                        MangaModel.visibility_status == "PUBLIC",
                        MangaModel.deletion_status == "ACTIVE",
                        or_(
                            MangaModel.title.ilike(f"%{raw_q}%"),
                            MangaModel.title.ilike(f"%{norm_q}%"),
                            MangaModel.slug.ilike(f"%{slug_q}%"),
                            MangaModel.manga_id.in_(alt_match_subq),
                        ),
                    )
                    .order_by(desc(MangaModel.total_views))
                    .limit(60)
                )
            ).all()
            cand_ids = [m.manga_id for m in public_mangas]
            alt_rows = (
                (
                    await session.scalars(
                        select(MangaAltTitleModel).where(MangaAltTitleModel.manga_id.in_(cand_ids))
                    )
                ).all()
                if cand_ids
                else []
            )
            creators = (
                await session.scalars(
                    select(CreatorModel)
                    .where(
                        or_(
                            CreatorModel.name.ilike(f"%{raw_q}%"),
                            CreatorModel.name.ilike(f"%{norm_q}%"),
                        )
                    )
                    .limit(30)
                )
            ).all()
        else:
            public_mangas = (
                await session.scalars(
                    select(MangaModel).where(
                        MangaModel.visibility_status == "PUBLIC",
                        MangaModel.deletion_status == "ACTIVE",
                    )
                )
            ).all()
            alt_rows = (await session.scalars(select(MangaAltTitleModel))).all()
            creators = (await session.scalars(select(CreatorModel))).all()

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

        raw_q = q.strip()
        if await self._is_large_table(session, MangaModel.manga_id):
            alt_match_subq = select(MangaAltTitleModel.manga_id).where(
                or_(
                    MangaAltTitleModel.alternative_title.ilike(f"%{raw_q}%"),
                    MangaAltTitleModel.alternative_title.ilike(f"%{norm_q}%"),
                )
            )
            slug_q = norm_q.replace(" ", "-")
            public_mangas = (
                await session.scalars(
                    select(MangaModel)
                    .where(
                        MangaModel.visibility_status == "PUBLIC",
                        MangaModel.deletion_status == "ACTIVE",
                        or_(
                            MangaModel.title.ilike(f"%{raw_q}%"),
                            MangaModel.title.ilike(f"%{norm_q}%"),
                            MangaModel.slug.ilike(f"%{slug_q}%"),
                            MangaModel.manga_id.in_(alt_match_subq),
                        ),
                    )
                    .order_by(desc(MangaModel.total_views))
                    .limit(200)
                )
            ).all()
            cand_ids = [m.manga_id for m in public_mangas]
            alt_rows = (
                (
                    await session.scalars(
                        select(MangaAltTitleModel).where(MangaAltTitleModel.manga_id.in_(cand_ids))
                    )
                ).all()
                if cand_ids
                else []
            )
        else:
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
            best = self._score_title_match(norm_q, m.title, alts_by_manga.get(m.manga_id, []))
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
        norm_role = role.strip().lower() if role and role.strip() else None
        if norm_role and norm_role not in ("author", "artist"):
            raise ValidationAppError(
                "role must be 'author' or 'artist'.", error_code="INVALID_FILTER"
            )

        raw_q = q.strip()
        if await self._is_large_table(session, CreatorModel.creator_id):
            creators = (
                await session.scalars(
                    select(CreatorModel)
                    .where(
                        or_(
                            CreatorModel.name.ilike(f"%{raw_q}%"),
                            CreatorModel.name.ilike(f"%{norm_q}%"),
                        )
                    )
                    .limit(200)
                )
            ).all()
        else:
            creators = (await session.scalars(select(CreatorModel))).all()
        matched = [c for c in creators if norm_q in normalize_search_text(c.name)][:200]
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
        if norm_role:
            credit_stmt = credit_stmt.where(MangaCreatorModel.role == norm_role)
        credit_rows = (await session.execute(credit_stmt)).all()

        roles_by_creator: dict[str, set[str]] = {}
        works_by_creator: dict[str, set[UUID]] = {}
        for cid, r, mid in credit_rows:
            roles_by_creator.setdefault(cid, set()).add(r)
            works_by_creator.setdefault(cid, set()).add(mid)

        results: list[dict[str, Any]] = []
        for c in matched:
            if norm_role and c.creator_id not in roles_by_creator:
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
        alt_rows = (
            await session.execute(
                select(MangaAltTitleModel.alternative_title, MangaAltTitleModel.language_code)
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
                .order_by(MangaCoverArtModel.volume.asc(), MangaCoverArtModel.cover_art_id.asc())
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
                .where(RatingModel.manga_id == manga.manga_id, RatingModel.is_removed == false())
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
                    RatingModel.is_removed == false(),
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
            "altTitles": [row[0] for row in alt_rows],
            "altTitleEntries": [{"title": row[0], "languageCode": row[1]} for row in alt_rows],
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
        role_rows = (
            await session.scalars(
                select(MangaCreatorModel.role)
                .where(MangaCreatorModel.creator_id == creator_id)
                .distinct()
            )
        ).all()
        bio_map = {b.language_code: b.biography for b in bios}
        return {
            "creatorId": creator.creator_id,
            "slug": creator.slug,
            "name": creator.name,
            "roles": sorted({r.lower() for r in role_rows if r}),
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
            MangaModel.manga_id.in_(
                select(MangaCreatorModel.manga_id).where(MangaCreatorModel.creator_id == creator_id)
            ),
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
