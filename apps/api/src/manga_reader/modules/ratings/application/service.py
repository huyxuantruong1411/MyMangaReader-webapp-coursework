"""Phase 7: Rating Service (`UC-4.7`, `UC-4.8`, `ADR-010`, `SOC-001`..`SOC-007`)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Numeric, cast, false, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    BusinessRuleError,
    ResourceNotFoundError,
    ValidationAppError,
)
from manga_reader.common.identities import MediaObjectRef
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.audit_outbox import append_activity_log
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    ChapterModel,
    MangaModel,
    MediaObjectModel,
    RatingHistoryModel,
    RatingModel,
    ReadingHistoryModel,
)
from manga_reader.modules.ratings import RATING_MAX_SCORE, RATING_MIN_SCORE


class RatingService:
    """Application service for Module 7 (`ratings`)."""

    def __init__(self, container: AppContainer | None = None) -> None:
        self._container = container

    async def _recompute_average(
        self, session: AsyncSession, manga: MangaModel
    ) -> tuple[float, int]:
        row = (
            await session.execute(
                select(
                    func.avg(cast(RatingModel.score, Numeric(9, 3))),
                    func.count(RatingModel.rating_id),
                ).where(
                    RatingModel.manga_id == manga.manga_id,
                    RatingModel.is_removed == false(),
                )
            )
        ).one()
        avg_raw, cnt = row[0], int(row[1] or 0)
        avg_dec = (
            Decimal(str(round(float(avg_raw), 3))) if avg_raw is not None else Decimal("0.000")
        )
        manga.average_rating = avg_dec
        return float(avg_dec), cnt

    async def get_manga_rating(
        self,
        session: AsyncSession,
        *,
        manga_id: UUID,
        viewer: SecurityPrincipal,
    ) -> dict[str, Any]:
        manga = await session.get(MangaModel, manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")
        cnt = int(
            await session.scalar(
                select(func.count())
                .select_from(RatingModel)
                .where(RatingModel.manga_id == manga_id, RatingModel.is_removed == false())
            )
            or 0
        )
        my_score: int | None = None
        can_rate = False
        if viewer.is_authenticated and viewer.account_id is not None:
            r = await session.scalar(
                select(RatingModel).where(
                    RatingModel.reader_account_id == viewer.account_id,
                    RatingModel.manga_id == manga_id,
                    RatingModel.is_removed == false(),
                )
            )
            my_score = r.score if r is not None else None
            can_rate = (
                await session.scalar(
                    select(func.count())
                    .select_from(ReadingHistoryModel)
                    .join(ChapterModel, ChapterModel.chapter_id == ReadingHistoryModel.chapter_id)
                    .where(
                        ReadingHistoryModel.reader_account_id == viewer.account_id,
                        ChapterModel.manga_id == manga_id,
                    )
                )
                or 0
            ) > 0
        return {
            "mangaId": str(manga_id),
            "averageRating": float(manga.average_rating),
            "ratingCount": cnt,
            "myScore": my_score,
            "canRate": can_rate,
        }

    async def upsert_rating(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        manga_id: UUID,
        score: int,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        if score < RATING_MIN_SCORE or score > RATING_MAX_SCORE:
            raise ValidationAppError(
                f"Score must be between {RATING_MIN_SCORE} and {RATING_MAX_SCORE}.",
                details={"field": "score"},
            )
        manga = await session.get(MangaModel, manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        # Mandatory eligibility guard (Lab9 sequence / ADR-010 / SOC-001)
        opened_count = int(
            await session.scalar(
                select(func.count())
                .select_from(ReadingHistoryModel)
                .join(ChapterModel, ChapterModel.chapter_id == ReadingHistoryModel.chapter_id)
                .where(
                    ReadingHistoryModel.reader_account_id == principal.account_id,
                    ChapterModel.manga_id == manga_id,
                )
            )
            or 0
        )
        if opened_count == 0:
            raise BusinessRuleError(
                "You must open at least one chapter of this manga before rating it.",
                error_code="RATING_REQUIRES_READING",
            )

        now = utc_now()
        existing = await session.scalar(
            select(RatingModel).where(
                RatingModel.reader_account_id == principal.account_id,
                RatingModel.manga_id == manga_id,
            )
        )
        if existing is None:
            rating = RatingModel(
                reader_account_id=principal.account_id,
                manga_id=manga_id,
                score=score,
                is_removed=False,
                updated_at=now,
            )
            session.add(rating)
            await session.flush()
            action_type = "CREATE"
            prev_score: int | None = None
        elif existing.is_removed:
            rating = existing
            prev_score = None
            rating.score = score
            rating.is_removed = False
            rating.updated_at = now
            action_type = "CREATE"
        else:
            rating = existing
            prev_score = rating.score
            rating.score = score
            rating.updated_at = now
            action_type = "UPDATE"

        session.add(
            RatingHistoryModel(
                rating_id=rating.rating_id,
                previous_score=prev_score,
                new_score=score,
                action_type=action_type,
                recorded_at=now,
            )
        )
        await session.flush()
        avg_val, cnt = await self._recompute_average(session, manga)
        append_activity_log(
            session,
            event_type="RATING",
            account_id=principal.account_id,
            target_type="MANGA",
            target_id=str(manga_id),
            details={"action": action_type, "previous_score": prev_score, "new_score": score},
        )
        await session.commit()
        return {
            "ratingId": str(rating.rating_id),
            "mangaId": str(manga_id),
            "score": score,
            "action": action_type,
            "averageRating": avg_val,
            "ratingCount": cnt,
        }

    async def remove_rating(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        manga_id: UUID,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        manga = await session.get(MangaModel, manga_id)
        if manga is None:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        rating = await session.scalar(
            select(RatingModel).where(
                RatingModel.reader_account_id == principal.account_id,
                RatingModel.manga_id == manga_id,
            )
        )
        if rating is None or rating.is_removed:
            avg_val, cnt = await self._recompute_average(session, manga)
            return {
                "mangaId": str(manga_id),
                "removed": True,
                "averageRating": avg_val,
                "ratingCount": cnt,
            }

        now = utc_now()
        old_score = rating.score
        rating.is_removed = True
        rating.updated_at = now
        session.add(
            RatingHistoryModel(
                rating_id=rating.rating_id,
                previous_score=old_score,
                new_score=None,
                action_type="REMOVE",
                recorded_at=now,
            )
        )
        await session.flush()
        avg_val, cnt = await self._recompute_average(session, manga)
        append_activity_log(
            session,
            event_type="RATING",
            account_id=principal.account_id,
            target_type="MANGA",
            target_id=str(manga_id),
            details={"action": "REMOVE", "previous_score": old_score},
        )
        await session.commit()
        return {
            "mangaId": str(manga_id),
            "removed": True,
            "averageRating": avg_val,
            "ratingCount": cnt,
        }

    async def list_my_rating_history(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        assert principal.account_id is not None
        base = (
            select(RatingHistoryModel, RatingModel, MangaModel)
            .join(RatingModel, RatingModel.rating_id == RatingHistoryModel.rating_id)
            .join(MangaModel, MangaModel.manga_id == RatingModel.manga_id)
            .where(RatingModel.reader_account_id == principal.account_id)
        )
        total = int(await session.scalar(select(func.count()).select_from(base.subquery())) or 0)
        rows = (
            await session.execute(
                base.order_by(
                    RatingHistoryModel.recorded_at.desc(),
                    RatingHistoryModel.rating_history_id.desc(),
                )
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        cover_ids = list(
            {m.primary_cover_media_id for _, _, m in rows if m.primary_cover_media_id is not None}
        )
        media_map: dict[int, MediaObjectModel] = {}
        if cover_ids and self._container is not None:
            media_rows = (
                await session.scalars(
                    select(MediaObjectModel).where(MediaObjectModel.media_id.in_(cover_ids))
                )
            ).all()
            media_map = {row.media_id: row for row in media_rows}

        items: list[dict[str, Any]] = []
        for rh, _r, m in rows:
            cover_media = (
                media_map.get(m.primary_cover_media_id)
                if m.primary_cover_media_id is not None
                else None
            )
            cover_url = (
                self._container.media_signer.build_signed_proxy_url(
                    MediaObjectRef(bucket=cover_media.bucket, object_key=cover_media.object_key)
                )
                if cover_media is not None and self._container is not None
                else None
            )
            items.append(
                {
                    "ratingHistoryId": str(rh.rating_history_id),
                    "mangaId": str(m.manga_id),
                    "mangaSlug": m.slug,
                    "mangaTitle": m.title,
                    "mangaCoverUrl": cover_url,
                    "actionType": rh.action_type,
                    "previousScore": rh.previous_score,
                    "newScore": rh.new_score,
                    "recordedAt": format_rfc3339(rh.recorded_at),
                }
            )
        return items, total
