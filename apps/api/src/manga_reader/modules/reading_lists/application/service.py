"""Phase 8: Private Owner-Only Reading Lists, Clone/Merge & Dynamic Metadata Stats (UC-7, UC-8)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    ConflictError,
    ResourceNotFoundError,
    ValidationAppError,
)
from manga_reader.common.security import SecurityPrincipal
from manga_reader.common.text import normalize_list_name, normalize_search_text, sanitize_user_text
from manga_reader.infrastructure.audit_outbox import append_activity_log
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    CreatorModel,
    ListItemModel,
    MangaCreatorModel,
    MangaModel,
    MangaStatsModel,
    MangaTagModel,
    RatingModel,
    ReadingListModel,
    ReadingStatusRecordModel,
    TagModel,
)
from manga_reader.modules.catalog_discovery.application.service import CatalogDiscoveryService

EMPTY_STATS_MESSAGE = "Danh sách chưa có truyện nào để thống kê"


class ReadingListService:
    """Application service for Module 10 (`reading_lists`).

    Canonical MVP invariants:
    - Private & owner-only (`ADR-009`): non-owner receives `404` without name leakage.
    - `item_count` reflects persisted `list_items`; visible `PUBLIC` count computed separately (`ADR-014`).
    """

    def __init__(self, container: AppContainer) -> None:
        self._container = container
        self._catalog = CatalogDiscoveryService(container)

    async def _require_owned_list(
        self, session: AsyncSession, *, list_id: UUID, owner_id: UUID
    ) -> ReadingListModel:
        lst = await session.get(ReadingListModel, list_id)
        if lst is None or lst.owner_reader_account_id != owner_id:
            # 404 prevents list ID enumeration (LIST-006 / 09_SOCIAL §5.4)
            raise ResourceNotFoundError("Reading list not found.")
        return lst

    def _validate_name_and_desc(
        self, name: str, description: str | None
    ) -> tuple[str, str, str | None]:
        clean_name = name.strip()
        if not clean_name or len(clean_name) > 100:
            raise ValidationAppError(
                "List name must be 1-100 characters.", details={"field": "name"}
            )
        norm = normalize_list_name(clean_name)
        clean_desc: str | None = None
        if description is not None:
            if len(description) > 500:
                raise ValidationAppError(
                    "Description cannot exceed 500 characters.",
                    details={"field": "description"},
                )
            clean_desc = sanitize_user_text(description, preserve_newlines=True) or None
        return sanitize_user_text(clean_name, preserve_newlines=False), norm, clean_desc

    def _serialize_list(
        self, lst: ReadingListModel, *, visible_count: int | None = None
    ) -> dict[str, Any]:
        data: dict[str, Any] = {
            "listId": str(lst.list_id),
            "name": lst.name,
            "description": lst.description,
            "itemCount": lst.item_count,
            "visibility": "PRIVATE",
            "createdAt": format_rfc3339(lst.created_at),
            "updatedAt": format_rfc3339(lst.updated_at),
        }
        if visible_count is not None:
            data["visibleItemCount"] = visible_count
        return data

    async def list_my_lists(
        self, session: AsyncSession, *, principal: SecurityPrincipal, q: str | None = None
    ) -> list[dict[str, Any]]:
        assert principal.account_id is not None
        lists = (
            await session.scalars(
                select(ReadingListModel)
                .where(ReadingListModel.owner_reader_account_id == principal.account_id)
                .order_by(ReadingListModel.updated_at.desc())
            )
        ).all()
        if q:
            norm_q = normalize_search_text(q)
            lists = [
                lst
                for lst in lists
                if norm_q in normalize_search_text(lst.name)
                or (lst.description and norm_q in normalize_search_text(lst.description))
            ]
        return [self._serialize_list(lst) for lst in lists]

    async def create_list(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        name: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        clean_name, norm, clean_desc = self._validate_name_and_desc(name, description)
        dup = await session.scalar(
            select(ReadingListModel).where(
                ReadingListModel.owner_reader_account_id == principal.account_id,
                ReadingListModel.normalized_name == norm,
            )
        )
        if dup is not None:
            raise ConflictError(
                "You already have a reading list with this name.",
                error_code="DUPLICATE_RESOURCE",
                details={"field": "name"},
            )
        now = utc_now()
        lst = ReadingListModel(
            owner_reader_account_id=principal.account_id,
            name=clean_name,
            normalized_name=norm,
            description=clean_desc,
            item_count=0,
            created_at=now,
            updated_at=now,
        )
        session.add(lst)
        await session.flush()
        append_activity_log(
            session,
            event_type="LIST_CREATED",
            account_id=principal.account_id,
            target_type="READING_LIST",
            target_id=str(lst.list_id),
        )
        await session.commit()
        return self._serialize_list(lst, visible_count=0)

    async def get_list_detail(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        list_id: UUID,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        lst = await self._require_owned_list(
            session, list_id=list_id, owner_id=principal.account_id
        )
        visible_count = int(
            await session.scalar(
                select(func.count())
                .select_from(ListItemModel)
                .join(MangaModel, MangaModel.manga_id == ListItemModel.manga_id)
                .where(
                    ListItemModel.list_id == list_id,
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
            or 0
        )
        return self._serialize_list(lst, visible_count=visible_count)

    async def update_list(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        list_id: UUID,
        name: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        lst = await self._require_owned_list(
            session, list_id=list_id, owner_id=principal.account_id
        )
        if name is not None:
            clean_name, norm, _ = self._validate_name_and_desc(name, None)
            dup = await session.scalar(
                select(ReadingListModel).where(
                    ReadingListModel.owner_reader_account_id == principal.account_id,
                    ReadingListModel.normalized_name == norm,
                    ReadingListModel.list_id != list_id,
                )
            )
            if dup is not None:
                raise ConflictError(
                    "Another reading list already uses this name.",
                    error_code="DUPLICATE_RESOURCE",
                    details={"field": "name"},
                )
            lst.name = clean_name
            lst.normalized_name = norm
        if description is not None:
            _, _, clean_desc = self._validate_name_and_desc(lst.name, description)
            lst.description = clean_desc
        lst.updated_at = utc_now()
        await session.commit()
        return await self.get_list_detail(session, principal=principal, list_id=list_id)

    async def delete_list(
        self, session: AsyncSession, *, principal: SecurityPrincipal, list_id: UUID
    ) -> dict[str, bool]:
        assert principal.account_id is not None
        lst = await self._require_owned_list(
            session, list_id=list_id, owner_id=principal.account_id
        )
        # Only removes list & list_items; NEVER touches manga, history, ratings, or comments
        await session.execute(delete(ListItemModel).where(ListItemModel.list_id == list_id))
        await session.delete(lst)
        append_activity_log(
            session,
            event_type="LIST_DELETED",
            account_id=principal.account_id,
            target_type="READING_LIST",
            target_id=str(list_id),
        )
        await session.commit()
        return {"deleted": True}

    async def merge_create_list(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        source_list_ids: list[UUID],
        new_name: str,
        description: str | None = None,
        confirm_empty: bool = False,
    ) -> dict[str, Any]:
        """Clone/merge one or more owned lists transactionally (UC-7.6 / LIST-009..013)."""
        assert principal.account_id is not None
        if not source_list_ids:
            raise ValidationAppError("At least one source list must be selected.")

        # Verify ALL source lists belong to caller before creating anything
        unique_sources = list(dict.fromkeys(source_list_ids))
        for sid in unique_sources:
            await self._require_owned_list(session, list_id=sid, owner_id=principal.account_id)

        clean_name, norm, clean_desc = self._validate_name_and_desc(new_name, description)
        dup = await session.scalar(
            select(ReadingListModel).where(
                ReadingListModel.owner_reader_account_id == principal.account_id,
                ReadingListModel.normalized_name == norm,
            )
        )
        if dup is not None:
            raise ConflictError(
                "You already have a reading list with this name.",
                error_code="DUPLICATE_RESOURCE",
                details={"field": "newName"},
            )

        # Deduplicate PUBLIC manga across selected source lists
        eligible_manga_ids = list(
            dict.fromkeys(
                (
                    await session.scalars(
                        select(ListItemModel.manga_id)
                        .join(MangaModel, MangaModel.manga_id == ListItemModel.manga_id)
                        .where(
                            ListItemModel.list_id.in_(unique_sources),
                            MangaModel.visibility_status == "PUBLIC",
                            MangaModel.deletion_status == "ACTIVE",
                        )
                    )
                ).all()
            )
        )

        if not eligible_manga_ids and not confirm_empty:
            raise ConflictError(
                "All selected source lists are empty. Set confirmEmpty=true to create an empty list.",
                error_code="EMPTY_SOURCE_LISTS_CONFIRMATION_REQUIRED",
            )

        now = utc_now()
        new_list = ReadingListModel(
            owner_reader_account_id=principal.account_id,
            name=clean_name,
            normalized_name=norm,
            description=clean_desc,
            item_count=len(eligible_manga_ids),
            created_at=now,
            updated_at=now,
        )
        session.add(new_list)
        await session.flush()

        for mid in eligible_manga_ids:
            session.add(ListItemModel(list_id=new_list.list_id, manga_id=mid, added_at=now))

        append_activity_log(
            session,
            event_type="LIST_CLONED",
            account_id=principal.account_id,
            target_type="READING_LIST",
            target_id=str(new_list.list_id),
            details={"source_count": len(unique_sources), "item_count": len(eligible_manga_ids)},
        )
        await session.commit()
        return self._serialize_list(new_list, visible_count=len(eligible_manga_ids))

    async def get_manga_memberships(
        self, session: AsyncSession, *, principal: SecurityPrincipal, manga_id: UUID
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        my_lists = (
            await session.scalars(
                select(ReadingListModel)
                .where(ReadingListModel.owner_reader_account_id == principal.account_id)
                .order_by(ReadingListModel.name.asc())
            )
        ).all()
        list_ids = [lst.list_id for lst in my_lists]
        member_of: set[UUID] = set()
        if list_ids:
            member_of = set(
                (
                    await session.scalars(
                        select(ListItemModel.list_id).where(
                            ListItemModel.list_id.in_(list_ids),
                            ListItemModel.manga_id == manga_id,
                        )
                    )
                ).all()
            )
        return {
            "mangaId": str(manga_id),
            "lists": [
                {
                    "listId": str(lst.list_id),
                    "name": lst.name,
                    "itemCount": lst.item_count,
                    "selected": lst.list_id in member_of,
                }
                for lst in my_lists
            ],
        }

    async def sync_manga_memberships(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        manga_id: UUID,
        selected_list_ids: list[UUID],
    ) -> dict[str, Any]:
        """Idempotent desired-state sync across caller's lists (`UC-8.3` / `LIST-014..017`)."""
        assert principal.account_id is not None
        manga = await session.get(MangaModel, manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        my_lists = (
            await session.scalars(
                select(ReadingListModel).where(
                    ReadingListModel.owner_reader_account_id == principal.account_id
                )
            )
        ).all()
        owned_map = {lst.list_id: lst for lst in my_lists}
        desired = set(selected_list_ids)
        if not desired.issubset(owned_map.keys()):
            raise ResourceNotFoundError("One or more selected reading lists were not found.")

        existing_rows = (
            (
                await session.scalars(
                    select(ListItemModel).where(
                        ListItemModel.list_id.in_(list(owned_map.keys())),
                        ListItemModel.manga_id == manga_id,
                    )
                )
            ).all()
            if owned_map
            else []
        )
        existing_by_list = {row.list_id: row for row in existing_rows}
        existing_ids = set(existing_by_list.keys())

        to_add = desired - existing_ids
        to_remove = existing_ids - desired
        now = utc_now()

        for lid in to_add:
            session.add(ListItemModel(list_id=lid, manga_id=manga_id, added_at=now))
        for lid in to_remove:
            await session.delete(existing_by_list[lid])

        if to_add or to_remove:
            await session.flush()
            for lid in to_add | to_remove:
                cnt = int(
                    await session.scalar(
                        select(func.count())
                        .select_from(ListItemModel)
                        .where(ListItemModel.list_id == lid)
                    )
                    or 0
                )
                owned_map[lid].item_count = cnt
                owned_map[lid].updated_at = now
            append_activity_log(
                session,
                event_type="LIST_ITEM_ADDED",
                account_id=principal.account_id,
                target_type="MANGA",
                target_id=str(manga_id),
                details={"added": len(to_add), "removed": len(to_remove)},
            )
            await session.commit()

        return await self.get_manga_memberships(session, principal=principal, manga_id=manga_id)

    async def remove_item_from_list(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        list_id: UUID,
        manga_id: UUID,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        lst = await self._require_owned_list(
            session, list_id=list_id, owner_id=principal.account_id
        )
        item = await session.scalar(
            select(ListItemModel).where(
                ListItemModel.list_id == list_id,
                ListItemModel.manga_id == manga_id,
            )
        )
        if item is not None:
            await session.delete(item)
            await session.flush()
            lst.item_count = int(
                await session.scalar(
                    select(func.count())
                    .select_from(ListItemModel)
                    .where(ListItemModel.list_id == list_id)
                )
                or 0
            )
            lst.updated_at = utc_now()
            await session.commit()
        return {"listId": str(list_id), "mangaId": str(manga_id), "itemCount": lst.item_count}

    async def list_items_filtered(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        list_id: UUID,
        q: str | None = None,
        tag: str | None = None,
        status: str | None = None,
        reading_status: str | None = None,
        sort: str = "ADDED_DESC",
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        assert principal.account_id is not None
        await self._require_owned_list(session, list_id=list_id, owner_id=principal.account_id)

        rows = (
            await session.execute(
                select(ListItemModel, MangaModel)
                .join(MangaModel, MangaModel.manga_id == ListItemModel.manga_id)
                .where(
                    ListItemModel.list_id == list_id,
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
                .order_by(ListItemModel.added_at.desc(), ListItemModel.list_item_id.desc())
            )
        ).all()

        if not rows:
            return [], 0

        manga_ids = [m.manga_id for _, m in rows]
        added_map = {m.manga_id: li.added_at for li, m in rows}

        # Filter by tag / publication status / reading status / title or creator query
        tag_manga_ids: set[UUID] | None = None
        if tag:
            tag_manga_ids = set(
                (
                    await session.scalars(
                        select(MangaTagModel.manga_id)
                        .join(TagModel, TagModel.tag_id == MangaTagModel.tag_id)
                        .where(
                            MangaTagModel.manga_id.in_(manga_ids),
                            TagModel.slug == tag.strip().lower(),
                        )
                    )
                ).all()
            )

        rs_manga_ids: set[UUID] | None = None
        if reading_status:
            rs_manga_ids = set(
                (
                    await session.scalars(
                        select(ReadingStatusRecordModel.manga_id).where(
                            ReadingStatusRecordModel.reader_account_id == principal.account_id,
                            ReadingStatusRecordModel.manga_id.in_(manga_ids),
                            ReadingStatusRecordModel.status == reading_status.upper(),
                        )
                    )
                ).all()
            )

        creators_by_manga: dict[UUID, list[str]] = {}
        if q:
            crows = (
                await session.execute(
                    select(MangaCreatorModel.manga_id, CreatorModel.name)
                    .join(CreatorModel, CreatorModel.creator_id == MangaCreatorModel.creator_id)
                    .where(MangaCreatorModel.manga_id.in_(manga_ids))
                )
            ).all()
            for mid, cname in crows:
                creators_by_manga.setdefault(mid, []).append(cname)

        filtered: list[MangaModel] = []
        norm_q = normalize_search_text(q) if q else ""
        for _li, m in rows:
            if status and m.publication_status != status:
                continue
            if tag_manga_ids is not None and m.manga_id not in tag_manga_ids:
                continue
            if rs_manga_ids is not None and m.manga_id not in rs_manga_ids:
                continue
            if norm_q:
                haystack = [m.title, *creators_by_manga.get(m.manga_id, [])]
                if not any(norm_q in normalize_search_text(h) for h in haystack):
                    continue
            filtered.append(m)

        if sort.upper() == "RATING_DESC":
            filtered.sort(key=lambda m: (-float(m.average_rating), m.title))
        elif sort.upper() == "TITLE_ASC":
            filtered.sort(key=lambda m: m.title.lower())
        else:
            filtered.sort(key=lambda m: added_map[m.manga_id], reverse=True)

        total = len(filtered)
        start = (page - 1) * page_size
        page_mangas = filtered[start : start + page_size]
        cards = await self._catalog.build_manga_cards(session, page_mangas)
        for card in cards:
            card["addedAt"] = format_rfc3339(added_map[UUID(card["mangaId"])])
        return cards, total

    async def get_metadata_stats(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        list_id: UUID,
    ) -> dict[str, Any]:
        """Dynamic list statistics over PUBLIC manga (`UC-8.5` / `LIST-023..026`)."""
        assert principal.account_id is not None
        await self._require_owned_list(session, list_id=list_id, owner_id=principal.account_id)

        public_mangas = (
            await session.scalars(
                select(MangaModel)
                .join(ListItemModel, ListItemModel.manga_id == MangaModel.manga_id)
                .where(
                    ListItemModel.list_id == list_id,
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
        ).all()

        now = format_rfc3339(utc_now())
        if not public_mangas:
            return {
                "empty": True,
                "emptyMessage": EMPTY_STATS_MESSAGE,
                "totalMangas": 0,
                "totalExportedChapters": 0,
                "tagDistribution": [],
                "publicationStatusDistribution": [],
                "averageListRating": None,
                "ratedMangaCount": 0,
                "topCreators": [],
                "calculatedAt": now,
            }

        total_mangas = len(public_mangas)
        manga_ids = [m.manga_id for m in public_mangas]

        # Exported chapters from manga_stats (NOT official_chapters per 09_SOCIAL §7)
        total_exported_chapters = int(
            await session.scalar(
                select(func.coalesce(func.sum(MangaStatsModel.chapter_count), 0)).where(
                    MangaStatsModel.manga_id.in_(manga_ids)
                )
            )
            or 0
        )

        # Tag distribution (denominator = total eligible mangas; may sum >100%)
        tag_rows = (
            await session.execute(
                select(TagModel.slug, TagModel.name, func.count(MangaTagModel.manga_id))
                .join(MangaTagModel, MangaTagModel.tag_id == TagModel.tag_id)
                .where(MangaTagModel.manga_id.in_(manga_ids))
                .group_by(TagModel.slug, TagModel.name)
                .order_by(func.count(MangaTagModel.manga_id).desc(), TagModel.slug.asc())
            )
        ).all()
        tag_dist = [
            {
                "tagSlug": slug,
                "tagName": name,
                "count": int(cnt),
                "percent": round((int(cnt) / total_mangas) * 100.0, 1),
            }
            for slug, name, cnt in tag_rows
        ]

        # Publication status distribution
        status_counts: dict[str, int] = {}
        for m in public_mangas:
            status_counts[m.publication_status] = status_counts.get(m.publication_status, 0) + 1
        status_dist = [
            {
                "status": st,
                "count": cnt,
                "percent": round((cnt / total_mangas) * 100.0, 1),
            }
            for st, cnt in sorted(status_counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]

        # Average list rating: mean of each manga's average_rating with >=1 active rating
        rated_ids = set(
            (
                await session.scalars(
                    select(RatingModel.manga_id)
                    .where(
                        RatingModel.manga_id.in_(manga_ids),
                        RatingModel.is_removed.is_(False),
                    )
                    .distinct()
                )
            ).all()
        )
        rated_scores = [float(m.average_rating) for m in public_mangas if m.manga_id in rated_ids]
        avg_list_rating = round(sum(rated_scores) / len(rated_scores), 2) if rated_scores else None

        # Top creators (count distinct eligible manga per creator)
        cr_rows = (
            await session.execute(
                select(
                    CreatorModel.creator_id,
                    CreatorModel.name,
                    MangaCreatorModel.manga_id,
                    MangaCreatorModel.role,
                )
                .join(MangaCreatorModel, MangaCreatorModel.creator_id == CreatorModel.creator_id)
                .where(MangaCreatorModel.manga_id.in_(manga_ids))
            )
        ).all()
        creator_works: dict[str, set[UUID]] = {}
        creator_roles: dict[str, set[str]] = {}
        creator_names: dict[str, str] = {}
        for cid, cname, mid, role in cr_rows:
            creator_names[cid] = cname
            creator_works.setdefault(cid, set()).add(mid)
            creator_roles.setdefault(cid, set()).add(role)
        top_creators: list[dict[str, Any]] = [
            {
                "creatorId": cid,
                "name": creator_names[cid],
                "workCount": len(mids),
                "roles": sorted(creator_roles[cid]),
            }
            for cid, mids in sorted(
                creator_works.items(),
                key=lambda kv: (-len(kv[1]), creator_names[kv[0]]),
            )[:10]
        ]

        return {
            "empty": False,
            "emptyMessage": None,
            "totalMangas": total_mangas,
            "totalExportedChapters": total_exported_chapters,
            "tagDistribution": tag_dist,
            "publicationStatusDistribution": status_dist,
            "averageListRating": avg_list_rating,
            "ratedMangaCount": len(rated_scores),
            "topCreators": top_creators,
            "calculatedAt": now,
        }
