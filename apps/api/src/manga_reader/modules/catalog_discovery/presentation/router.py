"""FastAPI routes for Module 3 (`catalog_discovery`)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from manga_reader.api.v1.dependencies import get_container, get_current_principal
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.catalog_discovery.application.service import CatalogDiscoveryService

router = APIRouter(tags=["Catalog & Discovery"])


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


@router.get("/tags", response_model=SuccessEnvelope[list[dict[str, Any]]])
async def list_tags(
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.list_tags(db))


@router.get("/manga", response_model=PaginatedEnvelope[dict[str, Any]])
async def list_public_catalog(
    sort: str = Query(default="UPDATED_DESC"),
    include_tags: str | None = Query(default=None, alias="includeTags"),
    exclude_tags: str | None = Query(default=None, alias="excludeTags"),
    tag_mode: str = Query(default="GROUP_OR", alias="tagMode"),
    demographic: str | None = Query(default=None),
    status: str | None = Query(default=None),
    content_rating: str | None = Query(default=None, alias="contentRating"),
    language: str | None = Query(default=None),
    year_from: int | None = Query(default=None, alias="yearFrom"),
    year_to: int | None = Query(default=None, alias="yearTo"),
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, alias="pageSize"),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(
        page=page,
        page_size=page_size,
        default_page_size=container.settings.catalog_default_page_size,
        max_page_size=container.settings.catalog_max_page_size,
    )
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        items, total = await svc.list_catalog(
            db,
            sort=sort,
            include_tags=_split_csv(include_tags),
            exclude_tags=_split_csv(exclude_tags),
            tag_mode=tag_mode,
            demographic=demographic,
            status=status,
            content_rating=_split_csv(content_rating),
            language=language,
            year_from=year_from,
            year_to=year_to,
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


@router.get("/manga/autocomplete", response_model=SuccessEnvelope[list[dict[str, Any]]])
async def autocomplete_catalog(
    q: str = Query(default=""),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.autocomplete(db, q=q))


@router.get("/manga/search", response_model=PaginatedEnvelope[dict[str, Any]])
async def search_manga(
    q: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, alias="pageSize"),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(
        page=page,
        page_size=page_size,
        default_page_size=container.settings.catalog_default_page_size,
        max_page_size=container.settings.catalog_max_page_size,
    )
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        items, total = await svc.search_manga(db, q=q, page=pg.page, page_size=pg.page_size)
    return PaginatedEnvelope(
        data=items,
        meta=PaginatedMeta(
            page=pg.page,
            page_size=pg.page_size,
            total=total,
            has_next=(pg.page * pg.page_size) < total,
        ),
    )


@router.get("/creators/search", response_model=SuccessEnvelope[list[dict[str, Any]]])
async def search_creators(
    q: str = Query(default=""),
    role: str | None = Query(default=None),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.search_creators(db, q=q, role=role))


@router.get("/creators/{creator_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def get_creator_detail(
    creator_id: str,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.get_creator_detail(db, creator_id))


@router.get("/creators/{creator_id}/manga", response_model=PaginatedEnvelope[dict[str, Any]])
async def list_creator_works(
    creator_id: str,
    tag: str | None = Query(default=None),
    status: str | None = Query(default=None),
    sort: str = Query(default="UPDATED_DESC"),
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, alias="pageSize"),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(
        page=page,
        page_size=page_size,
        default_page_size=container.settings.catalog_default_page_size,
        max_page_size=container.settings.catalog_max_page_size,
    )
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        items, total = await svc.list_creator_manga(
            db,
            creator_id=creator_id,
            tag=tag,
            status=status,
            sort=sort,
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


@router.get("/manga/{manga_id_or_slug}", response_model=SuccessEnvelope[dict[str, Any]])
async def get_manga_detail(
    manga_id_or_slug: str,
    viewer: SecurityPrincipal = Depends(get_current_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_manga_detail(db, manga_id_or_slug=manga_id_or_slug, viewer=viewer)
        )


@router.get(
    "/manga/{manga_id_or_slug}/chapters", response_model=SuccessEnvelope[list[dict[str, Any]]]
)
async def list_manga_chapters(
    manga_id_or_slug: str,
    language: str | None = Query(default=None),
    volume: str | None = Query(default=None),
    order: str = Query(default="ASC"),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = CatalogDiscoveryService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.list_manga_chapters(
                db,
                manga_id_or_slug=manga_id_or_slug,
                language=language,
                volume=volume,
                order=order,
            )
        )
