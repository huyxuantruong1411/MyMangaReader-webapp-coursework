"""Idempotent local development seed runner populating realistic demo accounts & v2.0 manga.

Demo Credentials (dev only):
- Admin:   username=`admin`   / password=`Admin@123456`
- Reader1: username=`reader1` / password=`Reader@123456`
- Reader2: username=`reader2` / password=`Reader@123456`
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import inspect, select, text

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from manga_reader.common.clock import utc_now  # noqa: E402
from manga_reader.common.identities import AccountId  # noqa: E402
from manga_reader.common.security import AccountRole, AccountStatus, SecurityPrincipal  # noqa: E402
from manga_reader.config.settings import Settings  # noqa: E402
from manga_reader.infrastructure.container import AppContainer  # noqa: E402
from manga_reader.infrastructure.orm import (  # noqa: E402
    AccountModel,
    AdminModel,
    MangaModel,
    ReaderModel,
    ReaderSettingsModel,
)
from manga_reader.modules.comments_reactions.application.service import (  # noqa: E402
    CommentService,
)
from manga_reader.modules.etl_cdc.application.service import EtlCdcService  # noqa: E402
from manga_reader.modules.etl_cdc.infrastructure.sample_upstream import (  # noqa: E402
    build_sample_packages,
    serialize_package,
)
from manga_reader.modules.ratings.application.service import RatingService  # noqa: E402
from manga_reader.modules.reader_engine.application.service import ReaderService  # noqa: E402
from manga_reader.modules.reading_lists.application.service import (  # noqa: E402
    ReadingListService,
)


async def _ensure_account(
    container: AppContainer,
    *,
    username: str,
    email: str,
    password: str,
    display_name: str,
    is_admin: bool = False,
) -> AccountModel:
    async with container.db.session() as db:
        existing = await db.scalar(select(AccountModel).where(AccountModel.username == username))
        if existing is not None:
            return existing
        now = utc_now()
        acc = AccountModel(
            account_id=uuid4(),
            username=username,
            email=email,
            password_hash=container.password_hasher.hash(password),
            status="ACTIVE",
            last_status_change_at=now,
            created_at=now,
        )
        db.add(acc)
        await db.flush()
        if is_admin:
            db.add(
                AdminModel(
                    account_id=acc.account_id,
                    admin_code=f"ADM-{username.upper()}",
                    role_level="SUPER_ADMIN",
                )
            )
        db.add(
            ReaderModel(
                account_id=acc.account_id,
                display_name=display_name,
                bio=f"Demo {'administrator' if is_admin else 'reader'} account.",
                is_birth_date_public=False,
            )
        )
        db.add(ReaderSettingsModel(reader_account_id=acc.account_id, updated_at=now))
        await db.commit()
        return acc


async def run_seed() -> int:
    settings = Settings()
    container = AppContainer(settings)
    try:
        health = await container.db.check_health()
        if not health.healthy:
            print(f"[seed] Database not reachable: {health.detail}")
            return 1

        async with container.db.engine.begin() as conn:
            tables = await conn.run_sync(lambda sc: inspect(sc).get_table_names())
            if "schema_foundation_metadata" in tables:
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
                        {"k": "foundation_seed_version", "v": "1.0.0-full", "ts": utc_now()},
                    )

        if "accounts" not in tables:
            print("[seed] Core domain tables not migrated yet; run `pnpm db:migrate` first.")
            return 0

        await _ensure_account(
            container,
            username="admin",
            email="admin@manga-reader.local",
            password="Admin@123456",
            display_name="Platform Admin",
            is_admin=True,
        )
        reader1 = await _ensure_account(
            container,
            username="reader1",
            email="reader1@manga-reader.local",
            password="Reader@123456",
            display_name="Minh Anh",
        )
        reader2 = await _ensure_account(
            container,
            username="reader2",
            email="reader2@manga-reader.local",
            password="Reader@123456",
            display_name="Quoc Bao",
        )

        # Ingest all 5 sample manga packages through the REAL v2.0 ETL validator/mapper
        etl = EtlCdcService(container)
        samples = await build_sample_packages(container.storage, bucket=settings.s3_default_bucket)
        imported_ids: list[MangaModel] = []
        async with container.db.session() as db:
            for sample in samples:
                await etl.ingest_package_bytes(db, serialize_package(sample.payload))
            await db.commit()
            imported_ids = list(
                (await db.scalars(select(MangaModel).order_by(MangaModel.slug.asc()))).all()
            )

        # Seed realistic reading histories, ratings, comments, and lists idempotently
        p1 = SecurityPrincipal(
            account_id=AccountId(reader1.account_id),
            role=AccountRole.READER,
            status=AccountStatus.ACTIVE,
        )
        p2 = SecurityPrincipal(
            account_id=AccountId(reader2.account_id),
            role=AccountRole.READER,
            status=AccountStatus.ACTIVE,
        )
        reader_svc = ReaderService(container)
        rating_svc = RatingService()
        comment_svc = CommentService(container)
        list_svc = ReadingListService(container)

        async with container.db.session() as db:
            my_lists = await list_svc.list_my_lists(db, principal=p1)
            if not my_lists and len(imported_ids) >= 3:
                fav = await list_svc.create_list(
                    db,
                    principal=p1,
                    name="Fantasy Favorites",
                    description="Hand-picked fantasy and action series.",
                )
                for idx, m in enumerate(imported_ids[:3]):
                    opened = await reader_svc.open_reader(
                        db,
                        manga_ref=str(m.manga_id),
                        action_type="START",
                        chapter_id=None,
                        principal=p1,
                    )
                    if opened["historyId"]:
                        await reader_svc.complete_view_session(
                            db,
                            principal=p1,
                            history_id=uuid4()
                            if not opened["historyId"]
                            else __import__("uuid").UUID(opened["historyId"]),
                            duration_seconds=30,
                        )
                    await rating_svc.upsert_rating(
                        db, principal=p1, manga_id=m.manga_id, score=9 - idx
                    )
                    await reader_svc.set_reading_status(
                        db, principal=p1, manga_id=m.manga_id, status="READING"
                    )
                    await list_svc.sync_manga_memberships(
                        db,
                        principal=p1,
                        manga_id=m.manga_id,
                        selected_list_ids=[__import__("uuid").UUID(fav["listId"])],
                    )
                # Reader 2 signals for User-Based & Item-Based CF
                for m in imported_ids[1:4]:
                    await reader_svc.open_reader(
                        db,
                        manga_ref=str(m.manga_id),
                        action_type="START",
                        chapter_id=None,
                        principal=p2,
                    )
                    await rating_svc.upsert_rating(db, principal=p2, manga_id=m.manga_id, score=8)

                # Sample comment + reply on first manga
                first_manga = imported_ids[0]
                root_c = await comment_svc.create_comment(
                    db,
                    principal=p1,
                    manga_id=first_manga.manga_id,
                    chapter_id=None,
                    parent_comment_id=None,
                    content="Artwork and worldbuilding in the opening chapters are awesome!",
                    is_spoiler=False,
                )
                await comment_svc.create_comment(
                    db,
                    principal=p2,
                    manga_id=first_manga.manga_id,
                    chapter_id=None,
                    parent_comment_id=__import__("uuid").UUID(root_c["commentId"]),
                    content="Agreed! Wait until you see the ending reveal in chapter 2.",
                    is_spoiler=True,
                )
                print(
                    f"[seed] Seeded 3 demo accounts, {len(imported_ids)} v2.0 mangas, "
                    "lists, ratings, histories, and threaded comments."
                )
            else:
                print(f"[seed] Already seeded ({len(imported_ids)} mangas synced idempotently).")
        return 0
    finally:
        await container.shutdown()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_seed()))
