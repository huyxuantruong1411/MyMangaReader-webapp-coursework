"""Live SQL Server (`QL_DocTruyen`) & MinIO (`manga-media`) verification suite.

Covers all 12 domain modules, T-SQL triggers/constraints, and cross-module journeys
(`00..14` Setup specifications) directly against the live local SQL Server instance.
Skips cleanly on non-Windows/CI hosts where ODBC Driver 17 or `QL_DocTruyen` is absent.
All synthetic test artifacts created during mutation tests are cleaned up in `finally`.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError

from manga_reader.common.clock import utc_now
from manga_reader.common.identities import MediaObjectRef
from manga_reader.config.settings import Settings
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.database import DatabaseManager
from manga_reader.infrastructure.orm import (
    AccountModel,
    AccountReportModel,
    AccountStatusHistoryModel,
    ActivityLogModel,
    AdminModel,
    CdcEventModel,
    CommentEditHistoryModel,
    CommentModel,
    CommentReactionModel,
    CommentReportModel,
    CreatorModel,
    EtlJobItemModel,
    EtlJobModel,
    ListItemModel,
    MangaDeletionTombstoneModel,
    MangaModel,
    MangaModerationLogModel,
    MangaReportModel,
    MediaObjectModel,
    OutboxEventModel,
    RatingModel,
    ReaderModel,
    ReaderProgressModel,
    ReaderSettingsModel,
    ReadingHistoryModel,
    ReadingListModel,
    ReadingStatusRecordModel,
    ReportActionHistoryModel,
    ReportModel,
)
from manga_reader.main import create_app
from manga_reader.modules.etl_cdc.infrastructure.sample_upstream import render_placeholder_webp

pytestmark = [pytest.mark.integration, pytest.mark.live_mssql]

DEFAULT_LOCAL_MSSQL_URL = (
    "mssql+aioodbc://@localhost/QL_DocTruyen"
    "?driver=ODBC+Driver+17+for+SQL+Server"
    "&Trusted_Connection=yes&TrustServerCertificate=yes&MARS_Connection=yes"
)


@asynccontextmanager
async def _live_mssql_app(settings: Settings) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    """Boot full FastAPI app wired to live SQL Server `QL_DocTruyen` without DDL mutations."""
    db_probe = DatabaseManager(settings)
    try:
        health = await db_probe.check_health()
        if not health.healthy:
            pytest.skip(f"Local SQL Server QL_DocTruyen not reachable: {health.detail}")
    finally:
        await db_probe.dispose()

    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield app, client


def _extract_last_otp(container: AppContainer) -> str:
    sent = getattr(container.email, "sent_messages", ())
    assert sent, "Expected dispatched OTP email."
    match = re.search(r"\b(\d{6})\b", sent[-1].body_text)
    assert match is not None, f"Could not parse OTP from email: {sent[-1].body_text}"
    return match.group(1)


async def _build_live_v2_package(
    container: AppContainer,
    *,
    pool_manga_id: str,
    source_manga_id: str,
    slug: str,
    creator_id: str,
    creator_slug: str,
    include_ch3: bool = False,
) -> dict[str, Any]:
    bucket = container.settings.s3_default_bucket
    cover_key = f"covers/{pool_manga_id}/cover.webp"
    cover_bytes, cover_md5, cover_sha = render_placeholder_webp(
        title="Chronicles of Live Verification",
        subtitle="SHOUNEN | ONGOING",
        accent_rgb=(56, 189, 248),
        width=600,
        height=860,
    )
    cover_ref = MediaObjectRef(bucket=bucket, object_key=cover_key)
    if not await container.storage.exists(cover_ref):
        await container.storage.put_bytes(cover_ref, cover_bytes, content_type="image/webp")

    ch_specs: list[tuple[str, str, float, str | None, str, str, int]] = [
        (f"{pool_manga_id}_ch0", "Prologue", 0.0, None, "Opening Curtain", "en", 2),
        (f"{pool_manga_id}_ch1", "1", 1.0, "1", "Chapter One", "vi", 1),
    ]
    if include_ch3:
        ch_specs.append((f"{pool_manga_id}_ch2", "2", 2.0, "1", "CDC Epilogue", "en", 1))

    chapters: list[dict[str, Any]] = []
    total_pages = 0
    total_bytes = 0
    langs: set[str] = set()
    for pc_id, ch_num, ch_numeric, vol, ch_title, lang, num_pages in ch_specs:
        langs.add(lang)
        pages_payload: list[dict[str, Any]] = []
        ch_size = 0
        for p_num in range(1, num_pages + 1):
            p_key = f"chapters/{pc_id}/{p_num:03d}.webp"
            p_bytes, p_md5, p_sha = render_placeholder_webp(
                title=f"Live Ch.{ch_num}",
                subtitle=f"{ch_title} · Page {p_num}/{num_pages}",
                accent_rgb=(56, 189, 248),
                width=800,
                height=1150,
            )
            p_ref = MediaObjectRef(bucket=bucket, object_key=p_key)
            if not await container.storage.exists(p_ref):
                await container.storage.put_bytes(p_ref, p_bytes, content_type="image/webp")
            ch_size += len(p_bytes)
            pages_payload.append(
                {
                    "page_uid": f"pg_{pc_id}_{p_num:03d}",
                    "page_number": p_num,
                    "filename": f"{p_num:03d}.webp",
                    "media": {
                        "bucket": bucket,
                        "object_key": p_key,
                        "content_type": "image/webp",
                        "width": 800,
                        "height": 1150,
                        "file_size": len(p_bytes),
                        "md5_hash": p_md5,
                        "sha256": p_sha,
                    },
                }
            )
        total_pages += num_pages
        total_bytes += ch_size
        chapters.append(
            {
                "pool_chapter_id": pc_id,
                "pool_manga_id": pool_manga_id,
                "source_chapter_id": f"src_{pc_id}",
                "chapter_number": ch_num,
                "chapter_numeric": ch_numeric,
                "volume": vol,
                "title": ch_title,
                "language": lang,
                "scanlation_group": "LiveTest Scans",
                "publish_at": "2026-10-01T10:00:00Z",
                "source": "live-test",
                "source_id": f"{pc_id}_src",
                "page_count": num_pages,
                "total_size_bytes": ch_size,
                "pages_revision": 2 if include_ch3 else 1,
                "manifest_sha256": hashlib.sha256(pc_id.encode()).hexdigest(),
                "updated_at": "2026-10-02T10:00:00Z",
                "pages": pages_payload,
            }
        )

    return {
        "contract_name": "manga-reader-package",
        "contract_version": "2.0",
        "exported_at": "2026-11-20T12:00:00Z",
        "manga": {
            "pool_manga_id": pool_manga_id,
            "slug": slug,
            "source_manga_id": source_manga_id,
            "mangadex_id": None,
            "title": "Chronicles of Live Verification",
            "alt_titles": ["Bien Nien Su Kiem Thu Truc Tiep"],
            "description": "Verification fixture manga covering all 12 domain modules on SQL Server.",
            "status": "ongoing",
            "content_rating": "safe",
            "publication_demographic": "shounen",
            "original_language": "ja",
            "year": 2025,
            "published_start_date": "2025-01-01",
            "published_end_date": None,
            "official_volumes": 2,
            "official_chapters": 12,
            "creators": [
                {
                    "creator_id": creator_id,
                    "slug": creator_slug,
                    "name": "Hoshino Live Creator",
                    "role": "author",
                    "mangadex_id": None,
                    "biography": {"en": "Verification manga author and artist."},
                    "links": {"website": "https://example.com/hoshino"},
                },
                {
                    "creator_id": creator_id,
                    "slug": creator_slug,
                    "name": "Hoshino Live Creator",
                    "role": "artist",
                    "mangadex_id": None,
                    "biography": {"en": "Verification manga author and artist."},
                    "links": {"website": "https://example.com/hoshino"},
                },
            ],
            "tags": [
                {
                    "slug": "action",
                    "source_tag_id": "src_tag_action",
                    "mangadex_id": None,
                    "group": "genre",
                    "name": {"en": "Action", "vi": "Hành động"},
                },
                {
                    "slug": "fantasy",
                    "source_tag_id": "src_tag_fantasy",
                    "mangadex_id": None,
                    "group": "genre",
                    "name": {"en": "Fantasy", "vi": "Giả tưởng"},
                },
            ],
            "links": [{"site": "official", "url": "https://example.com/live-manga"}],
            "primary_cover": {
                "bucket": bucket,
                "object_key": cover_key,
                "content_type": "image/webp",
                "width": 600,
                "height": 860,
                "file_size": len(cover_bytes),
                "md5_hash": cover_md5,
                "sha256": cover_sha,
            },
            "cover_arts": [
                {
                    "cover_id": f"{pool_manga_id}_cov1",
                    "volume": "1",
                    "locale": "ja",
                    "description": "Primary cover art",
                    "media": {
                        "bucket": bucket,
                        "object_key": cover_key,
                        "content_type": "image/webp",
                        "width": 600,
                        "height": 860,
                        "file_size": len(cover_bytes),
                        "md5_hash": cover_md5,
                        "sha256": cover_sha,
                    },
                }
            ],
            "stats": {
                "chapter_count": len(chapters),
                "page_count": total_pages,
                "total_size_bytes": total_bytes,
                "languages": sorted(langs),
            },
            "lineage": {
                "pool_revision": 2 if include_ch3 else 1,
                "source_metadata_revision": 1,
                "manifest_sha256": hashlib.sha256(pool_manga_id.encode()).hexdigest(),
                "published_at": "2026-11-18T08:00:00Z",
                "updated_at": "2026-11-20T10:00:00Z",
            },
        },
        "chapters": chapters,
    }


@pytest.mark.skipif(sys.platform != "win32", reason="Local Windows-Auth SQL Server check only.")
async def test_live_mssql_catalog_detail_search_recs_and_minio_read_only() -> None:
    """Read-only check across real 86,867-title SQL Server catalog, rated detail, search & MinIO."""
    mssql_url = os.getenv("LIVE_MSSQL_TEST_URL", DEFAULT_LOCAL_MSSQL_URL)
    settings = Settings(
        _env_file=None,
        app_env="test",
        database_backend="mssql",
        database_url=mssql_url,
        cache_backend="memory",
        storage_backend="minio",
        s3_endpoint_url=os.getenv("S3_ENDPOINT_URL", "http://127.0.0.1:9010"),
        s3_access_key=os.getenv("S3_ACCESS_KEY", "mangaadmin"),
        s3_secret_key=os.getenv("S3_SECRET_KEY", "MangaMinio2026!"),
        s3_default_bucket="manga-media",
        s3_allowed_buckets="manga-media,manga-reader-media",
        mangadex_fallback_enabled=True,
    )
    async with _live_mssql_app(settings) as (app, client):
        # 1. Health & schema presence
        async with app.state.container.db.engine.connect() as conn:
            table_count = int(
                (
                    await conn.execute(
                        text(
                            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES "
                            "WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> 'sysdiagrams'"
                        )
                    )
                ).scalar_one()
            )
            assert table_count >= 39

        # 2. Catalog listing (86,866+ public titles), tags, facets & safe!=unknown
        tags_res = await client.get("/api/v1/tags")
        assert tags_res.status_code == 200
        assert len(tags_res.json()["data"]) >= 70

        cat_res = await client.get("/api/v1/manga?page=1&pageSize=24&sort=UPDATED_DESC")
        assert cat_res.status_code == 200
        assert cat_res.json()["meta"]["total"] >= 86866

        facet_res = await client.get(
            "/api/v1/manga?includeTags=action,fantasy&tagMode=GROUP_OR"
            "&demographic=shounen,seinen&status=ongoing,completed"
            "&contentRating=safe&yearFrom=2000&yearTo=2026&sort=RATING_DESC&pageSize=12"
        )
        assert facet_res.status_code == 200
        for card in facet_res.json()["data"]:
            assert card["contentRating"] == "safe"

        and_res = await client.get(
            "/api/v1/manga?includeTags=action,fantasy&tagMode=ALL_AND&pageSize=5"
        )
        assert and_res.status_code == 200

        # 3. Real rated manga detail (regression check for `RatingModel.is_removed == false()`)
        detail_res = await client.get("/api/v1/manga/mysterious-disappearances")
        assert detail_res.status_code == 200, detail_res.text
        detail = detail_res.json()["data"]
        assert detail["ratingCount"] >= 1
        assert detail["averageRating"] > 0
        manga_id = detail["mangaId"]

        # 4. Signed cover media proxy (MinIO zero-copy / fallback stream)
        if detail["coverUrl"]:
            media_path = detail["coverUrl"][detail["coverUrl"].index("/api/v1/media/") :]
            cov_res = await client.get(media_path)
            assert cov_res.status_code == 200
            assert cov_res.headers["content-type"].startswith("image/")

        # 5. Chapters, rating summary, comments, recommendations (both precomputed & on-the-fly vector)
        ch_res = await client.get(f"/api/v1/manga/{manga_id}/chapters?order=ASC")
        assert ch_res.status_code == 200

        rate_res = await client.get(f"/api/v1/manga/{manga_id}/rating")
        assert rate_res.status_code == 200
        assert rate_res.json()["data"]["ratingCount"] >= 1

        cm_res = await client.get(f"/api/v1/comments?mangaId={manga_id}&sort=TOP_LIKED")
        assert cm_res.status_code == 200

        rec_cb = await client.get(f"/api/v1/manga/{manga_id}/recommendations?type=CONTENT_BASED")
        assert rec_cb.status_code == 200
        assert len(rec_cb.json()["data"]["items"]) >= 1

        rec_item = await client.get(f"/api/v1/manga/{manga_id}/recommendations?type=ITEM_BASED")
        assert rec_item.status_code == 200

        # 6. Autocomplete, full search & creator lookup
        ac_res = await client.get("/api/v1/manga/autocomplete?q=Mysterious")
        assert ac_res.status_code == 200
        assert len(ac_res.json()["data"]) <= 10

        search_res = await client.get("/api/v1/manga/search?q=Mysterious")
        assert search_res.status_code == 200
        assert search_res.json()["meta"]["total"] >= 1

        if detail["creators"]:
            cid = detail["creators"][0]["creatorId"]
            cr_det = await client.get(f"/api/v1/creators/{cid}")
            assert cr_det.status_code == 200
            cr_works = await client.get(f"/api/v1/creators/{cid}/manga")
            assert cr_works.status_code == 200


@pytest.mark.skipif(sys.platform != "win32", reason="Local Windows-Auth SQL Server check only.")
async def test_live_mssql_full_12_module_end_to_end_and_triggers(tmp_path: Path) -> None:
    """Execute end-to-end tests for Modules 1..12 against live `QL_DocTruyen` and clean up."""
    mssql_url = os.getenv("LIVE_MSSQL_TEST_URL", DEFAULT_LOCAL_MSSQL_URL)
    settings = Settings(
        _env_file=None,
        app_env="test",
        database_backend="mssql",
        database_url=mssql_url,
        cache_backend="memory",
        storage_backend="local-dev",
        local_storage_root=str(tmp_path / "storage"),
        otp_resend_cooldown_seconds=10,
        valid_view_threshold_seconds=5,
        mangadex_fallback_enabled=False,
    )
    suffix = uuid4().hex[:8]
    pool_manga_id = f"pm_live_test_{suffix}"
    source_manga_id = f"src_live_test_{suffix}"
    manga_slug = f"live-verification-{suffix}"
    creator_id = f"cr_live_test_{suffix}"
    creator_slug = f"hoshino-live-{suffix}"

    created_account_ids: list[UUID] = []
    created_list_ids: list[UUID] = []
    created_report_ids: list[UUID] = []
    created_job_ids: list[UUID] = []
    created_manga_id: UUID | None = None
    created_cdc_external_ids: list[str] = []

    async with _live_mssql_app(settings) as (app, client):
        container: AppContainer = app.state.container
        try:
            # 1. Seed temporary Admin directly in QL_DocTruyen
            admin_id = uuid4()
            created_account_ids.append(admin_id)
            admin_username = f"adm_live_{suffix}"
            admin_pw = "AdminLive@1234"
            now = utc_now()
            async with container.db.session() as db:
                db.add(
                    AccountModel(
                        account_id=admin_id,
                        username=admin_username,
                        email=f"{admin_username}@test.local",
                        password_hash=container.password_hasher.hash(admin_pw),
                        status="ACTIVE",
                        last_status_change_at=now,
                        created_at=now,
                    )
                )
                await db.flush()
                db.add(
                    AdminModel(
                        account_id=admin_id, admin_code=f"ADM-{suffix}", role_level="SUPER_ADMIN"
                    )
                )
                db.add(ReaderModel(account_id=admin_id, display_name="Live Test Admin"))
                db.add(ReaderSettingsModel(reader_account_id=admin_id, updated_at=now))
                await db.commit()

            admin_login = await client.post(
                "/api/v1/auth/login", json={"identifier": admin_username, "password": admin_pw}
            )
            assert admin_login.status_code == 200, admin_login.text
            admin_hdr = {"Authorization": f"Bearer {admin_login.json()['data']['accessToken']}"}

            # Trigger check (`trg_account_status_histories_guard`): Admin cannot lock Admin
            lock_admin = await client.post(
                f"/api/v1/admin/accounts/{admin_id}/lock",
                headers=admin_hdr,
                json={"reason": "Should fail"},
            )
            assert lock_admin.status_code == 403

            # 2. Module 4 (`etl_cdc`): batch import with per-manga failure isolation
            pkg = await _build_live_v2_package(
                container,
                pool_manga_id=pool_manga_id,
                source_manga_id=source_manga_id,
                slug=manga_slug,
                creator_id=creator_id,
                creator_slug=creator_slug,
            )
            bad_pkg = {
                "contract_name": "manga-reader-package",
                "contract_version": "9.9",
                "exported_at": "2026-11-20T12:00:00Z",
                "manga": {
                    "pool_manga_id": f"bad_{suffix}",
                    "slug": "bad",
                    "source_manga_id": "bad",
                    "title": "Bad",
                },
            }
            etl_res = await client.post(
                "/api/v1/admin/etl-sync",
                headers=admin_hdr,
                json={
                    "items": [
                        {
                            "poolMangaId": pool_manga_id,
                            "sourceMangaId": source_manga_id,
                            "enableCdc": True,
                            "packagePayload": pkg,
                        },
                        {
                            "poolMangaId": f"bad_{suffix}",
                            "sourceMangaId": "bad",
                            "enableCdc": False,
                            "packagePayload": bad_pkg,
                        },
                    ]
                },
            )
            assert etl_res.status_code == 202, etl_res.text
            job_data = etl_res.json()["data"]
            created_job_ids.append(UUID(job_data["jobId"]))
            assert job_data["status"] == "PARTIAL_FAILED", job_data
            ok_item = next(it for it in job_data["items"] if it["status"] == "SUCCEEDED")
            created_manga_id = UUID(ok_item["mangaId"])

            # Verify ETL jobs query & CDC toggle
            assert (
                await client.get("/api/v1/admin/etl-jobs", headers=admin_hdr)
            ).status_code == 200
            assert (
                await client.get(f"/api/v1/admin/etl-jobs/{job_data['jobId']}", headers=admin_hdr)
            ).status_code == 200
            assert (
                await client.post(
                    f"/api/v1/admin/manga/{created_manga_id}/cdc/disable", headers=admin_hdr
                )
            ).status_code == 200
            assert (
                await client.post(
                    f"/api/v1/admin/manga/{created_manga_id}/cdc/enable", headers=admin_hdr
                )
            ).status_code == 200

            # 3. Module 1 (`account_auth`): register, OTP verify, replay guard, login, refresh, profile, avatar, password
            async def _register_verify_login(u: str) -> tuple[UUID, str, str]:
                email = f"{u}@test.local"
                pw = "ReaderLive@1234"
                reg = await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": email,
                        "username": u,
                        "password": pw,
                        "displayName": f"User {u}",
                    },
                )
                assert reg.status_code == 201, reg.text
                aid = UUID(reg.json()["data"]["accountId"])
                created_account_ids.append(aid)

                assert (
                    await client.post("/api/v1/auth/login", json={"identifier": u, "password": pw})
                ).status_code == 403
                otp = _extract_last_otp(container)
                ver = await client.post(
                    "/api/v1/auth/verify-otp", json={"email": email, "code": otp}
                )
                assert ver.status_code == 200
                assert (
                    await client.post("/api/v1/auth/verify-otp", json={"email": email, "code": otp})
                ).status_code == 422

                lg = await client.post(
                    "/api/v1/auth/login", json={"identifier": email, "password": pw}
                )
                assert lg.status_code == 200
                return (
                    aid,
                    str(lg.json()["data"]["accessToken"]),
                    str(lg.cookies.get("mr_refresh_token", "")),
                )

            r1_id, r1_tok, r1_refresh = await _register_verify_login(f"r_live_a_{suffix}")
            r2_id, r2_tok, _ = await _register_verify_login(f"r_live_b_{suffix}")

            ref = await client.post("/api/v1/auth/refresh", json={"refreshToken": r1_refresh})
            assert ref.status_code == 200
            r1_tok = str(ref.json()["data"]["accessToken"])
            r1_hdr = {"Authorization": f"Bearer {r1_tok}"}
            r2_hdr = {"Authorization": f"Bearer {r2_tok}"}

            # Profile privacy & avatar upload
            assert (
                await client.patch(
                    "/api/v1/account/profile", headers=r1_hdr, json={"displayName": "System Admin"}
                )
            ).status_code == 400
            prof_ok = await client.patch(
                "/api/v1/account/profile",
                headers=r1_hdr,
                json={
                    "displayName": "Reader Live A",
                    "bio": "<script>x</script>Bio text",
                    "birthDate": "2000-05-01",
                    "isBirthDatePublic": False,
                },
            )
            assert prof_ok.status_code == 200
            other_view = (
                await client.get(f"/api/v1/accounts/{r1_id}/profile", headers=r2_hdr)
            ).json()["data"]
            assert other_view["birthDate"] is None and "email" not in other_view

            buf = io.BytesIO()
            Image.new("RGB", (32, 32), (30, 144, 255)).save(buf, format="PNG")
            av = await client.post(
                "/api/v1/account/avatar",
                headers=r1_hdr,
                files={"file": ("av.png", buf.getvalue(), "image/png")},
            )
            assert av.status_code == 200 and "/api/v1/media/" in av.json()["data"]["avatarUrl"]
            assert (
                await client.get("/api/v1/admin/accounts", headers=admin_hdr, params={"q": suffix})
            ).status_code == 200

            # 4. Module 3 (`catalog_discovery`) & Module 2 (`hide` / `show`)
            detail_r1 = await client.get(f"/api/v1/manga/{manga_slug}", headers=r1_hdr)
            assert detail_r1.status_code == 200
            assert detail_r1.json()["data"]["viewerState"]["canRate"] is False

            assert (await client.get(f"/api/v1/creators/{creator_id}/manga")).status_code == 200

            assert (
                await client.post(
                    f"/api/v1/admin/manga/{created_manga_id}/hide",
                    headers=admin_hdr,
                    json={"reason": "QA check"},
                )
            ).status_code == 200
            assert (await client.get(f"/api/v1/manga/{manga_slug}")).status_code == 404
            assert (
                await client.post(f"/api/v1/admin/manga/{created_manga_id}/show", headers=admin_hdr)
            ).status_code == 200

            # 5. CDC Chapter Upsert & Chapter Delete (verifies ReaderProgress NO ACTION FK handling)
            evt_add_id = f"evt_add_{suffix}"
            created_cdc_external_ids.append(evt_add_id)
            pkg_ch3 = await _build_live_v2_package(
                container,
                pool_manga_id=pool_manga_id,
                source_manga_id=source_manga_id,
                slug=manga_slug,
                creator_id=creator_id,
                creator_slug=creator_slug,
                include_ch3=True,
            )
            cdc_add = await client.post(
                "/api/v1/webhooks/cdc",
                content=json.dumps(
                    {
                        "eventId": evt_add_id,
                        "eventType": "CHAPTER_CREATED",
                        "poolMangaId": pool_manga_id,
                        "poolChapterId": f"{pool_manga_id}_ch2",
                        "poolRevision": 2,
                        "payload": pkg_ch3,
                    }
                ),
            )
            assert cdc_add.status_code == 202 and cdc_add.json()["data"]["status"] == "PROCESSED"
            cdc_dup = await client.post(
                "/api/v1/webhooks/cdc",
                content=json.dumps(
                    {
                        "eventId": evt_add_id,
                        "eventType": "CHAPTER_CREATED",
                        "poolMangaId": pool_manga_id,
                    }
                ),
            )
            assert cdc_dup.json()["data"]["duplicate"] is True

            # 6. Module 5 & 6 (`reader_engine` & `reading_status_history`)
            chapters = (
                await client.get(f"/api/v1/manga/{created_manga_id}/chapters?order=ASC")
            ).json()["data"]
            assert [c["chapterNumber"] for c in chapters] == ["Prologue", "1", "2"]
            ch2_id = chapters[2]["chapterId"]

            # Open Ch.2 directly, save progress on Ch.2, then test CDC CHAPTER_DELETED cleanly!
            open_ch2 = await client.get(
                f"/api/v1/reader/open?mangaId={created_manga_id}&actionType=SELECT&chapterId={ch2_id}",
                headers=r1_hdr,
            )
            assert open_ch2.status_code == 200
            assert (
                await client.put(
                    "/api/v1/reader/progress",
                    headers=r1_hdr,
                    json={
                        "mangaId": str(created_manga_id),
                        "chapterId": ch2_id,
                        "pageNumber": 1,
                        "pagesRevision": 2,
                        "clientSequence": 3,
                    },
                )
            ).status_code == 200

            evt_del_id = f"evt_del_{suffix}"
            created_cdc_external_ids.append(evt_del_id)
            cdc_del = await client.post(
                "/api/v1/webhooks/cdc",
                content=json.dumps(
                    {
                        "eventId": evt_del_id,
                        "eventType": "CHAPTER_DELETED",
                        "poolMangaId": pool_manga_id,
                        "poolChapterId": f"{pool_manga_id}_ch2",
                        "poolRevision": 3,
                    }
                ),
            )
            assert cdc_del.status_code == 202 and cdc_del.json()["data"]["status"] == "PROCESSED"

            # Open START (Prologue), check stale conflict & chapter-switch client_sequence reset, valid view trigger!
            open_start = await client.get(
                f"/api/v1/reader/open?mangaId={created_manga_id}&actionType=START",
                headers=r1_hdr,
            )
            assert open_start.status_code == 200
            start_data = open_start.json()["data"]
            ch0_id = start_data["chapter"]["chapterId"]
            hist_id = start_data["historyId"]

            # Save progress with higher sequence, then test stale rejection, then switch to ch1 and reset sequence=1
            assert (
                await client.put(
                    "/api/v1/reader/progress",
                    headers=r1_hdr,
                    json={
                        "mangaId": str(created_manga_id),
                        "chapterId": ch0_id,
                        "pageNumber": 2,
                        "pagesRevision": 1,
                        "clientSequence": 10,
                    },
                )
            ).status_code == 200
            assert (
                await client.put(
                    "/api/v1/reader/progress",
                    headers=r1_hdr,
                    json={
                        "mangaId": str(created_manga_id),
                        "chapterId": ch0_id,
                        "pageNumber": 1,
                        "pagesRevision": 1,
                        "clientSequence": 2,
                    },
                )
            ).status_code == 409

            ch1_id = chapters[1]["chapterId"]
            assert (
                await client.get(
                    f"/api/v1/reader/open?mangaId={created_manga_id}&actionType=SELECT&chapterId={ch1_id}",
                    headers=r1_hdr,
                )
            ).status_code == 200
            assert (
                await client.put(
                    "/api/v1/reader/progress",
                    headers=r1_hdr,
                    json={
                        "mangaId": str(created_manga_id),
                        "chapterId": ch1_id,
                        "pageNumber": 1,
                        "pagesRevision": 1,
                        "clientSequence": 1,
                    },
                )
            ).status_code == 200

            assert (
                await client.post(
                    f"/api/v1/reader/view-session/{hist_id}/complete",
                    headers=r1_hdr,
                    json={"durationSeconds": 15},
                )
            ).json()["data"]["isValidView"] is True
            # Verify SQL Server trigger `trg_reading_histories_count_valid_views` updated `total_views`
            assert (await client.get(f"/api/v1/manga/{manga_slug}")).json()["data"][
                "totalViews"
            ] == 1

            assert (
                await client.put(
                    "/api/v1/reader/settings",
                    headers=r1_hdr,
                    json={
                        "displayMode": "DOUBLE_PAGE",
                        "readingDirection": "RTL",
                        "fitMode": "FIT_HEIGHT",
                        "preloadPageCount": 4,
                    },
                )
            ).status_code == 200
            assert (await client.get("/api/v1/reader/history", headers=r1_hdr)).status_code == 200
            assert (
                await client.put(
                    f"/api/v1/manga/{created_manga_id}/reading-status",
                    headers=r1_hdr,
                    json={"status": "READING"},
                )
            ).status_code == 200
            assert (
                len(
                    (await client.get("/api/v1/account/me/reading-status", headers=r1_hdr)).json()[
                        "data"
                    ]
                )
                == 1
            )

            # 7. Module 7 (`ratings`) & Decimal Average Trigger check
            assert (
                await client.put(
                    f"/api/v1/manga/{created_manga_id}/rating", headers=r2_hdr, json={"score": 8}
                )
            ).status_code == 422
            assert (
                await client.put(
                    f"/api/v1/manga/{created_manga_id}/rating", headers=r1_hdr, json={"score": 9}
                )
            ).status_code == 200
            # Open chapter with r2, then rate 8 -> average of 9 and 8 MUST be 8.5 (no MSSQL integer truncation)
            assert (
                await client.get(
                    f"/api/v1/reader/open?mangaId={created_manga_id}&actionType=START",
                    headers=r2_hdr,
                )
            ).status_code == 200
            r2_rate = await client.put(
                f"/api/v1/manga/{created_manga_id}/rating", headers=r2_hdr, json={"score": 8}
            )
            assert r2_rate.status_code == 200
            assert r2_rate.json()["data"]["averageRating"] == 8.5
            assert (
                await client.delete(f"/api/v1/manga/{created_manga_id}/rating", headers=r2_hdr)
            ).json()["data"]["averageRating"] == 9.0
            assert (
                len(
                    (await client.get("/api/v1/account/me/rating-history", headers=r1_hdr)).json()[
                        "data"
                    ]
                )
                == 1
            )

            # 8. Module 8 (`comments_reactions`) & trg_comment_reactions_sync_counts
            c_root = (
                await client.post(
                    "/api/v1/comments",
                    headers=r1_hdr,
                    json={
                        "mangaId": str(created_manga_id),
                        "content": "Live SQL comment",
                        "isSpoiler": False,
                    },
                )
            ).json()["data"]
            root_cid = c_root["commentId"]
            c_rep = await client.post(
                "/api/v1/comments",
                headers=r2_hdr,
                json={
                    "mangaId": str(created_manga_id),
                    "parentCommentId": root_cid,
                    "content": "Live reply",
                    "isSpoiler": False,
                },
            )
            assert c_rep.status_code == 201
            assert (
                await client.put(
                    f"/api/v1/comments/{root_cid}/reaction",
                    headers=r2_hdr,
                    json={"reactionType": "LIKE"},
                )
            ).json()["data"]["likeCount"] == 1
            assert (
                await client.put(
                    f"/api/v1/comments/{root_cid}/reaction",
                    headers=r2_hdr,
                    json={"reactionType": "DISLIKE"},
                )
            ).json()["data"]["dislikeCount"] == 1

            # 9. Module 10 (`reading_lists`) & trg_list_items_sync_item_count
            list_a = (
                await client.post(
                    "/api/v1/lists", headers=r1_hdr, json={"name": f"Shelf A {suffix}"}
                )
            ).json()["data"]
            list_b = (
                await client.post(
                    "/api/v1/lists/quick-create", headers=r1_hdr, json={"name": f"Shelf B {suffix}"}
                )
            ).json()["data"]
            created_list_ids.extend([UUID(list_a["listId"]), UUID(list_b["listId"])])
            assert (
                await client.get(f"/api/v1/lists/{list_a['listId']}", headers=r2_hdr)
            ).status_code == 404

            await client.put(
                f"/api/v1/manga/{created_manga_id}/my-list-memberships",
                headers=r1_hdr,
                json={"selectedListIds": [list_a["listId"], list_b["listId"]]},
            )
            merged = (
                await client.post(
                    "/api/v1/lists/merge-create",
                    headers=r1_hdr,
                    json={
                        "sourceListIds": [list_a["listId"], list_b["listId"]],
                        "newName": f"Merged {suffix}",
                    },
                )
            ).json()["data"]
            created_list_ids.append(UUID(merged["listId"]))
            assert merged["itemCount"] == 1
            stats = (
                await client.get(f"/api/v1/lists/{merged['listId']}/metadata-stats", headers=r1_hdr)
            ).json()["data"]
            assert stats["totalMangas"] == 1 and stats["averageListRating"] == 9.0
            list_items = await client.get(
                f"/api/v1/lists/{merged['listId']}/manga",
                headers=r1_hdr,
                params={"q": "Verification", "sort": "RATING_DESC"},
            )
            assert list_items.status_code == 200 and len(list_items.json()["data"]) == 1
            assert (
                await client.delete(
                    f"/api/v1/lists/{merged['listId']}/manga/{created_manga_id}", headers=r1_hdr
                )
            ).json()["data"]["itemCount"] == 0
            assert (
                await client.delete(f"/api/v1/lists/{merged['listId']}", headers=r1_hdr)
            ).status_code == 200
            created_list_ids.remove(UUID(merged["listId"]))

            # 10. Module 11 (`recommendations`)
            assert (
                await client.get(
                    f"/api/v1/manga/{created_manga_id}/recommendations?type=CONTENT_BASED"
                )
            ).status_code == 200
            assert (
                await client.get("/api/v1/recommendations/me", headers=r1_hdr)
            ).status_code == 200

            # 11. Module 9 (`moderation_reporting`) + Module 2 (`delete_manga`) + Module 12 (`admin_analytics`)
            assert (
                await client.get("/api/v1/admin/manga", headers=admin_hdr, params={"q": suffix})
            ).status_code == 200
            assert (
                await client.get(
                    "/api/v1/admin/reports", headers=admin_hdr, params={"status": "ALL"}
                )
            ).status_code == 200
            assert (
                await client.post(
                    "/api/v1/reports/comment",
                    headers=r1_hdr,
                    json={"targetCommentId": root_cid, "reasonCategory": "SPAM"},
                )
            ).status_code == 422

            rep_cm = await client.post(
                "/api/v1/reports/comment",
                headers=r2_hdr,
                json={"targetCommentId": root_cid, "reasonCategory": "SPOILER"},
            )
            assert rep_cm.status_code == 201
            rep_cm_id = UUID(rep_cm.json()["data"]["reportId"])
            created_report_ids.append(rep_cm_id)
            assert (
                await client.post(
                    "/api/v1/reports/comment",
                    headers=r2_hdr,
                    json={"targetCommentId": root_cid, "reasonCategory": "SPOILER"},
                )
            ).status_code == 409
            assert (
                await client.post(
                    f"/api/v1/admin/reports/{rep_cm_id}/resolve",
                    headers=admin_hdr,
                    json={"actionType": "FORCE_SPOILER", "note": "Spoiler confirmed"},
                )
            ).json()["data"]["status"] == "RESOLVED"

            # Manga report + ignoreFutureReports switch + auto-ignore check (`ADR-006`)
            rep_m1 = await client.post(
                "/api/v1/reports/manga",
                headers=r1_hdr,
                json={"targetMangaId": str(created_manga_id), "reasonCategory": "OTHER"},
            )
            assert rep_m1.status_code == 201
            rep_m1_id = UUID(rep_m1.json()["data"]["reportId"])
            created_report_ids.append(rep_m1_id)
            assert (
                await client.post(
                    f"/api/v1/admin/reports/{rep_m1_id}/resolve",
                    headers=admin_hdr,
                    json={
                        "actionType": "IGNORE",
                        "note": "Ignore future false flags",
                        "ignoreFutureReports": True,
                    },
                )
            ).json()["data"]["status"] == "IGNORED"
            rep_m2 = await client.post(
                "/api/v1/reports/manga",
                headers=r2_hdr,
                json={"targetMangaId": str(created_manga_id), "reasonCategory": "OTHER"},
            )
            assert rep_m2.status_code == 201 and rep_m2.json()["data"]["status"] == "IGNORED"
            created_report_ids.append(UUID(rep_m2.json()["data"]["reportId"]))

            rep_acc = await client.post(
                "/api/v1/reports/account",
                headers=r1_hdr,
                json={"targetAccountId": str(r2_id), "reasonCategory": "ABUSE"},
            )
            rep_acc_id = UUID(rep_acc.json()["data"]["reportId"])
            created_report_ids.append(rep_acc_id)
            assert (
                await client.post(
                    f"/api/v1/admin/reports/{rep_acc_id}/resolve",
                    headers=admin_hdr,
                    json={"actionType": "LOCK_ACCOUNT", "note": "Confirmed abuse"},
                )
            ).json()["data"]["status"] == "RESOLVED"
            assert (await client.get("/api/v1/account/me", headers=r2_hdr)).status_code == 401
            assert (
                await client.post(
                    f"/api/v1/admin/accounts/{r2_id}/unlock",
                    headers=admin_hdr,
                    json={"reason": "Restored"},
                )
            ).status_code == 200

            # Module 2 delete_manga: verify is_syncing=True blocked (409), then delete + tombstone
            async with container.db.session() as db:
                await db.execute(
                    update(MangaModel)
                    .where(MangaModel.manga_id == created_manga_id)
                    .values(is_syncing=True)
                )
                await db.commit()
            assert (
                await client.post(
                    f"/api/v1/admin/manga/{created_manga_id}/delete",
                    headers=admin_hdr,
                    json={"reason": "Should fail while syncing"},
                )
            ).status_code == 409
            async with container.db.session() as db:
                await db.execute(
                    update(MangaModel)
                    .where(MangaModel.manga_id == created_manga_id)
                    .values(is_syncing=False)
                )
                await db.commit()
            del_manga = await client.post(
                f"/api/v1/admin/manga/{created_manga_id}/delete",
                headers=admin_hdr,
                json={"reason": "Cleanup test manga"},
            )
            assert del_manga.status_code == 200 and del_manga.json()["data"]["tombstoned"] is True

            # Verify password change + logout work cleanly on MSSQL
            assert (
                await client.put(
                    "/api/v1/account/password",
                    headers=r1_hdr,
                    json={"currentPassword": "ReaderLive@1234", "newPassword": "ReaderLive@5678"},
                )
            ).status_code == 200
            assert (await client.post("/api/v1/auth/logout", headers=r1_hdr)).status_code == 200
            assert (await client.get("/api/v1/account/me", headers=r1_hdr)).status_code == 401
            r1_relogin = await client.post(
                "/api/v1/auth/login",
                json={"identifier": f"r_live_a_{suffix}", "password": "ReaderLive@5678"},
            )
            assert r1_relogin.status_code == 200
            r1_hdr = {"Authorization": f"Bearer {r1_relogin.json()['data']['accessToken']}"}

            # Verify delayed CDC cannot resurrect tombstoned manga
            evt_dead_id = f"evt_dead_{suffix}"
            created_cdc_external_ids.append(evt_dead_id)
            dead_cdc = await client.post(
                "/api/v1/webhooks/cdc",
                content=json.dumps(
                    {
                        "eventId": evt_dead_id,
                        "eventType": "CHAPTER_CREATED",
                        "poolMangaId": pool_manga_id,
                        "poolRevision": 99,
                    }
                ),
            )
            assert dead_cdc.json()["data"]["reason"] == "MANGA_TOMBSTONED"

            # Module 12 analytics & immutability trigger (`51011`)
            assert (
                await client.get("/api/v1/account/me/reading-statistics", headers=r1_hdr)
            ).status_code == 200
            assert (
                await client.get(
                    f"/api/v1/admin/accounts/{r1_id}/reading-statistics", headers=admin_hdr
                )
            ).status_code == 200
            assert (
                await client.get(f"/api/v1/admin/accounts/{r1_id}/activity-logs", headers=admin_hdr)
            ).status_code == 200
            assert (
                await client.get("/api/v1/admin/manga/statistics", headers=admin_hdr)
            ).status_code == 200
            assert (
                await client.get("/api/v1/admin/activity-logs", headers=admin_hdr)
            ).status_code == 200
            assert (
                await client.post("/api/v1/admin/reconcile", headers=admin_hdr)
            ).status_code == 200

            async with container.db.session() as db:
                with pytest.raises(DBAPIError, match=r"51011|NHẬT KÝ HOẠT ĐỘNG|INSTEAD OF"):
                    await db.execute(text("UPDATE activity_logs SET event_type = 'TAMPERED'"))
                    await db.commit()
                await db.rollback()
        finally:
            # Pristine teardown of synthetic test rows from QL_DocTruyen
            async with container.db.session() as clean_db:
                if created_cdc_external_ids:
                    await clean_db.execute(
                        delete(CdcEventModel).where(
                            CdcEventModel.external_event_id.in_(created_cdc_external_ids)
                        )
                    )
                if created_job_ids:
                    await clean_db.execute(
                        delete(EtlJobItemModel).where(EtlJobItemModel.job_id.in_(created_job_ids))
                    )
                    await clean_db.execute(
                        delete(EtlJobModel).where(EtlJobModel.job_id.in_(created_job_ids))
                    )
                if created_account_ids:
                    await clean_db.execute(
                        delete(MangaModerationLogModel).where(
                            MangaModerationLogModel.admin_account_id.in_(created_account_ids)
                        )
                    )
                if created_manga_id is not None:
                    await clean_db.execute(
                        delete(MangaModerationLogModel).where(
                            MangaModerationLogModel.pool_manga_id == pool_manga_id
                        )
                    )
                if created_report_ids:
                    await clean_db.execute(
                        delete(ReportActionHistoryModel).where(
                            ReportActionHistoryModel.report_id.in_(created_report_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(AccountReportModel).where(
                            AccountReportModel.report_id.in_(created_report_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(MangaReportModel).where(
                            MangaReportModel.report_id.in_(created_report_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(CommentReportModel).where(
                            CommentReportModel.report_id.in_(created_report_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(ReportModel).where(ReportModel.report_id.in_(created_report_ids))
                    )
                if created_manga_id is not None:
                    await clean_db.execute(
                        delete(ReaderProgressModel).where(
                            ReaderProgressModel.manga_id == created_manga_id
                        )
                    )
                    await clean_db.execute(
                        delete(CommentModel).where(
                            CommentModel.manga_id == created_manga_id,
                            CommentModel.parent_comment_id.is_not(None),
                        )
                    )
                    await clean_db.execute(
                        delete(CommentModel).where(CommentModel.manga_id == created_manga_id)
                    )
                    still_exists = await clean_db.scalar(
                        select(MangaModel.manga_id).where(MangaModel.manga_id == created_manga_id)
                    )
                    if still_exists is not None:
                        await clean_db.execute(
                            update(MangaModel)
                            .where(MangaModel.manga_id == created_manga_id)
                            .values(is_syncing=False)
                        )
                        await clean_db.execute(
                            delete(MangaModel).where(MangaModel.manga_id == created_manga_id)
                        )
                await clean_db.execute(
                    delete(MangaDeletionTombstoneModel).where(
                        MangaDeletionTombstoneModel.pool_manga_id == pool_manga_id
                    )
                )
                if created_list_ids:
                    await clean_db.execute(
                        delete(ListItemModel).where(ListItemModel.list_id.in_(created_list_ids))
                    )
                    await clean_db.execute(
                        delete(ReadingListModel).where(
                            ReadingListModel.list_id.in_(created_list_ids)
                        )
                    )
                if created_account_ids:
                    await clean_db.execute(
                        delete(CommentEditHistoryModel).where(
                            CommentEditHistoryModel.editor_reader_account_id.in_(
                                created_account_ids
                            )
                        )
                    )
                    await clean_db.execute(
                        delete(CommentReactionModel).where(
                            CommentReactionModel.reader_account_id.in_(created_account_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(CommentModel).where(
                            CommentModel.reader_account_id.in_(created_account_ids),
                            CommentModel.parent_comment_id.is_not(None),
                        )
                    )
                    await clean_db.execute(
                        delete(CommentModel).where(
                            CommentModel.reader_account_id.in_(created_account_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(AccountStatusHistoryModel).where(
                            AccountStatusHistoryModel.target_account_id.in_(created_account_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(MangaModerationLogModel).where(
                            MangaModerationLogModel.admin_account_id.in_(created_account_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(RatingModel).where(
                            RatingModel.reader_account_id.in_(created_account_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(ReadingStatusRecordModel).where(
                            ReadingStatusRecordModel.reader_account_id.in_(created_account_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(ReaderProgressModel).where(
                            ReaderProgressModel.reader_account_id.in_(created_account_ids)
                        )
                    )
                    await clean_db.execute(
                        delete(ReadingHistoryModel).where(
                            ReadingHistoryModel.reader_account_id.in_(created_account_ids)
                        )
                    )
                outbox_ids = [
                    *(str(aid) for aid in created_account_ids),
                    *([str(created_manga_id)] if created_manga_id else []),
                ]
                if outbox_ids:
                    await clean_db.execute(
                        delete(OutboxEventModel).where(
                            OutboxEventModel.aggregate_id.in_(outbox_ids)
                        )
                    )
                await clean_db.commit()

                # ActivityLog has INSTEAD OF UPDATE/DELETE trigger (`trg_activity_logs_immutable`)
                if created_account_ids:
                    await clean_db.execute(
                        text("DISABLE TRIGGER trg_activity_logs_immutable ON dbo.activity_logs")
                    )
                    try:
                        await clean_db.execute(
                            delete(ActivityLogModel).where(
                                ActivityLogModel.account_id.in_(created_account_ids)
                            )
                        )
                        if created_manga_id is not None:
                            await clean_db.execute(
                                delete(ActivityLogModel).where(
                                    ActivityLogModel.target_id == str(created_manga_id)
                                )
                            )
                        await clean_db.commit()
                    finally:
                        await clean_db.execute(
                            text("ENABLE TRIGGER trg_activity_logs_immutable ON dbo.activity_logs")
                        )
                        await clean_db.commit()

                if created_account_ids:
                    await clean_db.execute(
                        delete(AccountModel).where(AccountModel.account_id.in_(created_account_ids))
                    )
                await clean_db.execute(
                    delete(CreatorModel).where(CreatorModel.creator_id == creator_id)
                )
                await clean_db.execute(
                    delete(MediaObjectModel).where(
                        MediaObjectModel.object_key.like(f"%{pool_manga_id}%")
                    )
                )
                for aid in created_account_ids:
                    await clean_db.execute(
                        delete(MediaObjectModel).where(
                            MediaObjectModel.object_key.like(f"avatars/{aid}/%")
                        )
                    )
                await clean_db.commit()
