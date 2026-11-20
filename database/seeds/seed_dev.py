"""Idempotent local development seed runner (foundation stage).

Per Phase 3 scope limits, full domain seed data (users, manga packages, lists)
belongs to Phases 1-3 after `M-001..M-011` migrations are applied. This script
validates DB connectivity and records a non-destructive foundation seed marker
when the foundation bootstrap table is present.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from sqlalchemy import inspect, text

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from manga_reader.common.clock import utc_now  # noqa: E402
from manga_reader.config.settings import Settings  # noqa: E402
from manga_reader.infrastructure.database import DatabaseManager  # noqa: E402


async def run_seed() -> int:
    settings = Settings()
    db = DatabaseManager(settings)
    try:
        health = await db.check_health()
        if not health.healthy:
            print(f"[seed] Database not reachable: {health.detail}")
            return 1

        async with db.engine.begin() as conn:
            tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
            if "schema_foundation_metadata" in tables:
                now = utc_now()
                existing = await conn.execute(
                    text(
                        "SELECT metadata_key FROM schema_foundation_metadata "
                        "WHERE metadata_key = :key"
                    ),
                    {"key": "foundation_seed_version"},
                )
                if existing.first() is None:
                    await conn.execute(
                        text(
                            "INSERT INTO schema_foundation_metadata "
                            "(metadata_key, metadata_value, recorded_at_utc) "
                            "VALUES (:k, :v, :ts)"
                        ),
                        {"k": "foundation_seed_version", "v": "0.1.0-foundation", "ts": now},
                    )
                    print("[seed] Inserted foundation_seed_version marker.")
                else:
                    print("[seed] Foundation seed marker already present (idempotent no-op).")
            else:
                print(
                    "[seed] Connected cleanly. Foundation migration table not present "
                    "(run `pnpm db:migrate` on dev DB before seeding)."
                )
        return 0
    finally:
        await db.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_seed()))
