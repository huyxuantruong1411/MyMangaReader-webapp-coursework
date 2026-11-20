"""Dialect-portable SQLAlchemy 2.x custom column types (SQLite / MSSQL / PostgreSQL)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CHAR, DateTime, TypeDecorator
from sqlalchemy.dialects.mssql import DATETIME2, UNIQUEIDENTIFIER
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.engine import Dialect


class GUID(TypeDecorator[UUID]):
    """Platform-independent UUID column storing native UNIQUEIDENTIFIER/UUID or CHAR(36)."""

    impl = CHAR(36)
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> Any:
        if dialect.name == "mssql":
            return dialect.type_descriptor(UNIQUEIDENTIFIER())
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value: UUID | str | None, dialect: Dialect) -> Any:
        if value is None:
            return None
        parsed = value if isinstance(value, UUID) else UUID(str(value))
        if dialect.name == "postgresql":
            return parsed
        return str(parsed)

    def process_result_value(self, value: Any, dialect: Dialect) -> UUID | None:
        _ = dialect
        if value is None:
            return None
        if isinstance(value, UUID):
            return value
        return UUID(str(value))


class UTCDateTime(TypeDecorator[datetime]):
    """Enforces timezone-aware UTC datetimes on every read and write across dialects."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> Any:
        if dialect.name == "mssql":
            return dialect.type_descriptor(DATETIME2(3))  # type: ignore[no-untyped-call]
        return dialect.type_descriptor(DateTime(timezone=True))

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        utc_val = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        if dialect.name == "mssql":
            return utc_val.replace(tzinfo=None)
        return utc_val

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        _ = dialect
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
