"""FastAPI routes for Module 7 (`ratings`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from manga_reader.api.v1.dependencies import (
    get_active_reader_principal,
    get_container,
    get_current_principal,
)
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.ratings.application.service import RatingService

router = APIRouter(tags=["Ratings"])


class RateMangaRequest(BaseModel):
    score: int


@router.get("/manga/{manga_id}/rating", response_model=SuccessEnvelope[dict[str, Any]])
async def get_manga_rating(
    manga_id: UUID,
    viewer: SecurityPrincipal = Depends(get_current_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = RatingService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_manga_rating(db, manga_id=manga_id, viewer=viewer)
        )


@router.put("/manga/{manga_id}/rating", response_model=SuccessEnvelope[dict[str, Any]])
async def upsert_manga_rating(
    manga_id: UUID,
    body: RateMangaRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = RatingService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.upsert_rating(
                db, principal=principal, manga_id=manga_id, score=body.score
            )
        )


@router.delete("/manga/{manga_id}/rating", response_model=SuccessEnvelope[dict[str, Any]])
async def delete_manga_rating(
    manga_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = RatingService()
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.remove_rating(db, principal=principal, manga_id=manga_id)
        )


@router.get("/account/me/rating-history", response_model=PaginatedEnvelope[dict[str, Any]])
async def get_my_rating_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, alias="pageSize", ge=1, le=100),
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = RatingService(container)
    async with container.db.session() as db:
        items, total = await svc.list_my_rating_history(
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
