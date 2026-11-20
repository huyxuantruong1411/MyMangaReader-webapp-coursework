"""Phase 6: Reader Engine, Exact Page Progress (ADR-001), History, Valid Views & Reading Status."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    BusinessRuleError,
    ConflictError,
    ForbiddenError,
    ResourceNotFoundError,
    ValidationAppError,
)
from manga_reader.common.identities import MediaObjectRef
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.audit_outbox import append_activity_log
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    ChapterModel,
    ChapterPageModel,
    MangaModel,
    MediaObjectModel,
    ReaderProgressModel,
    ReaderSettingsModel,
    ReadingHistoryModel,
    ReadingStatusRecordModel,
)
from manga_reader.modules.reader_engine import (
    DisplayMode,
    FitMode,
    ReaderOpenAction,
    ReadingDirection,
)
from manga_reader.modules.reader_engine.infrastructure.mangadex_fallback import (
    fetch_mangadex_at_home,
    is_mangadex_uuid,
)
from manga_reader.modules.reading_status_history import ReadingStatus


class ReaderService:
    """Application service for Module 5 (`reader_engine`) & Module 6 (`reading_status_history`)."""

    def __init__(self, container: AppContainer) -> None:
        self._container = container

    async def _resolve_public_manga(self, session: AsyncSession, manga_ref: str) -> MangaModel:
        manga: MangaModel | None = None
        try:
            manga = await session.scalar(
                select(MangaModel).where(
                    MangaModel.manga_id == UUID(manga_ref),
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
        except ValueError:
            manga = await session.scalar(
                select(MangaModel).where(
                    MangaModel.slug == manga_ref,
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
            )
        if manga is None:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")
        return manga

    async def _get_ordered_chapters(
        self, session: AsyncSession, manga_id: UUID
    ) -> list[ChapterModel]:
        return list(
            (
                await session.scalars(
                    select(ChapterModel)
                    .where(ChapterModel.manga_id == manga_id)
                    .order_by(
                        ChapterModel.chapter_numeric.asc(),
                        ChapterModel.language.asc(),
                        ChapterModel.pool_chapter_id.asc(),
                    )
                )
            ).all()
        )

    async def _maybe_upgrade_mangadex_pages(
        self,
        session: AsyncSession,
        chapter: ChapterModel,
        existing_rows: list[Any],
    ) -> list[Any]:
        """Lazily hydrate real MangaDex At-Home page manifest for local-imported chapters."""
        if not self._container.settings.mangadex_fallback_enabled:
            return existing_rows
        if not is_mangadex_uuid(chapter.source_chapter_id):
            return existing_rows

        already_upgraded = existing_rows and all(
            str(media.object_key).startswith("mangadex-cache/") for _, media in existing_rows
        )
        is_lazy_demo = (not existing_rows) or all(
            str(media.object_key).startswith("demo-pages/") for _, media in existing_rows
        )
        if not (is_lazy_demo or already_upgraded):
            return existing_rows

        assert chapter.source_chapter_id is not None
        remote_pages = await fetch_mangadex_at_home(
            chapter.source_chapter_id,
            cache=self._container.cache,
            use_data_saver=self._container.settings.mangadex_data_saver,
        )
        if not remote_pages:
            return existing_rows

        bucket = self._container.settings.s3_default_bucket
        for idx, item in enumerate(remote_pages, start=1):
            await self._container.cache.set(
                f"mdex:page:{chapter.chapter_id}:{idx:03d}",
                item["remote_url"],
                ttl_seconds=1200,
            )

        if already_upgraded and len(existing_rows) == len(remote_pages):
            return existing_rows

        # Replace lazy placeholder manifest with exact MangaDex page count & canonical MediaObject rows
        now = utc_now()
        await session.execute(
            delete(ChapterPageModel).where(ChapterPageModel.chapter_id == chapter.chapter_id)
        )
        for idx, item in enumerate(remote_pages, start=1):
            fname = item["filename"]
            ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else "jpg"
            if ext not in ("jpg", "jpeg", "png", "webp"):
                ext = "jpg"
            mime = {
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "png": "image/png",
                "webp": "image/webp",
            }[ext]
            obj_key = f"mangadex-cache/{chapter.chapter_id}/{idx:03d}.{ext}"
            media = await session.scalar(
                select(MediaObjectModel).where(
                    MediaObjectModel.bucket == bucket,
                    MediaObjectModel.object_key == obj_key,
                )
            )
            if media is None:
                media = MediaObjectModel(
                    bucket=bucket,
                    object_key=obj_key,
                    content_type=mime,
                    created_at=now,
                )
                session.add(media)
                await session.flush()

            session.add(
                ChapterPageModel(
                    chapter_id=chapter.chapter_id,
                    page_uid=f"mdex_{chapter.chapter_id.hex[:12]}_{idx:03d}",
                    page_number=idx,
                    filename=f"{idx:03d}.{ext}",
                    media_id=media.media_id,
                )
            )

        chapter.page_count = len(remote_pages)
        chapter.updated_at = now
        await session.commit()

        return list(
            (
                await session.execute(
                    select(ChapterPageModel, MediaObjectModel)
                    .join(MediaObjectModel, MediaObjectModel.media_id == ChapterPageModel.media_id)
                    .where(ChapterPageModel.chapter_id == chapter.chapter_id)
                    .order_by(ChapterPageModel.page_number.asc())
                )
            ).all()
        )

    async def _build_page_manifest(
        self, session: AsyncSession, chapter: ChapterModel
    ) -> list[dict[str, Any]]:
        rows = list(
            (
                await session.execute(
                    select(ChapterPageModel, MediaObjectModel)
                    .join(MediaObjectModel, MediaObjectModel.media_id == ChapterPageModel.media_id)
                    .where(ChapterPageModel.chapter_id == chapter.chapter_id)
                    .order_by(ChapterPageModel.page_number.asc())
                )
            ).all()
        )
        rows = await self._maybe_upgrade_mangadex_pages(session, chapter, rows)

        # Verify contiguous 1..N manifest integrity (READ-010 / READ-011)
        expected = list(range(1, len(rows) + 1))
        actual = [pg.page_number for pg, _ in rows]
        if actual != expected or (chapter.page_count > 0 and len(rows) != chapter.page_count):
            raise BusinessRuleError(
                "Chapter page manifest is incomplete or corrupted.",
                error_code="PAGE_MANIFEST_INVALID",
            )

        manifest: list[dict[str, Any]] = []
        for pg, media in rows:
            ref = MediaObjectRef(bucket=media.bucket, object_key=media.object_key)
            signed_url = self._container.media_signer.build_signed_proxy_url(
                ref, revision=chapter.pages_revision
            )
            manifest.append(
                {
                    "pageNumber": pg.page_number,
                    "pageUid": pg.page_uid,
                    "filename": pg.filename,
                    "width": media.width,
                    "height": media.height,
                    "contentType": media.content_type,
                    "url": signed_url,
                }
            )
        return manifest

    def _serialize_settings(self, row: ReaderSettingsModel | None) -> dict[str, Any]:
        if row is None:
            return {
                "displayMode": DisplayMode.VERTICAL_WEBTOON.value,
                "readingDirection": ReadingDirection.LTR.value,
                "fitMode": FitMode.FIT_WIDTH.value,
                "preloadPageCount": self._container.settings.reader_default_preload_pages,
            }
        return {
            "displayMode": row.display_mode,
            "readingDirection": row.reading_direction,
            "fitMode": row.fit_mode,
            "preloadPageCount": row.preload_page_count,
            "updatedAt": format_rfc3339(row.updated_at),
        }

    async def open_reader(
        self,
        session: AsyncSession,
        *,
        manga_ref: str,
        action_type: str,
        chapter_id: UUID | None,
        principal: SecurityPrincipal,
    ) -> dict[str, Any]:
        try:
            action = ReaderOpenAction(action_type.upper())
        except ValueError as exc:
            raise ValidationAppError("actionType must be START, CONTINUE, or SELECT.") from exc

        manga = await self._resolve_public_manga(session, manga_ref)
        chapters = await self._get_ordered_chapters(session, manga.manga_id)
        if not chapters:
            raise ResourceNotFoundError(
                "This manga does not have any readable chapters yet.",
                error_code="NO_CHAPTERS",
            )

        chapter_by_id = {c.chapter_id: c for c in chapters}
        chosen: ChapterModel | None = None
        initial_page = 1
        saved_page_uid: str | None = None
        resume_note: str | None = None

        if action == ReaderOpenAction.START:
            chosen = chapters[0]
            initial_page = 1
        elif action == ReaderOpenAction.CONTINUE:
            if principal.is_authenticated and principal.account_id is not None:
                prog = await session.get(
                    ReaderProgressModel, (principal.account_id, manga.manga_id)
                )
                if prog is not None and prog.chapter_id in chapter_by_id:
                    chosen = chapter_by_id[prog.chapter_id]
                    initial_page = prog.page_number
                    saved_page_uid = prog.page_uid
                else:
                    chosen = chapters[0]
            else:
                chosen = chapters[0]
        else:  # SELECT
            if chapter_id is None:
                raise ValidationAppError("chapterId is required when actionType=SELECT.")
            chosen = chapter_by_id.get(chapter_id)
            if chosen is None:
                raise ResourceNotFoundError(
                    "Chapter not found for this manga.",
                    error_code="CHAPTER_NOT_FOUND",
                )

        pages = await self._build_page_manifest(session, chosen)

        # Resolve page_uid first, else clamp page_number after pages_revision update (READ-026)
        if pages:
            if saved_page_uid:
                uid_match = next((p for p in pages if p["pageUid"] == saved_page_uid), None)
                if uid_match is not None:
                    initial_page = int(uid_match["pageNumber"])
                else:
                    clamped = max(1, min(initial_page, len(pages)))
                    if clamped != initial_page:
                        resume_note = "Chapter pages were revised; resumed at nearest page."
                    initial_page = clamped
            else:
                initial_page = max(1, min(initial_page, len(pages)))

        # Adjacent chapter navigation preferring same language
        same_lang = [c for c in chapters if c.language == chosen.language]
        nav_list = same_lang if len(same_lang) > 1 else chapters
        idx = next((i for i, c in enumerate(nav_list) if c.chapter_id == chosen.chapter_id), 0)
        prev_ch = nav_list[idx - 1] if idx > 0 else None
        next_ch = nav_list[idx + 1] if idx + 1 < len(nav_list) else None

        history_id: str | None = None
        settings_row: ReaderSettingsModel | None = None
        if principal.is_active_reader and principal.account_id is not None:
            now = utc_now()
            hist = ReadingHistoryModel(
                history_id=uuid4(),
                reader_account_id=principal.account_id,
                chapter_id=chosen.chapter_id,
                opened_at=now,
                last_read_at=now,
                reading_duration_seconds=0,
                is_valid_view=False,
            )
            session.add(hist)
            history_id = str(hist.history_id)

            prog_row = await session.get(
                ReaderProgressModel, (principal.account_id, manga.manga_id)
            )
            target_uid = pages[initial_page - 1]["pageUid"] if pages else None
            if prog_row is None:
                session.add(
                    ReaderProgressModel(
                        reader_account_id=principal.account_id,
                        manga_id=manga.manga_id,
                        chapter_id=chosen.chapter_id,
                        page_number=initial_page,
                        page_uid=target_uid,
                        pages_revision=chosen.pages_revision,
                        client_sequence=0,
                        updated_at=now,
                    )
                )
            elif action == ReaderOpenAction.SELECT or prog_row.chapter_id != chosen.chapter_id:
                prog_row.chapter_id = chosen.chapter_id
                prog_row.page_number = initial_page
                prog_row.page_uid = target_uid
                prog_row.pages_revision = chosen.pages_revision
                prog_row.updated_at = now

            settings_row = await session.scalar(
                select(ReaderSettingsModel).where(
                    ReaderSettingsModel.reader_account_id == principal.account_id
                )
            )
            append_activity_log(
                session,
                event_type="CHAPTER_OPENED",
                account_id=principal.account_id,
                target_type="CHAPTER",
                target_id=str(chosen.chapter_id),
                details={"manga_id": str(manga.manga_id), "action": action.value},
            )
            await session.commit()

        return {
            "manga": {"mangaId": str(manga.manga_id), "slug": manga.slug, "title": manga.title},
            "chapter": {
                "chapterId": str(chosen.chapter_id),
                "chapterNumber": chosen.chapter_number,
                "chapterNumeric": float(chosen.chapter_numeric),
                "volume": chosen.volume,
                "title": chosen.title,
                "language": chosen.language,
                "scanlationGroup": chosen.scanlation_group,
                "pagesRevision": chosen.pages_revision,
                "pageCount": len(pages),
            },
            "initialPage": initial_page,
            "resumeNote": resume_note,
            "pages": pages,
            "prevChapter": (
                {
                    "chapterId": str(prev_ch.chapter_id),
                    "chapterNumber": prev_ch.chapter_number,
                    "title": prev_ch.title,
                    "language": prev_ch.language,
                }
                if prev_ch
                else None
            ),
            "nextChapter": (
                {
                    "chapterId": str(next_ch.chapter_id),
                    "chapterNumber": next_ch.chapter_number,
                    "title": next_ch.title,
                    "language": next_ch.language,
                }
                if next_ch
                else None
            ),
            "historyId": history_id,
            "settings": self._serialize_settings(settings_row),
        }

    async def get_chapter_pages(self, session: AsyncSession, chapter_id: UUID) -> dict[str, Any]:
        chapter = await session.get(ChapterModel, chapter_id)
        if chapter is None:
            raise ResourceNotFoundError("Chapter not found.", error_code="CHAPTER_NOT_FOUND")
        manga = await session.get(MangaModel, chapter.manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")
        pages = await self._build_page_manifest(session, chapter)
        return {
            "chapterId": str(chapter.chapter_id),
            "mangaId": str(chapter.manga_id),
            "pagesRevision": chapter.pages_revision,
            "pages": pages,
        }

    async def upsert_progress(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        manga_id: UUID,
        chapter_id: UUID,
        page_number: int,
        page_uid: str | None,
        pages_revision: int,
        client_sequence: int,
    ) -> dict[str, Any]:
        """Persist exact resume page in `reader_progress` WITHOUT adding reading_histories rows."""
        assert principal.account_id is not None
        manga = await session.get(MangaModel, manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not available.", error_code="MANGA_NOT_FOUND")
        chapter = await session.get(ChapterModel, chapter_id)
        if chapter is None or chapter.manga_id != manga_id:
            raise ResourceNotFoundError(
                "Chapter does not belong to manga.", error_code="CHAPTER_NOT_FOUND"
            )
        if page_number < 1 or (chapter.page_count > 0 and page_number > chapter.page_count):
            raise ValidationAppError(
                f"pageNumber must be within 1..{max(chapter.page_count, 1)}.",
                details={"field": "pageNumber"},
            )

        now = utc_now()
        prog = await session.get(ReaderProgressModel, (principal.account_id, manga_id))
        if prog is not None:
            # Reject stale delayed client sequence from same chapter (READ-027)
            if (
                prog.chapter_id == chapter_id
                and client_sequence > 0
                and prog.client_sequence > client_sequence
            ):
                raise ConflictError(
                    "Stale progress update rejected.",
                    error_code="PROGRESS_CONFLICT",
                )
            prog.chapter_id = chapter_id
            prog.page_number = page_number
            prog.page_uid = page_uid
            prog.pages_revision = pages_revision
            prog.client_sequence = client_sequence
            prog.updated_at = now
        else:
            prog = ReaderProgressModel(
                reader_account_id=principal.account_id,
                manga_id=manga_id,
                chapter_id=chapter_id,
                page_number=page_number,
                page_uid=page_uid,
                pages_revision=pages_revision,
                client_sequence=client_sequence,
                updated_at=now,
            )
            session.add(prog)

        await session.commit()
        return {
            "mangaId": str(manga_id),
            "chapterId": str(chapter_id),
            "pageNumber": prog.page_number,
            "pageUid": prog.page_uid,
            "pagesRevision": prog.pages_revision,
            "clientSequence": prog.client_sequence,
            "updatedAt": format_rfc3339(prog.updated_at),
        }

    async def get_progress(
        self, session: AsyncSession, *, principal: SecurityPrincipal, manga_id: UUID
    ) -> dict[str, Any] | None:
        assert principal.account_id is not None
        prog = await session.get(ReaderProgressModel, (principal.account_id, manga_id))
        if prog is None:
            return None
        return {
            "mangaId": str(prog.manga_id),
            "chapterId": str(prog.chapter_id),
            "pageNumber": prog.page_number,
            "pageUid": prog.page_uid,
            "pagesRevision": prog.pages_revision,
            "updatedAt": format_rfc3339(prog.updated_at),
        }

    async def complete_view_session(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        history_id: UUID,
        duration_seconds: int,
    ) -> dict[str, Any]:
        """Mark valid view once threshold met & anti-F5 dedupe window passes (ADR-016)."""
        assert principal.account_id is not None
        hist = await session.get(ReadingHistoryModel, history_id)
        if hist is None:
            raise ResourceNotFoundError("Reading session not found.")
        if hist.reader_account_id != principal.account_id:
            raise ForbiddenError("Cannot modify another user's reading session.")

        now = utc_now()
        hist.reading_duration_seconds = max(hist.reading_duration_seconds, max(duration_seconds, 0))
        hist.last_read_at = now

        if hist.is_valid_view:
            await session.commit()
            return {"historyId": str(history_id), "isValidView": True, "alreadyCounted": True}

        threshold = self._container.settings.valid_view_threshold_seconds
        if hist.reading_duration_seconds < threshold:
            await session.commit()
            return {
                "historyId": str(history_id),
                "isValidView": False,
                "thresholdSeconds": threshold,
            }

        # Dedupe repeated F5 refreshes within configured window (READ-032)
        dedupe_window = self._container.settings.valid_view_dedupe_window_seconds
        if dedupe_window > 0:
            cutoff = now - timedelta(seconds=dedupe_window)
            recent_valid = await session.scalar(
                select(func.count())
                .select_from(ReadingHistoryModel)
                .where(
                    ReadingHistoryModel.reader_account_id == principal.account_id,
                    ReadingHistoryModel.chapter_id == hist.chapter_id,
                    ReadingHistoryModel.is_valid_view.is_(True),
                    ReadingHistoryModel.history_id != hist.history_id,
                    ReadingHistoryModel.opened_at >= cutoff,
                )
            )
            if (recent_valid or 0) > 0:
                await session.commit()
                return {
                    "historyId": str(history_id),
                    "isValidView": False,
                    "deduped": True,
                }

        hist.is_valid_view = True
        chapter = await session.get(ChapterModel, hist.chapter_id)
        if chapter is not None:
            chapter.view_count += 1
            manga = await session.get(MangaModel, chapter.manga_id)
            if manga is not None:
                manga.total_views += 1

        append_activity_log(
            session,
            event_type="VALID_VIEW_RECORDED",
            account_id=principal.account_id,
            target_type="CHAPTER",
            target_id=str(hist.chapter_id),
            details={"duration_seconds": hist.reading_duration_seconds},
        )
        await session.commit()
        return {"historyId": str(history_id), "isValidView": True, "alreadyCounted": False}

    async def get_settings(
        self, session: AsyncSession, *, principal: SecurityPrincipal
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        row = await session.scalar(
            select(ReaderSettingsModel).where(
                ReaderSettingsModel.reader_account_id == principal.account_id
            )
        )
        return self._serialize_settings(row)

    async def update_settings(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        display_mode: str,
        reading_direction: str,
        fit_mode: str,
        preload_page_count: int,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        try:
            dm = DisplayMode(display_mode)
            rd = ReadingDirection(reading_direction)
            fm = FitMode(fit_mode)
        except ValueError as exc:
            raise ValidationAppError("Invalid reader setting enum value.") from exc

        max_preload = self._container.settings.reader_max_preload_pages
        if preload_page_count < 0 or preload_page_count > max_preload:
            raise ValidationAppError(f"preloadPageCount must be 0..{max_preload}.")

        now = utc_now()
        row = await session.scalar(
            select(ReaderSettingsModel).where(
                ReaderSettingsModel.reader_account_id == principal.account_id
            )
        )
        if row is None:
            row = ReaderSettingsModel(
                reader_account_id=principal.account_id,
                display_mode=dm.value,
                reading_direction=rd.value,
                fit_mode=fm.value,
                preload_page_count=preload_page_count,
                updated_at=now,
            )
            session.add(row)
        else:
            row.display_mode = dm.value
            row.reading_direction = rd.value
            row.fit_mode = fm.value
            row.preload_page_count = preload_page_count
            row.updated_at = now
        await session.commit()
        return self._serialize_settings(row)

    async def get_history(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        page: int = 1,
        page_size: int = 24,
    ) -> tuple[list[dict[str, Any]], int]:
        assert principal.account_id is not None
        base = (
            select(ReadingHistoryModel, ChapterModel, MangaModel)
            .join(ChapterModel, ChapterModel.chapter_id == ReadingHistoryModel.chapter_id)
            .join(MangaModel, MangaModel.manga_id == ChapterModel.manga_id)
            .where(
                ReadingHistoryModel.reader_account_id == principal.account_id,
                MangaModel.visibility_status == "PUBLIC",
                MangaModel.deletion_status == "ACTIVE",
            )
        )
        total = int(await session.scalar(select(func.count()).select_from(base.subquery())) or 0)
        rows = (
            await session.execute(
                base.order_by(ReadingHistoryModel.opened_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()

        manga_ids = list({m.manga_id for _, _, m in rows})
        progress_map: dict[UUID, ReaderProgressModel] = {}
        if manga_ids:
            progs = (
                await session.scalars(
                    select(ReaderProgressModel).where(
                        ReaderProgressModel.reader_account_id == principal.account_id,
                        ReaderProgressModel.manga_id.in_(manga_ids),
                    )
                )
            ).all()
            progress_map = {p.manga_id: p for p in progs}

        items: list[dict[str, Any]] = []
        for hist, ch, manga in rows:
            prog = progress_map.get(manga.manga_id)
            items.append(
                {
                    "historyId": str(hist.history_id),
                    "mangaId": str(manga.manga_id),
                    "mangaSlug": manga.slug,
                    "mangaTitle": manga.title,
                    "chapterId": str(ch.chapter_id),
                    "chapterNumber": ch.chapter_number,
                    "chapterTitle": ch.title,
                    "openedAt": format_rfc3339(hist.opened_at),
                    "readingDurationSeconds": hist.reading_duration_seconds,
                    "isValidView": hist.is_valid_view,
                    "resumePageNumber": prog.page_number if prog else 1,
                    "resumeChapterId": str(prog.chapter_id) if prog else str(ch.chapter_id),
                }
            )
        return items, total

    async def set_reading_status(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        manga_id: UUID,
        status: str,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        try:
            rs_enum = ReadingStatus(status.upper())
        except ValueError as exc:
            raise ValidationAppError("Invalid reading status enum.") from exc

        manga = await session.get(MangaModel, manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        now = utc_now()
        row = await session.scalar(
            select(ReadingStatusRecordModel).where(
                ReadingStatusRecordModel.reader_account_id == principal.account_id,
                ReadingStatusRecordModel.manga_id == manga_id,
            )
        )
        if row is None:
            row = ReadingStatusRecordModel(
                reader_account_id=principal.account_id,
                manga_id=manga_id,
                status=rs_enum.value,
                updated_at=now,
            )
            session.add(row)
        else:
            row.status = rs_enum.value
            row.updated_at = now
        append_activity_log(
            session,
            event_type="READING_STATUS_CHANGED",
            account_id=principal.account_id,
            target_type="MANGA",
            target_id=str(manga_id),
            details={"status": rs_enum.value},
        )
        await session.commit()
        return {
            "mangaId": str(manga_id),
            "status": row.status,
            "updatedAt": format_rfc3339(row.updated_at),
        }

    async def clear_reading_status(
        self, session: AsyncSession, *, principal: SecurityPrincipal, manga_id: UUID
    ) -> dict[str, bool]:
        assert principal.account_id is not None
        await session.execute(
            delete(ReadingStatusRecordModel).where(
                ReadingStatusRecordModel.reader_account_id == principal.account_id,
                ReadingStatusRecordModel.manga_id == manga_id,
            )
        )
        await session.commit()
        return {"cleared": True}

    async def list_my_reading_statuses(
        self, session: AsyncSession, *, principal: SecurityPrincipal
    ) -> list[dict[str, Any]]:
        assert principal.account_id is not None
        rows = (
            await session.execute(
                select(ReadingStatusRecordModel, MangaModel)
                .join(MangaModel, MangaModel.manga_id == ReadingStatusRecordModel.manga_id)
                .where(
                    ReadingStatusRecordModel.reader_account_id == principal.account_id,
                    MangaModel.visibility_status == "PUBLIC",
                    MangaModel.deletion_status == "ACTIVE",
                )
                .order_by(ReadingStatusRecordModel.updated_at.desc())
            )
        ).all()
        return [
            {
                "mangaId": str(m.manga_id),
                "slug": m.slug,
                "title": m.title,
                "status": rs.status,
                "updatedAt": format_rfc3339(rs.updated_at),
            }
            for rs, m in rows
        ]
