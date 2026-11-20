"""Optional read-only connectivity verification against existing local SQL Server `QL_DocTruyen`.

Skips cleanly on machines/CI where ODBC Driver 17 or local `QL_DocTruyen` is unavailable.
Never mutates any table or row in `QL_DocTruyen`.
"""

from __future__ import annotations

import os
import sys

import pytest
from sqlalchemy import text

from manga_reader.config.settings import Settings
from manga_reader.infrastructure.database import DatabaseManager

pytestmark = [pytest.mark.integration, pytest.mark.live_mssql]

DEFAULT_LOCAL_MSSQL_URL = (
    "mssql+aioodbc://@localhost/QL_DocTruyen"
    "?driver=ODBC+Driver+17+for+SQL+Server"
    "&Trusted_Connection=yes&TrustServerCertificate=yes&MARS_Connection=yes"
)


@pytest.mark.skipif(sys.platform != "win32", reason="Local Windows-Auth SQL Server check only.")
async def test_read_only_connectivity_to_local_ql_doctruyen_mssql() -> None:
    mssql_url = os.getenv("LIVE_MSSQL_TEST_URL", DEFAULT_LOCAL_MSSQL_URL)
    settings = Settings(_env_file=None, database_backend="mssql", database_url=mssql_url)
    db = DatabaseManager(settings)
    try:
        health = await db.check_health()
        if not health.healthy:
            pytest.skip(f"Local SQL Server QL_DocTruyen not reachable: {health.detail}")
        async with db.engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES "
                    "WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> 'sysdiagrams'"
                )
            )
            table_count = int(result.scalar_one())
        assert table_count >= 39
    finally:
        await db.dispose()
