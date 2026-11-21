"""FastAPI routes for Module 5 (`reader_engine`), Module 6 (`reading_status_history`) & Media Proxy."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from manga_reader.api.v1.dependencies import (
    get_active_reader_principal,
    get_container,
    get_current_principal,
)
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.errors import ForbiddenError, StorageUnavailableError
from manga_reader.common.identities import MediaObjectRef
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import ChapterModel, MangaModel
from manga_reader.modules.etl_cdc.infrastructure.sample_upstream import render_placeholder_webp
from manga_reader.modules.reader_engine.application.service import ReaderService
from manga_reader.modules.reader_engine.infrastructure.mangadex_fallback import (
    _pick_accent_rgb,
    fetch_mangadex_at_home,
    fetch_remote_image_bytes,
    is_mangadex_uuid,
    render_manga_demo_page_webp,
)

router = APIRouter(tags=["Reader Engine, Progress, Status & Media"])


class SaveProgressRequest(BaseModel):
    mangaId: UUID
    chapterId: UUID
    pageNumber: int = Field(ge=1)
    pageUid: str | None = None
    pagesRevision: int = Field(default=1, ge=1)
    clientSequence: int = Field(default=0, ge=0)


class CompleteViewRequest(BaseModel):
    durationSeconds: int = Field(ge=0)


class ReaderSettingsRequest(BaseModel):
    displayMode: str
    readingDirection: str
    fitMode: str
    preloadPageCount: int = Field(default=3, ge=0)


class ReadingStatusRequest(BaseModel):
    status: str


@router.get("/reader/open", response_model=SuccessEnvelope[dict[str, Any]])
async def open_reader(
    manga_id: str = Query(alias="mangaId"),
    action_type: str = Query(default="START", alias="actionType"),
    chapter_id: UUID | None = Query(default=None, alias="chapterId"),
    principal: SecurityPrincipal = Depends(get_current_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        result = await svc.open_reader(
            db,
            manga_ref=manga_id,
            action_type=action_type,
            chapter_id=chapter_id,
            principal=principal,
        )
    return SuccessEnvelope(data=result)


@router.get("/chapters/{chapter_id}/pages", response_model=SuccessEnvelope[dict[str, Any]])
async def get_chapter_pages(
    chapter_id: UUID,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.get_chapter_pages(db, chapter_id))


@router.put("/reader/progress", response_model=SuccessEnvelope[dict[str, Any]])
async def save_reader_progress(
    body: SaveProgressRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        result = await svc.upsert_progress(
            db,
            principal=principal,
            manga_id=body.mangaId,
            chapter_id=body.chapterId,
            page_number=body.pageNumber,
            page_uid=body.pageUid,
            pages_revision=body.pagesRevision,
            client_sequence=body.clientSequence,
        )
    return SuccessEnvelope(data=result)


@router.get("/reader/progress/{manga_id}", response_model=SuccessEnvelope[dict[str, Any] | None])
async def get_reader_progress(
    manga_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any] | None]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_progress(db, principal=principal, manga_id=manga_id)
        )


@router.post(
    "/reader/view-session/{history_id}/complete",
    response_model=SuccessEnvelope[dict[str, Any]],
)
async def complete_view_session(
    history_id: UUID,
    body: CompleteViewRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        result = await svc.complete_view_session(
            db,
            principal=principal,
            history_id=history_id,
            duration_seconds=body.durationSeconds,
        )
    return SuccessEnvelope(data=result)


@router.get("/reader/settings", response_model=SuccessEnvelope[dict[str, Any]])
async def get_reader_settings(
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.get_settings(db, principal=principal))


@router.put("/reader/settings", response_model=SuccessEnvelope[dict[str, Any]])
async def update_reader_settings(
    body: ReaderSettingsRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        result = await svc.update_settings(
            db,
            principal=principal,
            display_mode=body.displayMode,
            reading_direction=body.readingDirection,
            fit_mode=body.fitMode,
            preload_page_count=body.preloadPageCount,
        )
    return SuccessEnvelope(data=result)


@router.get("/reader/history", response_model=PaginatedEnvelope[dict[str, Any]])
async def get_reading_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, alias="pageSize", ge=1, le=100),
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = ReaderService(container)
    async with container.db.session() as db:
        items, total = await svc.get_history(
            db, principal=principal, page=pg.page, page_size=pg.page_size
        )
    return PaginatedEnvelope(
        data=items,
        meta=PaginatedMeta(
            page=pg.page,
            page_size=pg.page_size,
            total=total,
            has_next=(pg.page * pg.page_size) < total,
        ),
    )


@router.put("/manga/{manga_id}/reading-status", response_model=SuccessEnvelope[dict[str, Any]])
async def set_reading_status(
    manga_id: UUID,
    body: ReadingStatusRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.set_reading_status(
                db, principal=principal, manga_id=manga_id, status=body.status
            )
        )


@router.delete("/manga/{manga_id}/reading-status", response_model=SuccessEnvelope[dict[str, bool]])
async def clear_reading_status(
    manga_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, bool]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.clear_reading_status(db, principal=principal, manga_id=manga_id)
        )


@router.get("/account/me/reading-status", response_model=SuccessEnvelope[list[dict[str, Any]]])
async def list_my_reading_statuses(
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = ReaderService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.list_my_reading_statuses(db, principal=principal))


async def _resolve_lazy_cover(
    container: AppContainer,
    ref: MediaObjectRef,
) -> tuple[bytes, str] | None:
    """Resolve missing cover objects in-memory via MangaDex cover CDN or WebP fallback (zero disk copy)."""
    if not ref.object_key.startswith("covers/"):
        return None
    parts = ref.object_key.split("/")
    manga_uuid: UUID | None = None
    filename = parts[-1] if parts else ""
    if len(parts) == 3:
        try:
            manga_uuid = UUID(parts[1])
        except ValueError:
            manga_uuid = None
    elif len(parts) == 4 and parts[1] == "local":
        try:
            manga_uuid = UUID(parts[2])
        except ValueError:
            manga_uuid = None

    if (
        len(parts) == 3
        and manga_uuid is not None
        and not filename.startswith("cover.")
        and container.settings.mangadex_fallback_enabled
    ):
        for candidate in (
            f"https://uploads.mangadex.org/covers/{manga_uuid}/{filename}.256.jpg",
            f"https://uploads.mangadex.org/covers/{manga_uuid}/{filename}",
        ):
            fetched = await fetch_remote_image_bytes(candidate)
            if fetched is not None:
                return fetched

    manga_title = "Manga Library"
    subtitle = "CATALOG COVER"
    if manga_uuid is not None:
        async with container.db.session() as db:
            manga = await db.get(MangaModel, manga_uuid)
            if manga is not None:
                manga_title = manga.title
                subtitle = (
                    f"{manga.publication_demographic.upper()} | {manga.publication_status.upper()}"
                )

    raw, _, _ = render_placeholder_webp(
        title=manga_title,
        subtitle=subtitle,
        accent_rgb=_pick_accent_rgb(manga_title),
        width=600,
        height=860,
    )
    return raw, "image/webp"


async def _resolve_lazy_chapter_page(
    container: AppContainer,
    ref: MediaObjectRef,
) -> tuple[bytes, str] | None:
    """Resolve `covers/` / `mangadex-cache/` / `demo-pages/` in-memory (no local disk bloat under MinIO)."""
    if ref.object_key.startswith("covers/"):
        return await _resolve_lazy_cover(container, ref)
    if ref.object_key.startswith("avatars/"):
        raw, _, _ = render_placeholder_webp(
            title="Reader",
            subtitle="AVATAR",
            accent_rgb=(56, 189, 248),
            width=256,
            height=256,
        )
        return raw, "image/webp"

    parts = ref.object_key.split("/")
    if len(parts) != 3 or parts[0] not in ("mangadex-cache", "demo-pages"):
        return None
    prefix, chapter_id_raw, filename = parts
    try:
        ch_uuid = UUID(chapter_id_raw)
        page_num = int(filename.split(".", 1)[0])
    except (ValueError, IndexError):
        return None

    is_local_dev = container.settings.storage_backend == "local-dev"

    # 1. Try MangaDex live CDN proxy (disk-cached only in local-dev mode)
    if prefix == "mangadex-cache" and container.settings.mangadex_fallback_enabled:
        remote_url = await container.cache.get(f"mdex:page:{ch_uuid}:{page_num:03d}")
        if remote_url is None:
            async with container.db.session() as db:
                ch = await db.get(ChapterModel, ch_uuid)
                if ch is not None and is_mangadex_uuid(ch.source_chapter_id):
                    assert ch.source_chapter_id is not None
                    remote_pages = await fetch_mangadex_at_home(
                        ch.source_chapter_id,
                        cache=container.cache,
                        use_data_saver=container.settings.mangadex_data_saver,
                    )
                    if remote_pages and 1 <= page_num <= len(remote_pages):
                        remote_url = remote_pages[page_num - 1]["remote_url"]
                        await container.cache.set(
                            f"mdex:page:{ch_uuid}:{page_num:03d}", remote_url, ttl_seconds=1200
                        )
        if remote_url:
            fetched = await fetch_remote_image_bytes(remote_url)
            if fetched is not None:
                raw_bytes, ct = fetched
                if is_local_dev:
                    await container.storage.put_bytes(ref, raw_bytes, content_type=ct)
                return raw_bytes, ct

    # 2. Render crisp illustrated fallback WebP page using chapter/manga metadata
    manga_title = "Manga Reader"
    ch_number = "1"
    ch_title = ""
    language = "en"
    total_pages = max(page_num, 6)
    async with container.db.session() as db:
        ch = await db.get(ChapterModel, ch_uuid)
        if ch is not None:
            ch_number = ch.chapter_number
            ch_title = ch.title or ""
            language = ch.language
            total_pages = max(ch.page_count, page_num, 1)
            manga = await db.get(MangaModel, ch.manga_id)
            if manga is not None:
                manga_title = manga.title

    demo_bytes = render_manga_demo_page_webp(
        manga_title=manga_title,
        chapter_number=ch_number,
        chapter_title=ch_title,
        language=language,
        page_number=page_num,
        total_pages=total_pages,
    )
    if prefix == "demo-pages" and is_local_dev:
        await container.storage.put_bytes(ref, demo_bytes, content_type="image/webp")
    return demo_bytes, "image/webp"


@router.get("/media/{bucket}/{object_key:path}")
async def stream_signed_media(
    bucket: str,
    object_key: str,
    exp: int = Query(...),
    sig: str = Query(...),
    rev: int | None = Query(default=None),
    container: AppContainer = Depends(get_container),
) -> Response:
    """Verify runtime HMAC signature and stream canonical `(bucket, object_key)` bytes (ADR-018)."""
    try:
        ref = MediaObjectRef(bucket=bucket, object_key=object_key)
    except ValueError as exc:
        raise ForbiddenError("Invalid media object locator.", error_code="MEDIA_FORBIDDEN") from exc

    if not container.media_signer.verify_signed_proxy_url(ref, exp=exp, sig=sig, revision=rev):
        raise ForbiddenError("Media signature invalid or expired.", error_code="MEDIA_FORBIDDEN")

    mime_override: str | None = None
    try:
        data = await container.storage.get_bytes(ref)
    except StorageUnavailableError:
        resolved = await _resolve_lazy_chapter_page(container, ref)
        if resolved is None:
            raise
        data, mime_override = resolved

    ext = object_key.rsplit(".", 1)[-1].lower() if "." in object_key else ""
    mime_map = {
        "webp": "image/webp",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
    }
    return Response(
        content=data,
        media_type=mime_override or mime_map.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=300"},
    )
