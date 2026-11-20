"""FastAPI routes for Module 8 (`comments_reactions`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from manga_reader.api.v1.dependencies import (
    get_active_reader_principal,
    get_authenticated_principal,
    get_container,
    get_current_principal,
)
from manga_reader.api.v1.envelopes import PaginatedEnvelope, PaginatedMeta, SuccessEnvelope
from manga_reader.common.pagination import PaginationParams
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.modules.comments_reactions.application.service import CommentService

router = APIRouter(tags=["Comments & Reactions"])


class CreateCommentRequest(BaseModel):
    mangaId: UUID
    chapterId: UUID | None = None
    parentCommentId: UUID | None = None
    content: str
    isSpoiler: bool = False


class EditCommentRequest(BaseModel):
    content: str
    isSpoiler: bool = False


class ReactionRequest(BaseModel):
    reactionType: str | None = None


@router.get("/comments", response_model=PaginatedEnvelope[dict[str, Any]])
async def list_comments(
    manga_id: UUID = Query(alias="mangaId"),
    chapter_id: UUID | None = Query(default=None, alias="chapterId"),
    scope: str = Query(default="ALL"),
    sort: str = Query(default="NEWEST"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    viewer: SecurityPrincipal = Depends(get_current_principal),
    container: AppContainer = Depends(get_container),
) -> PaginatedEnvelope[dict[str, Any]]:
    pg = PaginationParams.create(page=page, page_size=page_size)
    svc = CommentService(container)
    async with container.db.session() as db:
        items, total = await svc.list_comments(
            db,
            manga_id=manga_id,
            chapter_id=chapter_id,
            scope=scope,
            sort=sort,
            viewer=viewer,
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


@router.post("/comments", status_code=201, response_model=SuccessEnvelope[dict[str, Any]])
async def create_comment(
    body: CreateCommentRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = CommentService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.create_comment(
                db,
                principal=principal,
                manga_id=body.mangaId,
                chapter_id=body.chapterId,
                parent_comment_id=body.parentCommentId,
                content=body.content,
                is_spoiler=body.isSpoiler,
            )
        )


@router.put("/comments/{comment_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def edit_comment(
    comment_id: UUID,
    body: EditCommentRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = CommentService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.edit_comment(
                db,
                principal=principal,
                comment_id=comment_id,
                content=body.content,
                is_spoiler=body.isSpoiler,
            )
        )


@router.get("/comments/{comment_id}/history", response_model=SuccessEnvelope[list[dict[str, Any]]])
async def get_comment_history(
    comment_id: UUID,
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[list[dict[str, Any]]]:
    svc = CommentService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(data=await svc.get_edit_history(db, comment_id))


@router.delete("/comments/{comment_id}", response_model=SuccessEnvelope[dict[str, Any]])
async def delete_comment(
    comment_id: UUID,
    principal: SecurityPrincipal = Depends(get_authenticated_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = CommentService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.soft_delete_comment(db, principal=principal, comment_id=comment_id)
        )


@router.put("/comments/{comment_id}/reaction", response_model=SuccessEnvelope[dict[str, Any]])
async def react_to_comment(
    comment_id: UUID,
    body: ReactionRequest,
    principal: SecurityPrincipal = Depends(get_active_reader_principal),
    container: AppContainer = Depends(get_container),
) -> SuccessEnvelope[dict[str, Any]]:
    svc = CommentService(container)
    async with container.db.session() as db:
        return SuccessEnvelope(
            data=await svc.set_reaction(
                db,
                principal=principal,
                comment_id=comment_id,
                reaction_type=body.reactionType,
            )
        )
