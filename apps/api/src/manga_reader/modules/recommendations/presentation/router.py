"""FastAPI routes for Module 11 (`recommendations`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from manga_reader.api.v1.dependencies import get_active_reader_principal, get_container
from manga_reader.api.v1.envelopes import SuccessEnvelope
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.recommendations.application.service import RecommendationService

router = APIRouter(tags=["Recommendations"])


@router.get("/manga/{manga_id}/recommendations", response_model=SuccessEnvelope[dict[str, Any]])
async def get_manga_recommendations(
    manga_id: UUID,
    rec_type: str = Query(default="ITEM_BASED", alias="type"),
    limit: int = Query(default=6, ge=1, le=24),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = RecommendationService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.recommend_for_manga(
                db, manga_id=manga_id, rec_type=rec_type, limit=limit
            )
        )


@router.get("/recommendations/me", response_model=SuccessEnvelope[dict[str, Any]])
async def get_my_recommendations(
    limit: int = Query(default=6, ge=1, le=24),
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = RecommendationService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.recommend_user_based(db, principal=principal, limit=limit)
        )
