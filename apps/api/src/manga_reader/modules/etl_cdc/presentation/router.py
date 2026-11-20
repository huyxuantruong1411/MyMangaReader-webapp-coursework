"""FastAPI routes for Module 4 (`etl_cdc`) and Module 2 Admin Manga Lifecycle."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from manga_reader.api.v1.dependencies import get_admin_principal, get_container
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.etl_cdc.application.service import EtlCdcService
from manga_reader.modules.manga_creator.application.service import MangaLifecycleService

router = APIRouter(tags=["Admin ETL, CDC & Manga Management"])


class EtlBatchItemInput(BaseModel):
    sourceMangaId: str | None = None
    poolMangaId: str | None = None
    enableCdc: bool = False
    packagePayload: dict[str, Any] | None = None


class EtlBatchSyncRequest(BaseModel):
    items: list[EtlBatchItemInput] = Field(min_length=1)
    sourceSystem: str = "local-sample-upstream"


class MangaModerationReasonRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class MangaShowRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


@router.get("/admin/external-sources", response_model=SuccessEnvelope[list[dict[str, Any]]])
async def list_external_sources(
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = EtlCdcService(container)
    return SuccessEnvelope(data=await svc.list_external_sources())


@router.post("/admin/etl-sync", status_code=202, response_model=SuccessEnvelope[dict[str, Any]])
async def create_etl_sync_job(
    body: EtlBatchSyncRequest,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = EtlCdcService(container)
    result = await svc.create_and_execute_batch_job(
        admin_principal=admin,
        items=[it.model_dump() for it in body.items],
        source_system=body.sourceSystem,
    )
    return SuccessEnvelope(data=result)


@router.get("/admin/etl-jobs", response_model=PaginatedEnvelope[dict[str, Any]])
async def list_etl_jobs(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = EtlCdcService(container)
    async with container.db.session() as db:
        items, total = await svc.list_jobs(db, status=status, page=pg.page, page_size=pg.page_size)
    return PaginatedEnvelope(
        data=items,
        meta=PaginatedMeta(
            page=pg.page,
            page_size=pg.page_size,
            total=total,
            has_next=(pg.page * pg.page_size) < total,
        ),
    )


@router.get("/admin/etl-jobs/{job_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def get_etl_job_detail(
    job_id: UUID,
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = EtlCdcService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.get_job_detail(db, job_id))


@router.post(
    "/admin/etl-job-items/{job_item_id}/retry",
    status_code=202,
    response_model=SuccessEnvelope[dict[str, Any]],
)
async def retry_etl_job_item(
    job_item_id: UUID,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = EtlCdcService(container)
    return SuccessEnvelope(
        data=await svc.retry_job_item(admin_principal=admin, job_item_id=job_item_id)
    )


@router.post("/admin/manga/{manga_id}/cdc/enable", response_model=SuccessEnvelope[dict[str, Any]])
async def enable_manga_cdc(
    manga_id: UUID,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = EtlCdcService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.toggle_cdc(db, admin_principal=admin, manga_id=manga_id, enable=True)
        )


@router.post("/admin/manga/{manga_id}/cdc/disable", response_model=SuccessEnvelope[dict[str, Any]])
async def disable_manga_cdc(
    manga_id: UUID,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = EtlCdcService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.toggle_cdc(db, admin_principal=admin, manga_id=manga_id, enable=False)
        )


@router.post("/webhooks/cdc", status_code=202, response_model=SuccessEnvelope[dict[str, Any]])
async def receive_cdc_webhook(
    request: Request,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    raw = await request.body()
    sig = request.headers.get("X-CDC-Signature")
    svc = EtlCdcService(container)
    async with container.db.session() as db:
        result = await svc.receive_cdc_event(db, raw_body=raw, signature_header=sig)
    return SuccessEnvelope(data=result)


@router.get("/admin/manga", response_model=PaginatedEnvelope[dict[str, Any]])
async def admin_list_manga(
    q: str | None = Query(default=None),
    visibility: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, alias="pageSize", ge=1, le=100),
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = MangaLifecycleService()
    async with container.db.session() as db:
        items, total = await svc.admin_list_manga(
            db, q=q, visibility=visibility, page=pg.page, page_size=pg.page_size
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


@router.post("/admin/manga/{manga_id}/hide", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_hide_manga(
    manga_id: UUID,
    body: MangaModerationReasonRequest,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = MangaLifecycleService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.hide_manga(
                db, admin_principal=admin, manga_id=manga_id, reason=body.reason
            )
        )


@router.post("/admin/manga/{manga_id}/show", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_show_manga(
    manga_id: UUID,
    body: MangaShowRequest | None = None,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = MangaLifecycleService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.show_manga(
                db,
                admin_principal=admin,
                manga_id=manga_id,
                reason=body.reason if body else None,
            )
        )


@router.post("/admin/manga/{manga_id}/delete", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_delete_manga(
    manga_id: UUID,
    body: MangaModerationReasonRequest,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = MangaLifecycleService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.delete_manga(
                db, admin_principal=admin, manga_id=manga_id, reason=body.reason
            )
        )
