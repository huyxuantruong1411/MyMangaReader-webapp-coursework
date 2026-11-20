"""Phase 9: Report Submission & Atomic Admin Moderation Center (`UC-1.6`, `UC-1.7`, `MOD-001..024`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.clock import format_rfc3339, utc_now
from manga_reader.common.errors import (
    BusinessRuleError,
    ConflictError,
    RateLimitedError,
    ResourceNotFoundError,
    ValidationAppError,
)
from manga_reader.common.security import SecurityPrincipal
from manga_reader.common.text import sanitize_user_text
from manga_reader.infrastructure.audit_outbox import append_activity_log
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    AccountModel,
    AccountReportModel,
    ChapterModel,
    CommentModel,
    CommentReportModel,
    MangaModel,
    MangaReportModel,
    ReportActionHistoryModel,
    ReportModel,
)
from manga_reader.modules.account_auth.application.service import AuthService
from manga_reader.modules.comments_reactions.application.service import CommentService
from manga_reader.modules.manga_creator.application.service import MangaLifecycleService

ALLOWED_ACTIONS_BY_TYPE: dict[str, frozenset[str]] = {
    "ACCOUNT": frozenset({"LOCK_ACCOUNT", "IGNORE"}),
    "MANGA": frozenset({"HIDE_MANGA", "DELETE_MANGA", "IGNORE"}),
    "COMMENT": frozenset({"DELETE_COMMENT", "FORCE_SPOILER", "LOCK_ACCOUNT", "IGNORE"}),
}


class ModerationReportingService:
    """Application service for Module 9 (`moderation_reporting`)."""

    def __init__(self, container: AppContainer) -> None:
        self._container = container

    async def _check_report_rate_limit(self, account_id: UUID) -> None:
        rl = await self._container.rate_limiter.check(
            "report_submit",
            str(account_id),
            limit=20,
            window_seconds=300,
        )
        if not rl.allowed:
            raise RateLimitedError(
                "Too many reports submitted recently. Please wait before reporting again."
            )

    async def submit_account_report(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        target_account_id: UUID,
        reason_category: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        await self._check_report_rate_limit(principal.account_id)
        if target_account_id == principal.account_id:
            raise BusinessRuleError(
                "You cannot report your own account.", error_code="SELF_REPORT_FORBIDDEN"
            )

        target = await session.get(AccountModel, target_account_id)
        if target is None:
            raise ResourceNotFoundError("Target account not found.")

        clean_cat = reason_category.strip()
        if not clean_cat or len(clean_cat) > 100:
            raise ValidationAppError("reasonCategory is required (1-100 chars).")

        now = utc_now()
        report = ReportModel(
            reporter_reader_account_id=principal.account_id,
            report_type="ACCOUNT",
            reason_category=clean_cat,
            description=sanitize_user_text(description) if description else None,
            status="PENDING",
            created_at=now,
        )
        session.add(report)
        await session.flush()
        session.add(
            AccountReportModel(
                report_id=report.report_id,
                target_account_id=target.account_id,
                target_account_snapshot=f"{target.username} ({target.account_id})",
            )
        )
        append_activity_log(
            session,
            event_type="REPORT",
            account_id=principal.account_id,
            target_type="ACCOUNT",
            target_id=str(target.account_id),
            details={"report_id": str(report.report_id), "category": clean_cat},
        )
        await session.commit()
        return {"reportId": str(report.report_id), "status": report.status, "reportType": "ACCOUNT"}

    async def submit_manga_report(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        target_manga_id: UUID,
        target_chapter_id: UUID | None,
        reason_category: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        await self._check_report_rate_limit(principal.account_id)
        manga = await session.get(MangaModel, target_manga_id)
        if manga is None or manga.deletion_status != "ACTIVE":
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        chapter_snap: str | None = None
        if target_chapter_id is not None:
            ch = await session.get(ChapterModel, target_chapter_id)
            if ch is None or ch.manga_id != manga.manga_id:
                raise ValidationAppError("Chapter does not belong to target manga.")
            chapter_snap = f"Ch.{ch.chapter_number} - {ch.title}"[:250]

        clean_cat = reason_category.strip()
        if not clean_cat or len(clean_cat) > 100:
            raise ValidationAppError("reasonCategory is required (1-100 chars).")

        now = utc_now()
        # Honor authoritative mangas.ignore_all_reports (ADR-006 / MOD-020): record auto-ignored transparently
        auto_ignored = bool(manga.ignore_all_reports)
        report = ReportModel(
            reporter_reader_account_id=principal.account_id,
            report_type="MANGA",
            reason_category=clean_cat,
            description=sanitize_user_text(description) if description else None,
            status="IGNORED" if auto_ignored else "PENDING",
            action_taken="IGNORE" if auto_ignored else None,
            resolution_note="Auto-ignored: future reports disabled for this manga."
            if auto_ignored
            else None,
            created_at=now,
            resolved_at=now if auto_ignored else None,
        )
        session.add(report)
        await session.flush()
        session.add(
            MangaReportModel(
                report_id=report.report_id,
                target_manga_id=manga.manga_id,
                target_chapter_id=target_chapter_id,
                target_manga_snapshot=f"{manga.title} ({manga.pool_manga_id})"[:500],
                target_chapter_snapshot=chapter_snap,
                ignore_future_reports=auto_ignored,
            )
        )
        if auto_ignored:
            session.add(
                ReportActionHistoryModel(
                    report_id=report.report_id,
                    actor_type="SYSTEM",
                    admin_account_id=None,
                    action_type="AUTO_IGNORE_FUTURE_REPORTS_DISABLED",
                    previous_status="PENDING",
                    new_status="IGNORED",
                    action_note="mangas.ignore_all_reports is enabled",
                    performed_at=now,
                )
            )
        append_activity_log(
            session,
            event_type="REPORT",
            account_id=principal.account_id,
            target_type="MANGA",
            target_id=str(manga.manga_id),
            details={
                "report_id": str(report.report_id),
                "category": clean_cat,
                "auto_ignored": auto_ignored,
            },
        )
        await session.commit()
        return {"reportId": str(report.report_id), "status": report.status, "reportType": "MANGA"}

    async def submit_comment_report(
        self,
        session: AsyncSession,
        *,
        principal: SecurityPrincipal,
        target_comment_id: UUID,
        reason_category: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        assert principal.account_id is not None
        await self._check_report_rate_limit(principal.account_id)
        comment = await session.get(CommentModel, target_comment_id)
        if comment is None or comment.is_deleted:
            raise ResourceNotFoundError("Comment not found.")

        clean_cat = reason_category.strip()
        if not clean_cat or len(clean_cat) > 100:
            raise ValidationAppError("reasonCategory is required (1-100 chars).")

        now = utc_now()
        report = ReportModel(
            reporter_reader_account_id=principal.account_id,
            report_type="COMMENT",
            reason_category=clean_cat,
            description=sanitize_user_text(description) if description else None,
            status="PENDING",
            created_at=now,
        )
        session.add(report)
        await session.flush()
        session.add(
            CommentReportModel(
                report_id=report.report_id,
                target_comment_id=comment.comment_id,
                target_comment_snapshot=comment.content[:500],
            )
        )
        append_activity_log(
            session,
            event_type="REPORT",
            account_id=principal.account_id,
            target_type="COMMENT",
            target_id=str(comment.comment_id),
            details={"report_id": str(report.report_id), "category": clean_cat},
        )
        await session.commit()
        return {"reportId": str(report.report_id), "status": report.status, "reportType": "COMMENT"}

    async def _inspect_target_state(
        self, session: AsyncSession, report: ReportModel
    ) -> tuple[bool, dict[str, Any]]:
        if report.report_type == "ACCOUNT":
            sub = await session.get(AccountReportModel, report.report_id)
            target = (
                await session.get(AccountModel, sub.target_account_id)
                if sub and sub.target_account_id
                else None
            )
            return target is not None, {
                "targetId": str(sub.target_account_id) if sub and sub.target_account_id else None,
                "snapshot": sub.target_account_snapshot if sub else "",
                "currentStatus": target.status if target else "MISSING",
            }
        if report.report_type == "MANGA":
            sub_m = await session.get(MangaReportModel, report.report_id)
            target_m = (
                await session.get(MangaModel, sub_m.target_manga_id)
                if sub_m and sub_m.target_manga_id
                else None
            )
            exists = target_m is not None and target_m.deletion_status == "ACTIVE"
            return exists, {
                "targetId": str(sub_m.target_manga_id) if sub_m and sub_m.target_manga_id else None,
                "chapterId": str(sub_m.target_chapter_id)
                if sub_m and sub_m.target_chapter_id
                else None,
                "snapshot": sub_m.target_manga_snapshot if sub_m else "",
                "chapterSnapshot": sub_m.target_chapter_snapshot if sub_m else None,
                "currentVisibility": target_m.visibility_status if target_m else "DELETED",
                "ignoreAllReports": target_m.ignore_all_reports if target_m else False,
            }
        sub_c = await session.get(CommentReportModel, report.report_id)
        target_c = (
            await session.get(CommentModel, sub_c.target_comment_id)
            if sub_c and sub_c.target_comment_id
            else None
        )
        exists_c = target_c is not None and not target_c.is_deleted
        return exists_c, {
            "targetId": str(sub_c.target_comment_id) if sub_c and sub_c.target_comment_id else None,
            "commentAuthorId": str(target_c.reader_account_id) if target_c else None,
            "snapshot": sub_c.target_comment_snapshot if sub_c else "",
            "isDeleted": target_c.is_deleted if target_c else True,
            "isSpoilerLocked": target_c.is_spoiler_locked_by_admin if target_c else False,
        }

    async def admin_list_reports(
        self,
        session: AsyncSession,
        *,
        report_type: str | None = None,
        status: str | None = "PENDING",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        stmt = select(ReportModel)
        count_stmt = select(func.count()).select_from(ReportModel)
        if report_type:
            stmt = stmt.where(ReportModel.report_type == report_type.upper())
            count_stmt = count_stmt.where(ReportModel.report_type == report_type.upper())
        if status and status.upper() != "ALL":
            stmt = stmt.where(ReportModel.status == status.upper())
            count_stmt = count_stmt.where(ReportModel.status == status.upper())

        total = int(await session.scalar(count_stmt) or 0)
        rows = (
            await session.scalars(
                stmt.order_by(ReportModel.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()

        items: list[dict[str, Any]] = []
        for r in rows:
            reporter = await session.get(AccountModel, r.reporter_reader_account_id)
            target_exists, target_info = await self._inspect_target_state(session, r)
            items.append(
                {
                    "reportId": str(r.report_id),
                    "reportType": r.report_type,
                    "status": r.status,
                    "reasonCategory": r.reason_category,
                    "description": r.description,
                    "reporter": {
                        "accountId": str(r.reporter_reader_account_id),
                        "username": reporter.username if reporter else "unknown",
                    },
                    "targetExists": target_exists,
                    "target": target_info,
                    "actionTaken": r.action_taken,
                    "resolutionNote": r.resolution_note,
                    "createdAt": format_rfc3339(r.created_at),
                    "resolvedAt": format_rfc3339(r.resolved_at) if r.resolved_at else None,
                }
            )
        return items, total

    async def admin_get_report_detail(
        self, session: AsyncSession, *, report_id: UUID
    ) -> dict[str, Any]:
        """Fetch report detail; auto-closes to `CLOSED` with SYSTEM actor if target missing (ADR-020)."""
        report = await session.get(ReportModel, report_id)
        if report is None:
            raise ResourceNotFoundError("Report not found.")

        target_exists, target_info = await self._inspect_target_state(session, report)
        if report.status == "PENDING" and not target_exists:
            now = utc_now()
            report.status = "CLOSED"
            report.action_taken = "SYSTEM_AUTO_CLOSE_TARGET_MISSING"
            report.resolution_note = "Target entity no longer exists."
            report.resolved_at = now
            session.add(
                ReportActionHistoryModel(
                    report_id=report.report_id,
                    actor_type="SYSTEM",
                    admin_account_id=None,
                    action_type="AUTO_CLOSE",
                    previous_status="PENDING",
                    new_status="CLOSED",
                    action_note="Target no longer exists.",
                    performed_at=now,
                )
            )
            append_activity_log(
                session,
                event_type="SYSTEM_REPORT_CLOSED",
                account_id=None,
                target_type="REPORT",
                target_id=str(report.report_id),
                details={"report_type": report.report_type, "reason": "target_missing"},
            )
            await session.commit()

        reporter = await session.get(AccountModel, report.reporter_reader_account_id)
        history = (
            await session.scalars(
                select(ReportActionHistoryModel)
                .where(ReportActionHistoryModel.report_id == report.report_id)
                .order_by(ReportActionHistoryModel.performed_at.desc())
            )
        ).all()

        return {
            "reportId": str(report.report_id),
            "reportType": report.report_type,
            "status": report.status,
            "reasonCategory": report.reason_category,
            "description": report.description,
            "reporter": {
                "accountId": str(report.reporter_reader_account_id),
                "username": reporter.username if reporter else "unknown",
            },
            "targetExists": target_exists,
            "target": target_info,
            "allowedActions": (
                sorted(ALLOWED_ACTIONS_BY_TYPE[report.report_type])
                if report.status == "PENDING" and target_exists
                else []
            ),
            "actionTaken": report.action_taken,
            "resolutionNote": report.resolution_note,
            "createdAt": format_rfc3339(report.created_at),
            "resolvedAt": format_rfc3339(report.resolved_at) if report.resolved_at else None,
            "actionHistory": [
                {
                    "actionHistoryId": str(h.action_history_id),
                    "actorType": h.actor_type,
                    "adminAccountId": str(h.admin_account_id) if h.admin_account_id else None,
                    "actionType": h.action_type,
                    "previousStatus": h.previous_status,
                    "newStatus": h.new_status,
                    "actionNote": h.action_note,
                    "performedAt": format_rfc3339(h.performed_at),
                }
                for h in history
            ],
        }

    async def admin_resolve_report(
        self,
        session: AsyncSession,
        *,
        admin_principal: SecurityPrincipal,
        report_id: UUID,
        action_type: str,
        note: str,
        ignore_future_reports: bool = False,
    ) -> dict[str, Any]:
        """Atomic moderation resolution command (`UC-1.7` / `MOD-012..023`)."""
        assert admin_principal.account_id is not None
        report = await session.get(ReportModel, report_id)
        if report is None:
            raise ResourceNotFoundError("Report not found.")
        if report.status != "PENDING":
            raise ConflictError(
                f"Report is already in terminal state '{report.status}'.",
                error_code="REPORT_ALREADY_PROCESSED",
            )

        action = action_type.strip().upper()
        if action not in ALLOWED_ACTIONS_BY_TYPE.get(report.report_type, frozenset()):
            raise ValidationAppError(
                f"Action '{action}' is not valid for {report.report_type} reports.",
                details={"field": "actionType"},
            )
        clean_note = note.strip()
        if not clean_note:
            raise ValidationAppError(
                "Resolution note/reason is required.", details={"field": "note"}
            )

        target_exists, target_info = await self._inspect_target_state(session, report)
        if not target_exists:
            return await self.admin_get_report_detail(session, report_id=report_id)

        now = utc_now()
        new_status = "IGNORED" if action == "IGNORE" else "RESOLVED"

        # Execute domain target effect inside the SAME DB transaction (`commit=False`)
        if action == "LOCK_ACCOUNT":
            target_uid_str = (
                target_info.get("commentAuthorId")
                if report.report_type == "COMMENT"
                else target_info.get("targetId")
            )
            if not target_uid_str:
                raise ResourceNotFoundError("Target account missing.")
            await AuthService(self._container).admin_lock_account(
                session,
                admin_principal=admin_principal,
                target_account_id=UUID(str(target_uid_str)),
                reason=clean_note,
                commit=False,
            )
        elif action == "HIDE_MANGA":
            await MangaLifecycleService().hide_manga(
                session,
                admin_principal=admin_principal,
                manga_id=UUID(str(target_info["targetId"])),
                reason=clean_note,
                source_report_id=report.report_id,
                commit=False,
            )
        elif action == "DELETE_MANGA":
            await MangaLifecycleService().delete_manga(
                session,
                admin_principal=admin_principal,
                manga_id=UUID(str(target_info["targetId"])),
                reason=clean_note,
                source_report_id=report.report_id,
                commit=False,
            )
        elif action == "DELETE_COMMENT":
            await CommentService(self._container).soft_delete_comment(
                session,
                principal=admin_principal,
                comment_id=UUID(str(target_info["targetId"])),
                commit=False,
            )
        elif action == "FORCE_SPOILER":
            await CommentService(self._container).force_spoiler(
                session,
                admin_principal=admin_principal,
                comment_id=UUID(str(target_info["targetId"])),
                commit=False,
            )

        # Single authoritative switch for ignoring future manga reports (ADR-006)
        if report.report_type == "MANGA" and ignore_future_reports and target_info.get("targetId"):
            target_manga = await session.get(MangaModel, UUID(str(target_info["targetId"])))
            if target_manga is not None:
                target_manga.ignore_all_reports = True
            sub_m = await session.get(MangaReportModel, report.report_id)
            if sub_m is not None:
                sub_m.ignore_future_reports = True

        report.status = new_status
        report.action_taken = action
        report.resolution_note = clean_note
        report.resolved_by_admin_account_id = admin_principal.account_id
        report.resolved_at = now

        session.add(
            ReportActionHistoryModel(
                report_id=report.report_id,
                actor_type="ADMIN",
                admin_account_id=admin_principal.account_id,
                action_type=action,
                previous_status="PENDING",
                new_status=new_status,
                action_note=clean_note,
                performed_at=now,
            )
        )
        append_activity_log(
            session,
            event_type="REPORT_IGNORED" if new_status == "IGNORED" else "REPORT_RESOLVE",
            account_id=admin_principal.account_id,
            target_type="REPORT",
            target_id=str(report.report_id),
            details={"action": action, "note": clean_note, "new_status": new_status},
        )
        await session.commit()
        return await self.admin_get_report_detail(session, report_id=report.report_id)
