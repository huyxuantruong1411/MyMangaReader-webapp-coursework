"""Root `/api/v1` router mounting all 12 domain module HTTP surfaces."""

from __future__ import annotations

from fastapi import APIRouter

from manga_reader.api.v1.health import router as health_router
from manga_reader.modules.account_auth.presentation.router import router as account_auth_router
from manga_reader.modules.admin_analytics.presentation.router import (
    router as admin_analytics_router,
)
from manga_reader.modules.catalog_discovery.presentation.router import router as catalog_router
from manga_reader.modules.comments_reactions.presentation.router import router as comments_router
from manga_reader.modules.etl_cdc.presentation.router import router as etl_cdc_router
from manga_reader.modules.moderation_reporting.presentation.router import (
    router as moderation_router,
)
from manga_reader.modules.ratings.presentation.router import router as ratings_router
from manga_reader.modules.reader_engine.presentation.router import router as reader_router
from manga_reader.modules.reading_lists.presentation.router import router as reading_lists_router
from manga_reader.modules.recommendations.presentation.router import (
    router as recommendations_router,
)

api_v1_router = APIRouter()
api_v1_router.include_router(health_router)
api_v1_router.include_router(account_auth_router)
api_v1_router.include_router(etl_cdc_router)
api_v1_router.include_router(catalog_router)
api_v1_router.include_router(reader_router)
api_v1_router.include_router(ratings_router)
api_v1_router.include_router(comments_router)
api_v1_router.include_router(reading_lists_router)
api_v1_router.include_router(moderation_router)
api_v1_router.include_router(admin_analytics_router)
api_v1_router.include_router(recommendations_router)
