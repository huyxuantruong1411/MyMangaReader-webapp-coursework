"""Async SQLAlchemy 2.x database engine, base metadata, and health checks.

Supports:
- `sqlite+aiosqlite` (zero-credential development & isolated test default)
- `mssql+aioodbc` (existing local SQL Server 2022 `QL_DocTruyen`)
- `postgresql+asyncpg` (cloud Linux deployment portability)
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from sqlalchemy import MetaData, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from manga_reader.config.settings import Settings

logger = logging.getLogger(__name__)

# Aligned with QL_DocTruyen / Lab10 naming conventions
NAMING_CONVENTION: dict[str, str] = {
    "ix": "IX_%(table_name)s_%(column_0_N_name)s",
    "uq": "UQ_%(table_name)s_%(column_0_N_name)s",
    "ck": "CK_%(table_name)s_%(constraint_name)s",
    "fk": "FK_%(table_name)s_%(referred_table_name)s_%(column_0_N_name)s",
    "pk": "PK_%(table_name)s",
}


class Base(DeclarativeBase):
    """Canonical SQLAlchemy 2.x declarative base shared by all persistence models."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


@dataclass(frozen=True, slots=True)
class DatabaseHealth:
    healthy: bool
    backend: str
    mode: str
    detail: str


class DatabaseManager:
    """Manages async SQLAlchemy engine lifecycle and unit-of-work sessions."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._url = settings.resolved_database_url
        self._engine: AsyncEngine = self._create_engine()
        self._session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            bind=self._engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )

    def _create_engine(self) -> AsyncEngine:
        kwargs: dict[str, Any] = {
            "echo": self._settings.database_echo,
            "pool_pre_ping": True,
        }
        if not self._url.startswith("sqlite"):
            kwargs["pool_size"] = self._settings.database_pool_size
            kwargs["max_overflow"] = self._settings.database_max_overflow
            kwargs["pool_recycle"] = 1800
        return create_async_engine(self._url, **kwargs)

    @property
    def engine(self) -> AsyncEngine:
        return self._engine

    @property
    def backend(self) -> str:
        return self._settings.database_backend

    @property
    def adapter_mode(self) -> str:
        return "dev-fallback" if self._settings.database_backend == "sqlite" else "configured"

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """Yield an async SQLAlchemy session with safe cleanup."""
        async with self._session_factory() as db_session:
            yield db_session

    async def check_health(self) -> DatabaseHealth:
        """Execute a lightweight read-only connectivity check without mutating schema."""
        try:
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return DatabaseHealth(
                healthy=True,
                backend=self.backend,
                mode=self.adapter_mode,
                detail="Database connection verified (SELECT 1).",
            )
        except Exception as exc:
            logger.error(
                "Database connectivity check failed",
                extra={"database_backend": self.backend, "error_type": type(exc).__name__},
            )
            return DatabaseHealth(
                healthy=False,
                backend=self.backend,
                mode=self.adapter_mode,
                detail=f"Database unreachable ({type(exc).__name__}).",
            )

    async def dispose(self) -> None:
        await self._engine.dispose()
