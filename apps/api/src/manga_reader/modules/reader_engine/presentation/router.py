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
from manga_reader.common.errors import ForbiddenError
from manga_reader.common.identities import MediaObjectRef
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.reader_engine.application.service import ReaderService

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

    data = await container.storage.get_bytes(ref)
    ext = object_key.rsplit(".", 1)[-1].lower() if "." in object_key else ""
    mime_map = {
        "webp": "image/webp",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
    }
    return Response(
        content=data,
        media_type=mime_map.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=300"},
    )
