"""ORM models for Accounts, Auth, Sessions, Audit Logs, and Transactional Outbox."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from manga_reader.common.clock import utc_now
from manga_reader.infrastructure.database import Base
from manga_reader.infrastructure.orm.types import GUID, UTCDateTime


class AccountModel(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING_VERIFICATION', 'ACTIVE', 'LOCKED')",
            name="status_enum",
        ),
        CheckConstraint("failed_login_attempts >= 0", name="failed_login_nonneg"),
        Index("IX_accounts_status", "status"),
    )

    account_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING_VERIFICATION")
    failed_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    locked_by_admin_account_id: Mapped[UUID | None] = mapped_column(
        GUID(),
        ForeignKey("admins.account_id", ondelete="NO ACTION"),
        nullable=True,
    )
    lock_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_status_change_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ReaderModel(Base):
    __tablename__ = "readers"

    account_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("accounts.account_id", ondelete="CASCADE"),
        primary_key=True,
    )
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    avatar_bucket: Mapped[str | None] = mapped_column(String(63), nullable=True)
    avatar_object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_birth_date_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class AdminModel(Base):
    __tablename__ = "admins"

    account_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("accounts.account_id", ondelete="CASCADE"),
        primary_key=True,
    )
    admin_code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    role_level: Mapped[str] = mapped_column(String(30), nullable=False, default="SUPER_ADMIN")


class UserSessionModel(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (Index("IX_user_sessions_account_active", "account_id", "revoked_at"),)

    session_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("accounts.account_id", ondelete="CASCADE"),
        nullable=False,
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)


class AccountStatusHistoryModel(Base):
    __tablename__ = "account_status_histories"
    __table_args__ = (
        CheckConstraint("action_type IN ('LOCK', 'UNLOCK')", name="action_type_enum"),
        Index("IX_account_status_hist_target", "target_account_id", "action_at"),
    )

    history_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    target_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("accounts.account_id", ondelete="NO ACTION"), nullable=False
    )
    admin_account_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("admins.account_id", ondelete="NO ACTION"), nullable=False
    )
    action_type: Mapped[str] = mapped_column(String(10), nullable=False)
    previous_status: Mapped[str] = mapped_column(String(24), nullable=False)
    new_status: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    action_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class ActivityLogModel(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("IX_activity_logs_account_time", "account_id", "created_at"),
        Index("IX_activity_logs_event_time", "event_type", "created_at"),
        Index("IX_activity_logs_target", "target_type", "target_id"),
    )

    log_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    account_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("accounts.account_id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)


class OutboxEventModel(Base):
    __tablename__ = "outbox_events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'PROCESSED', 'FAILED')",
            name="outbox_status_enum",
        ),
        Index("IX_outbox_events_status_created", "status", "created_at"),
    )

    event_id: Mapped[UUID] = mapped_column(GUID(), primary_key=True, default=uuid4)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    aggregate_type: Mapped[str] = mapped_column(String(60), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utc_now)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
