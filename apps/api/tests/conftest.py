"""Shared pytest fixtures and mock external provider stubs."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from manga_reader.config.settings import Settings
from manga_reader.infrastructure import orm as _orm  # noqa: F401
from manga_reader.infrastructure.database import Base
from manga_reader.main import create_app


@pytest.fixture
def test_settings(tmp_path: Path) -> Settings:
    """Isolated development-safe Settings pointing DB and storage into pytest tmp_path."""
    db_file = tmp_path / "test.sqlite3"
    storage_dir = tmp_path / "storage"
    return Settings(
        _env_file=None,
        app_env="test",
        app_debug=True,
        log_level="WARNING",
        database_backend="sqlite",
        database_url=f"sqlite+aiosqlite:///{db_file.as_posix()}",
        cache_backend="memory",
        storage_backend="local-dev",
        local_storage_root=str(storage_dir),
    )


@pytest.fixture
async def app(test_settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(test_settings)
    async with application.router.lifespan_context(application):
        async with application.state.container.db.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        yield application


@pytest.fixture
async def api_client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client
