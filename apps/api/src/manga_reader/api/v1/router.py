"""Root `/api/v1` router aggregating foundation and future module routers."""

from __future__ import annotations

from fastapi import APIRouter

from manga_reader.api.v1.health import router as health_router

api_v1_router = APIRouter()
api_v1_router.include_router(health_router)

# Future roadmap routers mount cleanly here per 13_IMPLEMENTATION_ROADMAP.md:
# - Phase 2: account_auth (`/auth`, `/account`, `/accounts`, `/admin/accounts`)
# - Phase 3-4: etl_cdc & manga_creator (`/admin/external-sources`, `/admin/etl-sync`,
#   `/admin/manga`)
# - Phase 5: catalog_discovery (`/manga`, `/creators`)
# - Phase 6: reader_engine (`/reader`, `/chapters`)
# - Phase 7: reading_status_history, ratings, comments_reactions, moderation_reporting
# - Phase 8: reading_lists (`/lists`)
# - Phase 9: moderation_reporting & admin_analytics (`/admin/reports`, `/admin/manga/statistics`)
# - Phase 10: recommendations (`/recommendations`)
