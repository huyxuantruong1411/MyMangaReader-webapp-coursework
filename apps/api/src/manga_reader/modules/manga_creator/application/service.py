"""Phase 4: Admin Manga Visibility (`HIDE`/`SHOW`) and Safe Local Deletion (`ADR-011`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    ConflictError,
    ResourceNotFoundError,
    ValidationAppError,
)
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.audit_outbox import append_activity_log, enqueue_outbox_event
from manga_reader.infrastructure.orm import (
    ChapterModel,
    ChapterPageModel,
    CommentModel,
    ListItemModel,
    MangaCoverArtModel,
    MangaDeletionTombstoneModel,
    MangaModel,
    MangaModerationLogModel,
    MangaReportModel,
    MangaSyncSubscriptionModel,
    MediaObjectModel,
    ReadingListModel,
)


class MangaLifecycleService:
    """Application service for Module 2 (`manga_creator`) administrative operations."""

    async def admin_list_manga(
        self,
        session: AsyncSession,
        *,
        q: str | None = None,
        visibility: str | None = None,
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        stmt = select(MangaModel)
        count_stmt = select(func.count()).select_from(MangaModel)
        if q:
            like = f"%{q.strip()}%"
            cond = or_(
                MangaModel.title.ilike(like),
                MangaModel.slug.ilike(like),
                MangaModel.pool_manga_id.ilike(like),
                MangaModel.source_manga_id.ilike(like),
            )
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)
        if visibility:
            stmt = stmt.where(MangaModel.visibility_status == visibility)
            count_stmt = count_stmt.where(MangaModel.visibility_status == visibility)

        total = int(await session.scalar(count_stmt) or 0)
        rows = (
            await session.scalars(
                stmt.order_by(MangaModel.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return [
            {
                "mangaId": str(m.manga_id),
                "poolMangaId": m.pool_manga_id,
                "sourceMangaId": m.source_manga_id,
                "slug": m.slug,
                "title": m.title,
                "visibilityStatus": m.visibility_status,
                "publicationStatus": m.publication_status,
                "contentRating": m.content_rating,
                "isCdcEnabled": m.is_cdc_enabled,
                "isSyncing": m.is_syncing,
                "ignoreAllReports": m.ignore_all_reports,
                "totalViews": m.total_views,
                "averageRating": float(m.average_rating),
                "updatedAt": format_rfc3339(m.updated_at),
            }
            for m in rows
        ], total

    async def hide_manga(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        manga_id: UUID,
        reason: str,
        source_report_id: UUID | None = None,
        commit: bool = True,
    ) -> dict[str, Any]:
        assert admin_principal.account_id is not None
        clean_reason = reason.strip()
        if not clean_reason:
            raise ValidationAppError(
                "Reason is required to hide a manga.", details={"field": "reason"}
            )

        manga = await session.get(MangaModel, manga_id)
        if manga is None:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        now = utc_now()
        previous = manga.visibility_status
        manga.visibility_status = "HIDDEN"
        manga.updated_at = now

        session.add(
            MangaModerationLogModel(
                admin_account_id=admin_principal.account_id,
                manga_id=manga.manga_id,
                pool_manga_id=manga.pool_manga_id,
                manga_title_snapshot=manga.title,
                action_type="HIDE",
                reason=clean_reason,
                source_report_id=source_report_id,
                performed_at=now,
            )
        )
        append_activity_log(
            session,
            event_type="MANGA_HIDE",
            account_id=admin_principal.account_id,
            target_type="MANGA",
            target_id=str(manga.manga_id),
            details={"reason": clean_reason, "before": previous, "after": "HIDDEN"},
        )
        await enqueue_outbox_event(
            session,
            idempotency_key=f"manga-hide:{manga.manga_id}:{int(now.timestamp() * 1000)}",
            event_type="MANGA_HIDDEN",
            aggregate_type="MANGA",
            aggregate_id=str(manga.manga_id),
            payload={"reason": clean_reason},
        )
        if commit:
            await session.commit()
        return {"mangaId": str(manga.manga_id), "visibilityStatus": manga.visibility_status}

    async def show_manga(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        manga_id: UUID,
        reason: str | None = None,
    ) -> dict[str, Any]:
        assert admin_principal.account_id is not None
        manga = await session.get(MangaModel, manga_id)
        if manga is None:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        now = utc_now()
        previous = manga.visibility_status
        manga.visibility_status = "PUBLIC"
        manga.updated_at = now
        # Explicitly NEVER auto-enables CDC (UC-2.2)

        session.add(
            MangaModerationLogModel(
                admin_account_id=admin_principal.account_id,
                manga_id=manga.manga_id,
                pool_manga_id=manga.pool_manga_id,
                manga_title_snapshot=manga.title,
                action_type="SHOW",
                reason=reason,
                performed_at=now,
            )
        )
        append_activity_log(
            session,
            event_type="MANGA_SHOW",
            account_id=admin_principal.account_id,
            target_type="MANGA",
            target_id=str(manga.manga_id),
            details={"reason": reason, "before": previous, "after": "PUBLIC"},
        )
        await session.commit()
        return {
            "mangaId": str(manga.manga_id),
            "visibilityStatus": manga.visibility_status,
            "isCdcEnabled": manga.is_cdc_enabled,
        }

    async def delete_manga(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        manga_id: UUID,
        reason: str,
        source_report_id: UUID | None = None,
        commit: bool = True,
    ) -> dict[str, Any]:
        """Safe local deletion (`UC-2.4` / `ADR-011`): never mutates upstream."""
        assert admin_principal.account_id is not None
        clean_reason = reason.strip()
        if not clean_reason:
            raise ValidationAppError(
                "Reason is required to delete a manga.", details={"field": "reason"}
            )

        manga = await session.get(MangaModel, manga_id)
        if manga is None:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")
        if manga.is_syncing:
            raise ConflictError(
                "Manga is currently syncing and cannot be deleted.",
                error_code="MANGA_IS_SYNCING",
            )

        now = utc_now()
        pool_manga_id = manga.pool_manga_id
        title_snapshot = manga.title

        # 1. Cancel CDC subscription before deleting local data
        await session.execute(
            update(MangaSyncSubscriptionModel)
            .where(MangaSyncSubscriptionModel.manga_id == manga.manga_id)
            .values(status="CANCELLED", unsubscribed_at=now, updated_at=now)
        )

        # 2. Record durable tombstone so delayed CDC cannot resurrect deleted manga
        existing_tomb = await session.get(MangaDeletionTombstoneModel, pool_manga_id)
        if existing_tomb is None:
            session.add(
                MangaDeletionTombstoneModel(
                    pool_manga_id=pool_manga_id,
                    manga_id=manga.manga_id,
                    manga_title_snapshot=title_snapshot,
                    reason=clean_reason,
                    deleted_by_admin_account_id=admin_principal.account_id,
                    deleted_at=now,
                )
            )

        # 3. Preserve report snapshots (detach FK to NULL, never delete evidence)
        await session.execute(
            update(MangaReportModel)
            .where(MangaReportModel.target_manga_id == manga.manga_id)
            .values(target_manga_id=None, target_chapter_id=None)
        )

        # 4. Remove reading list references and reconcile affected list item_count (UC-2.4 / LIST-027)
        affected_list_ids = (
            await session.scalars(
                select(ListItemModel.list_id).where(ListItemModel.manga_id == manga.manga_id)
            )
        ).all()
        await session.execute(delete(ListItemModel).where(ListItemModel.manga_id == manga.manga_id))
        for lid in set(affected_list_ids):
            new_count = int(
                await session.scalar(
                    select(func.count())
                    .select_from(ListItemModel)
                    .where(ListItemModel.list_id == lid)
                )
                or 0
            )
            await session.execute(
                update(ReadingListModel)
                .where(ReadingListModel.list_id == lid)
                .values(item_count=new_count, updated_at=now)
            )

        # 5. Collect candidate media IDs for async GC after chapter/cover rows are removed
        chapter_ids = (
            await session.scalars(
                select(ChapterModel.chapter_id).where(ChapterModel.manga_id == manga.manga_id)
            )
        ).all()
        candidate_media_ids: set[int] = set()
        if manga.primary_cover_media_id is not None:
            candidate_media_ids.add(manga.primary_cover_media_id)
        cover_media = (
            await session.scalars(
                select(MangaCoverArtModel.media_id).where(
                    MangaCoverArtModel.manga_id == manga.manga_id
                )
            )
        ).all()
        candidate_media_ids.update(cover_media)
        if chapter_ids:
            page_media = (
                await session.scalars(
                    select(ChapterPageModel.media_id).where(
                        ChapterPageModel.chapter_id.in_(chapter_ids)
                    )
                )
            ).all()
            candidate_media_ids.update(page_media)

        # 6. Delete local comments (UC-2.4) & manga (cascades chapters/pages/tags/credits)
        await session.execute(delete(CommentModel).where(CommentModel.manga_id == manga.manga_id))
        await session.delete(manga)
        await session.flush()

        # 7. Flag unreferenced media objects as PENDING_GC (never delete referenced media!)
        for mid in candidate_media_ids:
            still_used_page = await session.scalar(
                select(func.count())
                .select_from(ChapterPageModel)
                .where(ChapterPageModel.media_id == mid)
            )
            still_used_cover = await session.scalar(
                select(func.count())
                .select_from(MangaCoverArtModel)
                .where(MangaCoverArtModel.media_id == mid)
            )
            still_used_primary = await session.scalar(
                select(func.count())
                .select_from(MangaModel)
                .where(MangaModel.primary_cover_media_id == mid)
            )
            if (still_used_page or 0) + (still_used_cover or 0) + (still_used_primary or 0) == 0:
                await session.execute(
                    update(MediaObjectModel)
                    .where(MediaObjectModel.media_id == mid)
                    .values(gc_status="PENDING_GC", deleted_at=now)
                )

        # 8. Immutable moderation & activity audit + outbox GC event
        session.add(
            MangaModerationLogModel(
                admin_account_id=admin_principal.account_id,
                manga_id=None,
                pool_manga_id=pool_manga_id,
                manga_title_snapshot=title_snapshot,
                action_type="DELETE",
                reason=clean_reason,
                source_report_id=source_report_id,
                performed_at=now,
            )
        )
        append_activity_log(
            session,
            event_type="MANGA_DELETE",
            account_id=admin_principal.account_id,
            target_type="MANGA",
            target_id=str(manga_id),
            details={
                "pool_manga_id": pool_manga_id,
                "title_snapshot": title_snapshot,
                "reason": clean_reason,
                "candidate_gc_media": len(candidate_media_ids),
            },
        )
        await enqueue_outbox_event(
            session,
            idempotency_key=f"manga-delete:{manga_id}",
            event_type="MANGA_DELETED",
            aggregate_type="MANGA",
            aggregate_id=str(manga_id),
            payload={"poolMangaId": pool_manga_id, "gcMediaIds": sorted(candidate_media_ids)},
        )
        if commit:
            await session.commit()
        return {
            "mangaId": str(manga_id),
            "poolMangaId": pool_manga_id,
            "deleted": True,
            "tombstoned": True,
        }
