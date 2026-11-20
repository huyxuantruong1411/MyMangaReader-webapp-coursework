"""Phase 7: Comments, 1-Level Replies, Spoiler Lock, Edit History & Atomic Reactions (UC-5)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    BusinessRuleError,
    ForbiddenError,
    ResourceNotFoundError,
    ValidationAppError,
)
from manga_reader.common.security import SecurityPrincipal
from manga_reader.common.text import sanitize_user_text
from manga_reader.infrastructure.audit_outbox import append_activity_log
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    AccountModel,
    ChapterModel,
    CommentEditHistoryModel,
    CommentModel,
    CommentReactionModel,
    MangaModel,
    ReaderModel,
)

DELETED_COMMENT_PLACEHOLDER = "[Bình luận đã bị xóa]"


class CommentService:
    """Application service for Module 8 (`comments_reactions`)."""

    def __init__(self, container: AppContainer) -> None:
        self._container = container

    async def _serialize_comment(
        self,
        comment: CommentModel,
        *,
        author_map: dict[UUID, tuple[str, str]],
        viewer: SecurityPrincipal,
        my_reactions: dict[UUID, str],
        replies: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        username, display_name = author_map.get(comment.reader_account_id, ("reader", "Reader"))
        is_owner = viewer.account_id == comment.reader_account_id
        return {
            "commentId": str(comment.comment_id),
            "mangaId": str(comment.manga_id),
            "chapterId": str(comment.chapter_id) if comment.chapter_id else None,
            "parentCommentId": str(comment.parent_comment_id)
            if comment.parent_comment_id
            else None,
            "author": {
                "accountId": str(comment.reader_account_id),
                "username": username,
                "displayName": display_name,
            },
            "content": DELETED_COMMENT_PLACEHOLDER if comment.is_deleted else comment.content,
            "isDeleted": comment.is_deleted,
            "isSpoiler": False if comment.is_deleted else comment.is_spoiler,
            "isSpoilerLockedByAdmin": comment.is_spoiler_locked_by_admin,
            "isEdited": comment.is_edited,
            "likeCount": comment.like_count,
            "dislikeCount": comment.dislike_count,
            "myReaction": my_reactions.get(comment.comment_id),
            "canEdit": (not comment.is_deleted) and is_owner and viewer.is_active_reader,
            "canDelete": (not comment.is_deleted) and (is_owner or viewer.is_admin),
            "createdAt": format_rfc3339(comment.created_at),
            "updatedAt": format_rfc3339(comment.updated_at),
            "replies": replies if replies is not None else [],
        }

    async def list_comments(
        self,
        session: AsyncSession,
        *,
        manga_id: UUID,
        chapter_id: UUID | None = None,
        scope: str = "ALL",
        sort: str = "NEWEST",
        viewer: SecurityPrincipal,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        manga = await session.get(MangaModel, manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        root_stmt = select(CommentModel).where(
            CommentModel.manga_id == manga_id,
            CommentModel.parent_comment_id.is_(None),
        )
        if chapter_id is not None:
            root_stmt = root_stmt.where(CommentModel.chapter_id == chapter_id)
        elif scope.upper() == "MANGA_ONLY":
            root_stmt = root_stmt.where(CommentModel.chapter_id.is_(None))

        if sort.upper() == "TOP":
            root_stmt = root_stmt.order_by(
                CommentModel.like_count.desc(), CommentModel.created_at.desc()
            )
        elif sort.upper() == "OLDEST":
            root_stmt = root_stmt.order_by(CommentModel.created_at.asc())
        else:
            root_stmt = root_stmt.order_by(CommentModel.created_at.desc())

        all_roots = (await session.scalars(root_stmt)).all()
        root_ids = [r.comment_id for r in all_roots]

        replies_by_parent: dict[UUID, list[CommentModel]] = {}
        if root_ids:
            reply_rows = (
                await session.scalars(
                    select(CommentModel)
                    .where(
                        CommentModel.parent_comment_id.in_(root_ids),
                        CommentModel.is_deleted.is_(False),
                    )
                    .order_by(CommentModel.created_at.asc())
                )
            ).all()
            for rep in reply_rows:
                assert rep.parent_comment_id is not None
                replies_by_parent.setdefault(rep.parent_comment_id, []).append(rep)

        # Hide soft-deleted root comments that have NO visible replies; keep placeholder if replies exist
        visible_roots = [
            r for r in all_roots if (not r.is_deleted) or bool(replies_by_parent.get(r.comment_id))
        ]
        total = len(visible_roots)
        start = (page - 1) * page_size
        page_roots = visible_roots[start : start + page_size]

        # Batch fetch authors and viewer reactions
        all_comment_objs = list(page_roots)
        for r in page_roots:
            all_comment_objs.extend(replies_by_parent.get(r.comment_id, []))

        author_ids = list({c.reader_account_id for c in all_comment_objs})
        author_map: dict[UUID, tuple[str, str]] = {}
        if author_ids:
            arows = (
                await session.execute(
                    select(AccountModel.account_id, AccountModel.username, ReaderModel.display_name)
                    .join(ReaderModel, ReaderModel.account_id == AccountModel.account_id)
                    .where(AccountModel.account_id.in_(author_ids))
                )
            ).all()
            author_map = {aid: (uname, dname) for aid, uname, dname in arows}

        my_reactions: dict[UUID, str] = {}
        if viewer.is_authenticated and viewer.account_id is not None and all_comment_objs:
            cids = [c.comment_id for c in all_comment_objs]
            rrows = (
                await session.scalars(
                    select(CommentReactionModel).where(
                        CommentReactionModel.reader_account_id == viewer.account_id,
                        CommentReactionModel.comment_id.in_(cids),
                    )
                )
            ).all()
            my_reactions = {rr.comment_id: rr.reaction_type for rr in rrows}

        serialized: list[dict[str, Any]] = []
        for root in page_roots:
            rep_dicts = [
                await self._serialize_comment(
                    rep, author_map=author_map, viewer=viewer, my_reactions=my_reactions
                )
                for rep in replies_by_parent.get(root.comment_id, [])
            ]
            serialized.append(
                await self._serialize_comment(
                    root,
                    author_map=author_map,
                    viewer=viewer,
                    my_reactions=my_reactions,
                    replies=rep_dicts,
                )
            )
        return serialized, total

    async def create_comment(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        manga_id: UUID,
        chapter_id: UUID | None,
        parent_comment_id: UUID | None,
        content: str,
        is_spoiler: bool,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        trimmed = content.strip()
        max_len = self._container.settings.comment_max_length
        if not trimmed:
            raise ValidationAppError(
                "Comment content cannot be empty.", details={"field": "content"}
            )
        if len(trimmed) > max_len:
            raise ValidationAppError(
                f"Comment cannot exceed {max_len} characters.",
                details={"field": "content", "maxLength": max_len},
            )

        manga = await session.get(MangaModel, manga_id)
        if (
            manga is None
            or manga.visibility_status != "PUBLIC"
            or manga.deletion_status != "ACTIVE"
        ):
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        if chapter_id is not None:
            ch = await session.get(ChapterModel, chapter_id)
            if ch is None or ch.manga_id != manga_id:
                raise ValidationAppError("Chapter does not belong to the specified manga.")

        if parent_comment_id is not None:
            parent = await session.get(CommentModel, parent_comment_id)
            if parent is None or parent.is_deleted:
                raise BusinessRuleError("Cannot reply to a missing or deleted comment.")
            if parent.parent_comment_id is not None:
                raise BusinessRuleError(
                    "MVP permits only one level of reply to root comments (ADR-008)."
                )
            if parent.manga_id != manga_id or parent.chapter_id != chapter_id:
                raise BusinessRuleError(
                    "Reply must match parent comment's manga and chapter context."
                )

        now = utc_now()
        safe_content = sanitize_user_text(trimmed, preserve_newlines=True)
        comment = CommentModel(
            reader_account_id=principal.account_id,
            manga_id=manga_id,
            chapter_id=chapter_id,
            parent_comment_id=parent_comment_id,
            content=safe_content,
            is_spoiler=is_spoiler,
            is_spoiler_locked_by_admin=False,
            is_edited=False,
            is_deleted=False,
            created_at=now,
            updated_at=now,
        )
        session.add(comment)
        await session.flush()
        append_activity_log(
            session,
            event_type="COMMENT",
            account_id=principal.account_id,
            target_type="COMMENT",
            target_id=str(comment.comment_id),
            details={
                "manga_id": str(manga_id),
                "chapter_id": str(chapter_id) if chapter_id else None,
            },
        )
        await session.commit()

        acc = await session.get(AccountModel, principal.account_id)
        reader = await session.get(ReaderModel, principal.account_id)
        author_map: dict[UUID, tuple[str, str]] = {
            principal.account_id: (
                acc.username if acc else "reader",
                reader.display_name if reader else "Reader",
            )
        }
        return await self._serialize_comment(
            comment, author_map=author_map, viewer=principal, my_reactions={}
        )

    async def edit_comment(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        comment_id: UUID,
        content: str,
        is_spoiler: bool,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        comment = await session.get(CommentModel, comment_id)
        if comment is None:
            raise ResourceNotFoundError("Comment not found.")
        if comment.reader_account_id != principal.account_id:
            raise ForbiddenError("Only the comment author can edit this comment.")
        if comment.is_deleted:
            raise BusinessRuleError("Deleted comments cannot be edited.")

        trimmed = content.strip()
        max_len = self._container.settings.comment_max_length
        if not trimmed or len(trimmed) > max_len:
            raise ValidationAppError(
                f"Comment content must be 1..{max_len} characters.",
                details={"field": "content"},
            )

        # Admin-enforced spoiler lock cannot be removed by Reader (SOC-018 / UC-5.3)
        if comment.is_spoiler_locked_by_admin and not is_spoiler:
            raise BusinessRuleError(
                "Spoiler flag was locked by an administrator and cannot be removed.",
                error_code="SPOILER_LOCKED_BY_ADMIN",
            )

        now = utc_now()
        # Preserve previous content AND spoiler state before updating (M-003 / SOC-015)
        session.add(
            CommentEditHistoryModel(
                comment_id=comment.comment_id,
                editor_reader_account_id=principal.account_id,
                previous_content=comment.content,
                previous_is_spoiler=comment.is_spoiler,
                edited_at=now,
            )
        )
        comment.content = sanitize_user_text(trimmed, preserve_newlines=True)
        comment.is_spoiler = True if comment.is_spoiler_locked_by_admin else is_spoiler
        comment.is_edited = True
        comment.updated_at = now
        await session.commit()

        acc = await session.get(AccountModel, principal.account_id)
        reader = await session.get(ReaderModel, principal.account_id)
        author_map: dict[UUID, tuple[str, str]] = {
            principal.account_id: (
                acc.username if acc else "reader",
                reader.display_name if reader else "Reader",
            )
        }
        return await self._serialize_comment(
            comment, author_map=author_map, viewer=principal, my_reactions={}
        )

    async def get_edit_history(
        self, session: AsyncSession, comment_id: UUID
    ) -> list[dict[str, Any]]:
        comment = await session.get(CommentModel, comment_id)
        if comment is None:
            raise ResourceNotFoundError("Comment not found.")
        rows = (
            await session.scalars(
                select(CommentEditHistoryModel)
                .where(CommentEditHistoryModel.comment_id == comment_id)
                .order_by(CommentEditHistoryModel.edited_at.desc())
            )
        ).all()
        return [
            {
                "editId": str(r.edit_id),
                "previousContent": r.previous_content,
                "previousIsSpoiler": r.previous_is_spoiler,
                "editedAt": format_rfc3339(r.edited_at),
            }
            for r in rows
        ]

    async def soft_delete_comment(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        comment_id: UUID,
        commit: bool = True,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        comment = await session.get(CommentModel, comment_id)
        if comment is None:
            raise ResourceNotFoundError("Comment not found.")
        if comment.reader_account_id != principal.account_id and not principal.is_admin:
            raise ForbiddenError("You cannot delete another user's comment.")
        if comment.is_deleted:
            return {"commentId": str(comment_id), "isDeleted": True, "alreadyDeleted": True}

        comment.is_deleted = True
        comment.updated_at = utc_now()
        append_activity_log(
            session,
            event_type="COMMENT_DELETED",
            account_id=principal.account_id,
            target_type="COMMENT",
            target_id=str(comment_id),
            details={"by_admin": principal.is_admin},
        )
        if commit:
            await session.commit()
        return {"commentId": str(comment_id), "isDeleted": True, "alreadyDeleted": False}

    async def force_spoiler(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        comment_id: UUID,
        commit: bool = True,
    ) -> dict[str, Any]:
        comment = await session.get(CommentModel, comment_id)
        if comment is None or comment.is_deleted:
            raise ResourceNotFoundError("Comment not found.")
        comment.is_spoiler = True
        comment.is_spoiler_locked_by_admin = True
        comment.updated_at = utc_now()
        append_activity_log(
            session,
            event_type="COMMENT_FORCE_SPOILER",
            account_id=admin_principal.account_id,
            target_type="COMMENT",
            target_id=str(comment_id),
        )
        if commit:
            await session.commit()
        return {
            "commentId": str(comment_id),
            "isSpoiler": True,
            "isSpoilerLockedByAdmin": True,
        }

    async def set_reaction(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        comment_id: UUID,
        reaction_type: str | None,
    ) -> dict[str, Any]:
        """Idempotent desired-state reaction mutation (`LIKE` | `DISLIKE` | `None`, `SOC-024..028`)."""
        assert principal.account_id is not None
        if reaction_type is not None and reaction_type not in ("LIKE", "DISLIKE"):
            raise ValidationAppError("reactionType must be 'LIKE', 'DISLIKE', or null.")

        comment = await session.get(CommentModel, comment_id)
        if comment is None:
            raise ResourceNotFoundError("Comment not found.")
        if comment.is_deleted:
            raise BusinessRuleError("Cannot react to a deleted comment.")

        now = utc_now()
        existing = await session.scalar(
            select(CommentReactionModel).where(
                CommentReactionModel.reader_account_id == principal.account_id,
                CommentReactionModel.comment_id == comment_id,
            )
        )
        before = existing.reaction_type if existing else None

        if before != reaction_type:
            if reaction_type is None:
                if existing is not None:
                    await session.delete(existing)
            elif existing is None:
                session.add(
                    CommentReactionModel(
                        reader_account_id=principal.account_id,
                        comment_id=comment_id,
                        reaction_type=reaction_type,
                        updated_at=now,
                    )
                )
            else:
                existing.reaction_type = reaction_type
                existing.updated_at = now
            await session.flush()

            # Recompute exact authoritative counts inside transaction (prevents drift under race)
            comment.like_count = int(
                await session.scalar(
                    select(func.count())
                    .select_from(CommentReactionModel)
                    .where(
                        CommentReactionModel.comment_id == comment_id,
                        CommentReactionModel.reaction_type == "LIKE",
                    )
                )
                or 0
            )
            comment.dislike_count = int(
                await session.scalar(
                    select(func.count())
                    .select_from(CommentReactionModel)
                    .where(
                        CommentReactionModel.comment_id == comment_id,
                        CommentReactionModel.reaction_type == "DISLIKE",
                    )
                )
                or 0
            )
            await session.commit()

        return {
            "commentId": str(comment_id),
            "myReaction": reaction_type,
            "likeCount": comment.like_count,
            "dislikeCount": comment.dislike_count,
        }
