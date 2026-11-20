"""FastAPI routes for Module 10 (`reading_lists`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from manga_reader.api.v1.dependencies import get_active_reader_principal, get_container
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.reading_lists.application.service import ReadingListService

router = APIRouter(tags=["Reading Lists"])


class CreateListRequest(BaseModel):
    name: str
    description: str | None = None


class UpdateListRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class MergeCreateListRequest(BaseModel):
    sourceListIds: list[UUID] = Field(default_factory=list)
    newName: str
    description: str | None = None
    confirmEmpty: bool = False


class SyncMembershipsRequest(BaseModel):
    selectedListIds: list[UUID] = Field(default_factory=list)


@router.get("/lists/my", response_model=SuccessEnvelope[list[dict[str, Any]]])
async def list_my_lists(
    q: str | None = Query(default=None),
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.list_my_lists(db, principal=principal, q=q))


@router.post("/lists", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def create_list(
    body: CreateListRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.create_list(
                db, principal=principal, name=body.name, description=body.description
            )
        )


@router.post("/lists/quick-create", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def quick_create_list(
    body: CreateListRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.create_list(
                db, principal=principal, name=body.name, description=body.description
            )
        )


@router.post("/lists/merge-create", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def merge_create_list(
    body: MergeCreateListRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.merge_create_list(
                db,
                principal=principal,
                source_list_ids=body.sourceListIds,
                new_name=body.newName,
                description=body.description,
                confirm_empty=body.confirmEmpty,
            )
        )


@router.get("/lists/{list_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def get_list_detail(
    list_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_list_detail(db, principal=principal, list_id=list_id)
        )


@router.patch("/lists/{list_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def update_list(
    list_id: UUID,
    body: UpdateListRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.update_list(
                db,
                principal=principal,
                list_id=list_id,
                name=body.name,
                description=body.description,
            )
        )


@router.delete("/lists/{list_id}", response_model=SuccessEnvelope[dict[str, bool]])
async def delete_list(
    list_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, bool]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.delete_list(db, principal=principal, list_id=list_id))


@router.get("/lists/{list_id}/manga", response_model=PaginatedEnvelope[dict[str, Any]])
async def list_manga_in_list(
    list_id: UUID,
    q: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    status: str | None = Query(default=None),
    reading_status: str | None = Query(default=None, alias="readingStatus"),
    sort: str = Query(default="ADDED_DESC"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, alias="pageSize", ge=1, le=100),
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = ReadingListService(container)
    async with container.db.session() as db:
        items, total = await svc.list_items_filtered(
            db,
            principal=principal,
            list_id=list_id,
            q=q,
            tag=tag,
            status=status,
            reading_status=reading_status,
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


@router.delete("/lists/{list_id}/manga/{manga_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def remove_manga_from_list(
    list_id: UUID,
    manga_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.remove_item_from_list(
                db, principal=principal, list_id=list_id, manga_id=manga_id
            )
        )


@router.get("/lists/{list_id}/metadata-stats", response_model=SuccessEnvelope[dict[str, Any]])
async def get_list_metadata_stats(
    list_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_metadata_stats(db, principal=principal, list_id=list_id)
        )


@router.get(
    "/manga/{manga_id}/my-list-memberships",
    response_model=SuccessEnvelope[dict[str, Any]],
)
async def get_my_list_memberships(
    manga_id: UUID,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.get_manga_memberships(db, principal=principal, manga_id=manga_id)
        )


@router.put(
    "/manga/{manga_id}/my-list-memberships",
    response_model=SuccessEnvelope[dict[str, Any]],
)
async def sync_my_list_memberships(
    manga_id: UUID,
    body: SyncMembershipsRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = ReadingListService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.sync_manga_memberships(
                db,
                principal=principal,
                manga_id=manga_id,
                selected_list_ids=body.selectedListIds,
            )
        )
