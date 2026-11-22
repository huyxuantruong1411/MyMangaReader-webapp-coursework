"""Phase 9: Immutable Activity Logs, Reader Stats, Manga Interaction Stats & Counter Reconciliation."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Numeric, cast, false, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339
from manga_reader.infrastructure.orm import (
    ActivityLogModel,
    ChapterModel,
    CommentModel,
    CommentReactionModel,
    CreatorModel,
    ListItemModel,
    MangaCreatorModel,
    MangaModel,
    MangaTagModel,
    RatingModel,
    ReadingHistoryModel,
    ReadingListModel,
    ReadingStatusRecordModel,
    ReportModel,
    TagModel,
)


class AdminAnalyticsService:
    """Application service for Module 12 (`admin_analytics`)."""

    async def query_activity_logs(
        self,
        session: AsyncSession,
        *,
        account_id: UUID | None = None,
        event_type: str | None = None,
        page: int = 1,
        page_size: int = 30,
    ) -> tuple[list[dict[str, Any]], int]:
        stmt = select(ActivityLogModel)
        count_stmt = select(func.count()).select_from(ActivityLogModel)
        if account_id is not None:
            stmt = stmt.where(ActivityLogModel.account_id == account_id)
            count_stmt = count_stmt.where(ActivityLogModel.account_id == account_id)
        if event_type:
            stmt = stmt.where(ActivityLogModel.event_type == event_type.upper())
            count_stmt = count_stmt.where(ActivityLogModel.event_type == event_type.upper())

        total = int(await session.scalar(count_stmt) or 0)
        rows = (
            await session.scalars(
                stmt.order_by(ActivityLogModel.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return [
            {
                "logId": str(r.log_id),
                "accountId": str(r.account_id) if r.account_id else None,
                "eventType": r.event_type,
                "targetType": r.target_type,
                "targetId": r.target_id,
                "ipAddress": r.ip_address,
                "details": json.loads(r.details_json) if r.details_json else {},
                "createdAt": format_rfc3339(r.created_at),
            }
            for r in rows
        ], total

    async def get_reader_statistics(
        self, session: AsyncSession, *, reader_account_id: UUID
    ) -> dict[str, Any]:
        """UC-1.5 Reader behavior statistics separating chapter opens vs valid views (ADR-016)."""
        hist_rows = (
            await session.execute(
                select(ReadingHistoryModel, ChapterModel.manga_id)
                .join(ChapterModel, ChapterModel.chapter_id == ReadingHistoryModel.chapter_id)
                .where(ReadingHistoryModel.reader_account_id == reader_account_id)
            )
        ).all()

        chapter_opens = len(hist_rows)
        valid_views = sum(1 for h, _ in hist_rows if h.is_valid_view)
        unique_chapters = len({h.chapter_id for h, _ in hist_rows})
        unique_mangas = {mid for _, mid in hist_rows}

        status_rows = (
            await session.scalars(
                select(ReadingStatusRecordModel).where(
                    ReadingStatusRecordModel.reader_account_id == reader_account_id
                )
            )
        ).all()
        status_breakdown: dict[str, int] = {}
        for sr in status_rows:
            status_breakdown[sr.status] = status_breakdown.get(sr.status, 0) + 1
            unique_mangas.add(sr.manga_id)

        ratings = (
            await session.scalars(
                select(RatingModel).where(
                    RatingModel.reader_account_id == reader_account_id,
                    RatingModel.is_removed == false(),
                )
            )
        ).all()
        avg_rating = round(sum(r.score for r in ratings) / len(ratings), 2) if ratings else None

        top_tags: list[dict[str, Any]] = []
        top_creators: list[dict[str, Any]] = []
        if unique_mangas:
            sample_manga_ids = list(unique_mangas)[:1500]
            t_rows = (
                await session.execute(
                    select(TagModel.slug, TagModel.name, func.count(MangaTagModel.manga_id))
                    .join(MangaTagModel, MangaTagModel.tag_id == TagModel.tag_id)
                    .where(MangaTagModel.manga_id.in_(sample_manga_ids))
                    .group_by(TagModel.slug, TagModel.name)
                    .order_by(func.count(MangaTagModel.manga_id).desc())
                    .limit(8)
                )
            ).all()
            top_tags = [
                {"slug": slug, "name": name, "count": int(cnt)} for slug, name, cnt in t_rows
            ]

            c_rows = (
                await session.execute(
                    select(
                        CreatorModel.creator_id,
                        CreatorModel.name,
                        MangaCreatorModel.role,
                        MangaCreatorModel.manga_id,
                    )
                    .join(
                        MangaCreatorModel, MangaCreatorModel.creator_id == CreatorModel.creator_id
                    )
                    .where(MangaCreatorModel.manga_id.in_(sample_manga_ids))
                )
            ).all()
            creator_works: dict[str, set[UUID]] = {}
            creator_names: dict[str, str] = {}
            creator_roles: dict[str, set[str]] = {}
            for cid, cname, crole, mid in c_rows:
                creator_names[cid] = cname
                creator_works.setdefault(cid, set()).add(mid)
                if crole:
                    creator_roles.setdefault(cid, set()).add(crole.lower())
            ranked_creators = sorted(
                creator_works.items(),
                key=lambda item: (-len(item[1]), creator_names[item[0]]),
            )[:12]
            top_creators = [
                {
                    "creatorId": cid,
                    "name": creator_names[cid],
                    "workCount": len(mids),
                    "roles": sorted(creator_roles.get(cid, set())),
                }
                for cid, mids in ranked_creators
            ]

        return {
            "accountId": str(reader_account_id),
            "hasData": (chapter_opens + len(status_rows) + len(ratings)) > 0,
            "chapterOpens": chapter_opens,
            "validViews": valid_views,
            "uniqueChaptersRead": unique_chapters,
            "uniqueMangasInteracted": len(unique_mangas),
            "ratingsCount": len(ratings),
            "averageRatingGiven": avg_rating,
            "readingStatusBreakdown": status_breakdown,
            "topTags": top_tags,
            "topCreators": top_creators,
        }

    async def get_manga_interaction_statistics(
        self,
        session: AsyncSession,
        *,
        tag: str | None = None,
        manga_id: UUID | None = None,
    ) -> dict[str, Any]:
        """UC-2.5 Admin Manga Interaction Statistics."""
        stmt = select(MangaModel).where(MangaModel.deletion_status == "ACTIVE")
        if manga_id is not None:
            stmt = stmt.where(MangaModel.manga_id == manga_id)
        if tag:
            tag_subq = (
                select(MangaTagModel.manga_id)
                .join(TagModel, TagModel.tag_id == MangaTagModel.tag_id)
                .where(TagModel.slug == tag.strip().lower())
            )
            stmt = stmt.where(MangaModel.manga_id.in_(tag_subq))

        filtered_subq = stmt.with_only_columns(
            MangaModel.manga_id, MangaModel.total_views
        ).subquery()
        agg_row = (
            await session.execute(
                select(
                    func.count(filtered_subq.c.manga_id),
                    func.coalesce(func.sum(filtered_subq.c.total_views), 0),
                )
            )
        ).one()
        total_mangas = int(agg_row[0] or 0)
        total_valid_views = int(agg_row[1] or 0)

        filtered_ids_select = select(filtered_subq.c.manga_id)
        total_list_adds = int(
            await session.scalar(
                select(func.count())
                .select_from(ListItemModel)
                .where(ListItemModel.manga_id.in_(filtered_ids_select))
            )
            or 0
        )
        total_comments = int(
            await session.scalar(
                select(func.count())
                .select_from(CommentModel)
                .where(
                    CommentModel.is_deleted == false(),
                    CommentModel.manga_id.in_(filtered_ids_select),
                )
            )
            or 0
        )
        pending_reports = int(
            await session.scalar(
                select(func.count()).select_from(ReportModel).where(ReportModel.status == "PENDING")
            )
            or 0
        )

        mangas = (
            await session.scalars(stmt.order_by(MangaModel.total_views.desc()).limit(100))
        ).all()
        page_ids = [m.manga_id for m in mangas]
        list_counts: dict[UUID, int] = {}
        rating_counts: dict[UUID, int] = {}
        comment_counts: dict[UUID, int] = {}
        if page_ids:
            list_counts = {
                mid: int(cnt)
                for mid, cnt in (
                    await session.execute(
                        select(ListItemModel.manga_id, func.count())
                        .where(ListItemModel.manga_id.in_(page_ids))
                        .group_by(ListItemModel.manga_id)
                    )
                ).all()
            }
            rating_counts = {
                mid: int(cnt)
                for mid, cnt in (
                    await session.execute(
                        select(RatingModel.manga_id, func.count())
                        .where(
                            RatingModel.manga_id.in_(page_ids), RatingModel.is_removed == false()
                        )
                        .group_by(RatingModel.manga_id)
                    )
                ).all()
            }
            comment_counts = {
                mid: int(cnt)
                for mid, cnt in (
                    await session.execute(
                        select(CommentModel.manga_id, func.count())
                        .where(
                            CommentModel.manga_id.in_(page_ids),
                            CommentModel.is_deleted == false(),
                        )
                        .group_by(CommentModel.manga_id)
                    )
                ).all()
            }

        items: list[dict[str, Any]] = [
            {
                "mangaId": str(m.manga_id),
                "slug": m.slug,
                "title": m.title,
                "visibilityStatus": m.visibility_status,
                "validViews": m.total_views,
                "listAdditions": list_counts.get(m.manga_id, 0),
                "ratingsCount": rating_counts.get(m.manga_id, 0),
                "averageRating": float(m.average_rating),
                "commentsCount": comment_counts.get(m.manga_id, 0),
            }
            for m in mangas
        ]

        return {
            "summary": {
                "totalMangas": total_mangas,
                "totalValidViews": total_valid_views,
                "totalListAdditions": total_list_adds,
                "totalComments": total_comments,
                "pendingReports": pending_reports,
            },
            "items": items,
        }

    async def reconcile_counters(self, session: AsyncSession) -> dict[str, int]:
        """Integrity reconciliation job (`04_DATABASE_SCHEMA_AND_MIGRATIONS.md` §9)."""
        fixed_lists = 0
        list_count_map = {
            lid: int(cnt)
            for lid, cnt in (
                await session.execute(
                    select(ListItemModel.list_id, func.count()).group_by(ListItemModel.list_id)
                )
            ).all()
        }
        for lst in (await session.scalars(select(ReadingListModel))).all():
            actual = list_count_map.get(lst.list_id, 0)
            if lst.item_count != actual:
                lst.item_count = actual
                fixed_lists += 1

        fixed_comments = 0
        reaction_rows = (
            await session.execute(
                select(
                    CommentReactionModel.comment_id,
                    CommentReactionModel.reaction_type,
                    func.count(),
                ).group_by(CommentReactionModel.comment_id, CommentReactionModel.reaction_type)
            )
        ).all()
        like_map: dict[UUID, int] = {}
        dislike_map: dict[UUID, int] = {}
        for cid, rtype, cnt in reaction_rows:
            if rtype == "LIKE":
                like_map[cid] = int(cnt)
            elif rtype == "DISLIKE":
                dislike_map[cid] = int(cnt)
        comments_to_check = (
            await session.scalars(
                select(CommentModel).where(
                    (CommentModel.like_count > 0)
                    | (CommentModel.dislike_count > 0)
                    | CommentModel.comment_id.in_(
                        select(CommentReactionModel.comment_id).distinct()
                    )
                )
            )
        ).all()
        for cm in comments_to_check:
            likes = like_map.get(cm.comment_id, 0)
            dislikes = dislike_map.get(cm.comment_id, 0)
            if cm.like_count != likes or cm.dislike_count != dislikes:
                cm.like_count = likes
                cm.dislike_count = dislikes
                fixed_comments += 1

        fixed_ratings = 0
        rating_avgs: dict[UUID, Any] = dict(
            (
                await session.execute(
                    select(
                        RatingModel.manga_id,
                        func.avg(cast(RatingModel.score, Numeric(9, 3))),
                    )
                    .where(RatingModel.is_removed == false())
                    .group_by(RatingModel.manga_id)
                )
            ).all()
        )
        rated_mangas = (
            await session.scalars(
                select(MangaModel).where(
                    MangaModel.manga_id.in_(select(RatingModel.manga_id).distinct())
                )
            )
        ).all()
        for m in rated_mangas:
            avg_raw = rating_avgs.get(m.manga_id)
            expected_avg = (
                Decimal(str(round(float(avg_raw), 3))) if avg_raw is not None else Decimal("0.000")
            )
            if m.average_rating != expected_avg:
                m.average_rating = expected_avg
                fixed_ratings += 1

        await session.commit()
        return {
            "fixedLists": fixed_lists,
            "fixedComments": fixed_comments,
            "fixedRatings": fixed_ratings,
        }
