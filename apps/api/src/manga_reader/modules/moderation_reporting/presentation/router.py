"""FastAPI routes for Module 9 (`moderation_reporting`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from manga_reader.api.v1.dependencies import (
    get_active_reader_principal,
    get_admin_principal,
    get_container,
)
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.moderation_reporting.application.service import (
    ModerationReportingService,
)

router = APIRouter(tags=["Moderation & Reporting"])


class AccountReportRequest(BaseModel):
    targetAccountId: UUID
    reasonCategory: str
    description: str | None = None


class MangaReportRequest(BaseModel):
    targetMangaId: UUID
    targetChapterId: UUID | None = None
    reasonCategory: str
    description: str | None = None


class CommentReportRequest(BaseModel):
    targetCommentId: UUID
    reasonCategory: str
    description: str | None = None


class ResolveReportRequest(BaseModel):
    actionType: str
    note: str
    ignoreFutureReports: bool = False


@router.post("/reports/account", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def report_account(
    body: AccountReportRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ModerationReportingService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.submit_account_report(
                db,
                principal=principal,
                target_account_id=body.targetAccountId,
                reason_category=body.reasonCategory,
                description=body.description,
            )
        )


@router.post("/reports/manga", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def report_manga(
    body: MangaReportRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ModerationReportingService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.submit_manga_report(
                db,
                principal=principal,
                target_manga_id=body.targetMangaId,
                target_chapter_id=body.targetChapterId,
                reason_category=body.reasonCategory,
                description=body.description,
            )
        )


@router.post("/reports/comment", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def report_comment(
    body: CommentReportRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ModerationReportingService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.submit_comment_report(
                db,
                principal=principal,
                target_comment_id=body.targetCommentId,
                reason_category=body.reasonCategory,
                description=body.description,
            )
        )


@router.get("/admin/reports", response_model=PaginatedEnvelope[dict[str, Any]])
async def admin_list_reports(
    report_type: str | None = Query(default=None, alias="reportType"),
    status: str | None = Query(default="PENDING"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = ModerationReportingService(container)
    async with container.db.session() as db:
        items, total = await svc.admin_list_reports(
            db,
            report_type=report_type,
            status=status,
            page=pg.page,
            page_size=pg.page_size,
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


@router.get("/admin/reports/{report_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_get_report_detail(
    report_id: UUID,
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ModerationReportingService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.admin_get_report_detail(db, report_id=report_id))


@router.post("/admin/reports/{report_id}/resolve", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_resolve_report(
    report_id: UUID,
    body: ResolveReportRequest,
    admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ModerationReportingService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.admin_resolve_report(
                db,
                admin_principal=admin,
                report_id=report_id,
                action_type=body.actionType,
                note=body.note,
                ignore_future_reports=body.ignoreFutureReports,
            )
        )
