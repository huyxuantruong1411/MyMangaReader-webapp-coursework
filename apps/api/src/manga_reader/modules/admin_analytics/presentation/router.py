"""FastAPI routes for Module 12 (`admin_analytics`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from manga_reader.api.v1.dependencies import (
    get_active_reader_principal,
    get_admin_principal,
    get_container,
)
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.admin_analytics.application.service import AdminAnalyticsService

router = APIRouter(tags=["Admin Analytics & Activity Logs"])


@router.get("/account/me/reading-statistics", response_model=SuccessEnvelope[dict[str, Any]])
async def get_my_reading_statistics(
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    assert principal.account_id is not None
    svc = AdminAnalyticsService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_reader_statistics(db, reader_account_id=principal.account_id)
        )


@router.get("/admin/activity-logs", response_model=PaginatedEnvelope[dict[str, Any]])
async def admin_list_all_activity_logs(
    account_id: UUID | None = Query(default=None, alias="accountId"),
    event_type: str | None = Query(default=None, alias="eventType"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, alias="pageSize", ge=1, le=100),
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = AdminAnalyticsService()
    async with container.db.session() as db:
        items, total = await svc.query_activity_logs(
            db, account_id=account_id, event_type=event_type, page=pg.page, page_size=pg.page_size
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


@router.get(
    "/admin/accounts/{account_id}/activity-logs",
    response_model=PaginatedEnvelope[dict[str, Any]],
)
async def admin_list_account_activity_logs(
    account_id: UUID,
    event_type: str | None = Query(default=None, alias="eventType"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, alias="pageSize", ge=1, le=100),
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = AdminAnalyticsService()
    async with container.db.session() as db:
        items, total = await svc.query_activity_logs(
            db, account_id=account_id, event_type=event_type, page=pg.page, page_size=pg.page_size
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


@router.get(
    "/admin/accounts/{account_id}/reading-statistics",
    response_model=SuccessEnvelope[dict[str, Any]],
)
async def admin_get_reader_statistics(
    account_id: UUID,
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AdminAnalyticsService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_reader_statistics(db, reader_account_id=account_id)
        )


@router.get("/admin/manga/statistics", response_model=SuccessEnvelope[dict[str, Any]])
async def admin_manga_statistics(
    tag: str | None = Query(default=None),
    manga_id: UUID | None = Query(default=None, alias="mangaId"),
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = AdminAnalyticsService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_manga_interaction_statistics(db, tag=tag, manga_id=manga_id)
        )


@router.post("/admin/reconcile", response_model=SuccessEnvelope[dict[str, int]])
async def admin_reconcile_counters(
    _admin: SecurityPrincipal = Depends(get_admin_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, int]]:
    svc = AdminAnalyticsService()
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.reconcile_counters(db))
