"""ORM models for Reader Settings, Progress (M-001), History, Ratings, Comments, Reports, Lists."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Unicode,
    UnicodeText,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from manga_reader.common.clock import utc_now
from manga_reader.infrastructure.database import Base
from manga_reader.infrastructure.orm.types import GUID, UTCDateTime


class ReaderSettingsModel(Base):
    __tablename__ = "reader_settings"
    __table_args__ = (
        CheckConstraint(
            "display_mode IN ('VERTICAL_WEBTOON', 'SINGLE_PAGE', 'DOUBLE_PAGE')",
            name="display_mode_enum",
        ),
        CheckConstraint("reading_direction IN ('LTR', 'RTL')", name="reading_dir_enum"),
        CheckConstraint(
            "fit_mode IN ('FIT_WIDTH', 'FIT_HEIGHT', 'ORIGINAL')", name="fit_mode_enum"
        ),
        CheckConstraint("preload_page_count >= 0", name="preload_nonneg"),
    )

    settings_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="CASCADE"), nullable=False, unique=True
    )
    display_mode: Mapped[str] = mapped_column(
        String(30), nullable=False, default="VERTICAL_WEBTOON"
    )
    reading_direction: Mapped[str] = mapped_column(String(3), nullable=False, default="LTR")
    fit_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="FIT_WIDTH")
    preload_page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ReaderProgressModel(Base):
    """Exact page resume state separated from append-only `reading_histories` (ADR-001 / M-001)."""

    __tablename__ = "reader_progress"
    __table_args__ = (
        CheckConstraint("page_number >= 1", name="progress_page_pos"),
        CheckConstraint("pages_revision >= 1", name="progress_rev_pos"),
    )

    reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="CASCADE"), primary_key=True
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), primary_key=True
    )
    chapter_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chapters.chapter_id", ondelete="CASCADE"), nullable=False
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    page_uid: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pages_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    client_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ReadingStatusRecordModel(Base):
    __tablename__ = "reading_status_records"
    __table_args__ = (
        UniqueConstraint("reader_account_id", "manga_id", name="UQ_reading_status_reader_manga"),
        CheckConstraint(
            "status IN ('READING', 'PLAN_TO_READ', 'COMPLETED', 'ON_HOLD', 'DROPPED')",
            name="reading_status_enum",
        ),
        Index("IX_reading_status_reader", "reader_account_id", "status"),
        Index("IX_reading_status_manga", "manga_id", "status"),
    )

    record_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="CASCADE"), nullable=False
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ReadingHistoryModel(Base):
    __tablename__ = "reading_histories"
    __table_args__ = (
        CheckConstraint("reading_duration_seconds >= 0", name="duration_nonneg"),
        Index("IX_reading_hist_reader_opened", "reader_account_id", "opened_at"),
        Index("IX_reading_hist_chapter_opened", "chapter_id", "opened_at"),
    )

    history_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="CASCADE"), nullable=False
    )
    chapter_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("chapters.chapter_id", ondelete="CASCADE"), nullable=False
    )
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    last_read_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    reading_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_valid_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class RatingModel(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint("reader_account_id", "manga_id", name="UQ_ratings_reader_manga"),
        CheckConstraint("score >= 1 AND score <= 10", name="score_range"),
        Index("IX_ratings_manga", "manga_id"),
    )

    rating_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="CASCADE"), nullable=False
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    is_removed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class RatingHistoryModel(Base):
    __tablename__ = "rating_histories"
    __table_args__ = (
        CheckConstraint("action_type IN ('CREATE', 'UPDATE', 'REMOVE')", name="rating_action_enum"),
        Index("IX_rating_hist_rating_time", "rating_id", "recorded_at"),
    )

    rating_history_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    rating_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("ratings.rating_id", ondelete="CASCADE"), nullable=False
    )
    previous_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action_type: Mapped[str] = mapped_column(String(10), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class CommentModel(Base):
    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint("like_count >= 0", name="like_nonneg"),
        CheckConstraint("dislike_count >= 0", name="dislike_nonneg"),
        CheckConstraint(
            "is_spoiler_locked_by_admin = 0 OR is_spoiler = 1",
            name="spoiler_lock_invariant",
        ),
        Index("IX_comments_manga_created", "manga_id", "created_at"),
        Index("IX_comments_chapter_created", "chapter_id", "created_at"),
        Index("IX_comments_parent_created", "parent_comment_id", "created_at"),
    )

    comment_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="NO ACTION"), nullable=False
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    chapter_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("chapters.chapter_id", ondelete="SET NULL"), nullable=True
    )
    parent_comment_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("comments.comment_id", ondelete="NO ACTION"), nullable=True
    )
    content: Mapped[str] = mapped_column(UnicodeText, nullable=False)
    is_spoiler: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_spoiler_locked_by_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    like_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dislike_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class CommentEditHistoryModel(Base):
    __tablename__ = "comment_edit_histories"
    __table_args__ = (Index("IX_comment_edit_hist_comment", "comment_id", "edited_at"),)

    edit_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    comment_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("comments.comment_id", ondelete="CASCADE"), nullable=False
    )
    editor_reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="NO ACTION"), nullable=False
    )
    previous_content: Mapped[str] = mapped_column(UnicodeText, nullable=False)
    previous_is_spoiler: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    edited_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class CommentReactionModel(Base):
    __tablename__ = "comment_reactions"
    __table_args__ = (
        UniqueConstraint("reader_account_id", "comment_id", name="UQ_comment_reactions_unique"),
        CheckConstraint("reaction_type IN ('LIKE', 'DISLIKE')", name="reaction_type_enum"),
        Index("IX_comment_reactions_comment_type", "comment_id", "reaction_type"),
    )

    reaction_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="CASCADE"), nullable=False
    )
    comment_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("comments.comment_id", ondelete="CASCADE"), nullable=False
    )
    reaction_type: Mapped[str] = mapped_column(String(8), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ReportModel(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint("report_type IN ('ACCOUNT', 'MANGA', 'COMMENT')", name="report_type_enum"),
        CheckConstraint(
            "status IN ('PENDING', 'RESOLVED', 'IGNORED', 'CLOSED')", name="report_status_enum"
        ),
        Index("IX_reports_type_status_created", "report_type", "status", "created_at"),
    )

    report_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    reporter_reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="NO ACTION"), nullable=False
    )
    report_type: Mapped[str] = mapped_column(String(10), nullable=False)
    reason_category: Mapped[str] = mapped_column(Unicode(100), nullable=False)
    description: Mapped[str | None] = mapped_column(UnicodeText, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    resolution_note: Mapped[str | None] = mapped_column(Unicode(1000), nullable=True)
    action_taken: Mapped[str | None] = mapped_column(String(50), nullable=True)
    resolved_by_admin_account_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("admins.account_id", ondelete="NO ACTION"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class AccountReportModel(Base):
    __tablename__ = "account_reports"

    report_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("reports.report_id", ondelete="CASCADE"), primary_key=True
    )
    target_account_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("accounts.account_id", ondelete="SET NULL"), nullable=True
    )
    target_account_snapshot: Mapped[str] = mapped_column(Unicode(200), nullable=False)


class MangaReportModel(Base):
    __tablename__ = "manga_reports"

    report_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("reports.report_id", ondelete="CASCADE"), primary_key=True
    )
    target_manga_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="SET NULL"), nullable=True
    )
    target_chapter_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("chapters.chapter_id", ondelete="SET NULL"), nullable=True
    )
    target_manga_snapshot: Mapped[str] = mapped_column(Unicode(500), nullable=False)
    target_chapter_snapshot: Mapped[str | None] = mapped_column(Unicode(250), nullable=True)
    # Immutable snapshot of Admin's choice at resolution; mangas.ignore_all_reports is authoritative
    ignore_future_reports: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CommentReportModel(Base):
    __tablename__ = "comment_reports"

    report_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("reports.report_id", ondelete="CASCADE"), primary_key=True
    )
    target_comment_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("comments.comment_id", ondelete="SET NULL"), nullable=True
    )
    target_comment_snapshot: Mapped[str] = mapped_column(Unicode(500), nullable=False)


class ReportActionHistoryModel(Base):
    """Moderation action audit supporting both human Admin and SYSTEM auto-close (ADR-020)."""

    __tablename__ = "report_action_histories"
    __table_args__ = (
        CheckConstraint("actor_type IN ('ADMIN', 'SYSTEM')", name="report_actor_type_enum"),
        Index("IX_report_action_hist_report", "report_id", "performed_at"),
    )

    action_history_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("reports.report_id", ondelete="CASCADE"), nullable=False
    )
    actor_type: Mapped[str] = mapped_column(String(10), nullable=False, default="ADMIN")
    admin_account_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("admins.account_id", ondelete="NO ACTION"), nullable=True
    )
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    previous_status: Mapped[str] = mapped_column(String(10), nullable=False)
    new_status: Mapped[str] = mapped_column(String(10), nullable=False)
    action_note: Mapped[str | None] = mapped_column(Unicode(1000), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ReadingListModel(Base):
    __tablename__ = "reading_lists"
    __table_args__ = (
        UniqueConstraint(
            "owner_reader_account_id", "normalized_name", name="UQ_reading_lists_owner_name"
        ),
        CheckConstraint("item_count >= 0", name="list_item_count_nonneg"),
        Index("IX_reading_lists_owner_updated", "owner_reader_account_id", "updated_at"),
    )

    list_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    owner_reader_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("readers.account_id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Unicode(100), nullable=False)
    normalized_name: Mapped[str] = mapped_column(Unicode(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Unicode(500), nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ListItemModel(Base):
    __tablename__ = "list_items"
    __table_args__ = (
        UniqueConstraint("list_id", "manga_id", name="UQ_list_items_list_manga"),
        Index("IX_list_items_list_added", "list_id", "added_at"),
        Index("IX_list_items_manga", "manga_id"),
    )

    list_item_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    list_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("reading_lists.list_id", ondelete="CASCADE"), nullable=False
    )
    manga_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("mangas.manga_id", ondelete="CASCADE"), nullable=False
    )
    added_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
