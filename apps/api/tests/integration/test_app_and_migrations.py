"""Integration tests: app startup, health/readiness, error handling, validation, and migrations."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Query
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect

from manga_reader.common.errors import ResourceNotFoundError
from manga_reader.config.settings import REPO_ROOT, Settings
from manga_reader.infrastructure.database import DatabaseManager
from manga_reader.main import create_app

pytestmark = pytest.mark.integration


async def test_health_liveness_and_correlation_id(api_client: AsyncClient) -> None:
    response = await api_client.get(
        "/api/v1/health",
        headers={"X-Request-ID": "req-smoke-0001"},
    )
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "req-smoke-0001"
    body = response.json()
    assert body["data"]["status"] == "ok"
    assert body["data"]["timestampUtc"].endswith("Z")
    assert body["meta"]["requestId"] == "req-smoke-0001"


async def test_readiness_endpoint_reports_adapters(api_client: AsyncClient) -> None:
    response = await api_client.get("/api/v1/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["data"]["status"] == "ready"
    assert body["data"]["components"]["database"]["healthy"] is True
    assert body["data"]["components"]["cache"]["mode"] == "dev-fallback"
    assert body["data"]["components"]["storage"]["mode"] == "dev-fallback"


async def test_openapi_schema_is_generated(api_client: AsyncClient) -> None:
    response = await api_client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    spec = response.json()
    assert spec["openapi"].startswith("3.")
    assert "/api/v1/health" in spec["paths"]
    assert "/api/v1/health/ready" in spec["paths"]


async def test_centralized_error_handling_and_request_validation(test_settings: Settings) -> None:
    app: FastAPI = create_app(test_settings)

    @app.get("/api/v1/_test/validation")
    async def _validate_endpoint(page: int = Query(ge=1)) -> dict[str, int]:
        return {"page": page}

    @app.get("/api/v1/_test/domain-not-found")
    async def _domain_error_endpoint() -> None:
        raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

    @app.get("/api/v1/_test/unhandled")
    async def _unhandled_endpoint() -> None:
        raise RuntimeError("Sensitive SQL password=supersecret")

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            # 1. Request validation -> 400 VALIDATION_ERROR envelope
            r_val = await client.get("/api/v1/_test/validation?page=0")
            assert r_val.status_code == 400
            val_body = r_val.json()
            assert val_body["error"]["code"] == "VALIDATION_ERROR"
            assert "requestId" in val_body["meta"]

            # 2. Domain AppError -> 404 MANGA_NOT_FOUND
            r_nf = await client.get("/api/v1/_test/domain-not-found")
            assert r_nf.status_code == 404
            assert r_nf.json()["error"]["code"] == "MANGA_NOT_FOUND"

            # 3. Unknown route -> 404 RESOURCE_NOT_FOUND
            r_404 = await client.get("/api/v1/does-not-exist")
            assert r_404.status_code == 404
            assert r_404.json()["error"]["code"] == "RESOURCE_NOT_FOUND"

            # 4. Unhandled exception -> 500 without leaking raw message/secrets
            r_500 = await client.get("/api/v1/_test/unhandled")
            assert r_500.status_code == 500
            body_500 = r_500.json()
            assert body_500["error"]["code"] == "INTERNAL_SERVER_ERROR"
            assert "supersecret" not in r_500.text


async def _run_alembic(args: list[str], *, env: dict[str, str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "alembic",
        "-c",
        "database/alembic.ini",
        *args,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    return int(proc.returncode or 0), stderr.decode("utf-8", errors="replace")


async def test_alembic_upgrade_and_downgrade_on_clean_db(tmp_path: Path) -> None:
    db_file = tmp_path / "alembic_test.sqlite3"
    db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"
    env = {**os.environ, "ALEMBIC_DATABASE_URL": db_url}

    upgrade_rc, upgrade_err = await _run_alembic(["upgrade", "head"], env=env)
    assert upgrade_rc == 0, f"alembic upgrade failed: {upgrade_err}"

    settings = Settings(_env_file=None, database_backend="sqlite", database_url=db_url)
    db = DatabaseManager(settings)
    try:
        async with db.engine.connect() as conn:
            tables = await conn.run_sync(lambda sc: inspect(sc).get_table_names())
        assert "schema_foundation_metadata" in tables
        assert "alembic_version" in tables
    finally:
        await db.dispose()

    downgrade_rc, downgrade_err = await _run_alembic(["downgrade", "base"], env=env)
    assert downgrade_rc == 0, f"alembic downgrade failed: {downgrade_err}"
