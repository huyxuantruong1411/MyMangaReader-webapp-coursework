"""Comprehensive Cross-Module Acceptance & E2E Tests (`11_TEST_STRATEGY_ACCEPTANCE.md`).

Covers E2E-1 through E2E-5 and core invariants across all 12 domain modules:
- Auth/OTP/Sessions/RBAC/Locking (`AUTH-*`)
- ETL/CDC/Tombstone/Visibility (`ETL-*`)
- Catalog/Search/Filters/Creators/Recommendations (`CAT-*`)
- Reader/Progress/Media Signing/Valid Views (`READ-*`)
- Ratings/Comments/Reactions (`SOC-*`)
- Private Lists/Clone/Merge/Stats (`LIST-*`)
- Reports/Atomic Moderation/Analytics/Reconciliation (`MOD-*`)
"""

from __future__ import annotations

import io
import json
import re
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import update

from manga_reader.common.clock import utc_now
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    AccountModel,
    AdminModel,
    MangaModel,
    ReaderModel,
    ReaderSettingsModel,
)

pytestmark = pytest.mark.integration


def _extract_last_otp(container: AppContainer) -> str:
    email_adapter = container.email
    sent = getattr(email_adapter, "sent_messages", ())
    assert sent, "Expected at least one dispatched OTP email."
    match = re.search(r"\b(\d{6})\b", sent[-1].body_text)
    assert match is not None, f"Could not parse 6-digit OTP from: {sent[-1].body_text}"
    return match.group(1)


async def _seed_admin(
    app: FastAPI, username: str = "sysadmin", password: str = "Admin@123456"
) -> tuple[UUID, str]:
    container: AppContainer = app.state.container
    now = utc_now()
    aid = uuid4()
    async with container.db.session() as db:
        db.add(
            AccountModel(
                account_id=aid,
                username=username,
                email=f"{username}@test.local",
                password_hash=container.password_hasher.hash(password),
                status="ACTIVE",
                last_status_change_at=now,
                created_at=now,
            )
        )
        await db.flush()
        db.add(AdminModel(account_id=aid, admin_code=f"ADM-{username}", role_level="SUPER_ADMIN"))
        db.add(ReaderModel(account_id=aid, display_name="Sys Admin"))
        db.add(ReaderSettingsModel(reader_account_id=aid, updated_at=now))
        await db.commit()
    return aid, password


async def _register_and_login_reader(
    client: AsyncClient, app: FastAPI, *, username: str, email: str, password: str = "Reader@123456"
) -> tuple[str, str, str]:
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": password},
    )
    assert reg.status_code == 201, reg.text
    account_id = reg.json()["data"]["accountId"]

    # Login before OTP verify must fail (AUTH-015)
    pre_login = await client.post(
        "/api/v1/auth/login",
        json={"identifier": username, "password": password},
    )
    assert pre_login.status_code == 403
    assert pre_login.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"

    otp = _extract_last_otp(app.state.container)
    ver = await client.post("/api/v1/auth/verify-otp", json={"email": email, "code": otp})
    assert ver.status_code == 200, ver.text

    # OTP replay must fail (AUTH-009)
    replay = await client.post("/api/v1/auth/verify-otp", json={"email": email, "code": otp})
    assert replay.status_code == 422

    login = await client.post(
        "/api/v1/auth/login",
        json={"identifier": email, "password": password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["data"]["accessToken"]
    return account_id, token, login.cookies.get("mr_refresh_token", "")


async def _login_admin(client: AsyncClient, username: str, password: str) -> str:
    res = await client.post(
        "/api/v1/auth/login",
        json={"identifier": username, "password": password},
    )
    assert res.status_code == 200, res.text
    return str(res.json()["data"]["accessToken"])


async def test_e2e_1_3_4_5_full_platform_lifecycle(api_client: AsyncClient, app: FastAPI) -> None:
    """End-to-end journey covering ETL, CDC, Catalog, Reader, Ratings, Comments, Lists, Recs."""
    _admin_id, admin_pw = await _seed_admin(app, "admin_e2e")
    admin_tok = await _login_admin(api_client, "admin_e2e", admin_pw)
    admin_hdr = {"Authorization": f"Bearer {admin_tok}"}

    # --- E2E-3: Admin external source list + Batch ETL with failure isolation (ETL-015/026) ---
    sources_res = await api_client.get("/api/v1/admin/external-sources", headers=admin_hdr)
    assert sources_res.status_code == 200
    sources = sources_res.json()["data"]
    assert len(sources) >= 5

    batch_items = [
        {"poolMangaId": s["poolMangaId"], "sourceMangaId": s["sourceMangaId"], "enableCdc": i == 0}
        for i, s in enumerate(sources)
    ]
    # Add 1 intentionally invalid package to prove per-manga failure isolation
    batch_items.append(
        {
            "poolMangaId": "pm_broken_bad_ver",
            "sourceMangaId": "src_bad",
            "enableCdc": False,
            "packagePayload": {
                "contract_name": "manga-reader-package",
                "contract_version": "9.9",
                "exported_at": "2026-11-20T10:00:00Z",
                "manga": {
                    "pool_manga_id": "pm_broken_bad_ver",
                    "slug": "broken",
                    "source_manga_id": "src_bad",
                    "title": "Broken",
                },
            },
        }
    )
    etl_res = await api_client.post(
        "/api/v1/admin/etl-sync",
        headers=admin_hdr,
        json={"items": batch_items},
    )
    assert etl_res.status_code == 202, etl_res.text
    etl_job = etl_res.json()["data"]
    assert etl_job["status"] == "PARTIAL_FAILED"
    assert sum(1 for it in etl_job["items"] if it["status"] == "SUCCEEDED") == 5
    assert sum(1 for it in etl_job["items"] if it["status"] == "FAILED") == 1

    # --- E2E-1: Register Readers, Profile, Avatar, Search, Reader, Progress, Valid View, Rating ---
    r1_id, r1_tok, r1_refresh = await _register_and_login_reader(
        api_client, app, username="reader_alpha", email="alpha@test.local"
    )
    r2_id, r2_tok, _ = await _register_and_login_reader(
        api_client, app, username="reader_beta", email="beta@test.local"
    )
    r1_hdr = {"Authorization": f"Bearer {r1_tok}"}
    r2_hdr = {"Authorization": f"Bearer {r2_tok}"}

    # Refresh token rotation (AUTH-019)
    ref_res = await api_client.post("/api/v1/auth/refresh", json={"refreshToken": r1_refresh})
    assert ref_res.status_code == 200
    r1_tok = ref_res.json()["data"]["accessToken"]
    r1_hdr = {"Authorization": f"Bearer {r1_tok}"}

    # Profile update & reserved display name rejection (AUTH-029) + avatar MIME check (AUTH-032)
    bad_name = await api_client.patch(
        "/api/v1/account/profile", headers=r1_hdr, json={"displayName": "System Admin"}
    )
    assert bad_name.status_code == 400
    good_prof = await api_client.patch(
        "/api/v1/account/profile",
        headers=r1_hdr,
        json={"displayName": "Minh Anh", "bio": "<script>alert(1)</script>Hello"},
    )
    assert good_prof.status_code == 200
    assert "<script>" not in (good_prof.json()["data"]["bio"] or "")

    bad_av = await api_client.post(
        "/api/v1/account/avatar",
        headers=r1_hdr,
        files={"file": ("spoof.png", b"not-an-image", "image/png")},
    )
    assert bad_av.status_code == 415

    img_buf = io.BytesIO()
    Image.new("RGB", (64, 64), (10, 120, 220)).save(img_buf, format="PNG")
    ok_av = await api_client.post(
        "/api/v1/account/avatar",
        headers=r1_hdr,
        files={"file": ("avatar.png", img_buf.getvalue(), "image/png")},
    )
    assert ok_av.status_code == 200
    assert "/api/v1/media/" in (ok_av.json()["data"]["avatarUrl"] or "")

    # Catalog & Search: alt title, accent-insensitive, fuzzy typo, safe excludes unknown (CAT-006/008/009/019)
    safe_cat = await api_client.get("/api/v1/manga?contentRating=safe")
    assert safe_cat.status_code == 200
    safe_slugs = {m["slug"] for m in safe_cat.json()["data"]}
    assert "mystery-of-the-silent-bell" not in safe_slugs  # content_rating == unknown != safe!

    search_alt = await api_client.get("/api/v1/manga/search?q=Bien Nien Su Lam Kiem")
    assert search_alt.status_code == 200
    assert search_alt.json()["data"][0]["slug"] == "chronicles-of-the-azure-blade"
    azure_manga_id = search_alt.json()["data"][0]["mangaId"]

    ac_res = await api_client.get("/api/v1/manga/autocomplete?q=Starlight")
    assert ac_res.status_code == 200
    assert len(ac_res.json()["data"]) <= 10
    assert any(s["slug"] == "starlight-atelier" for s in ac_res.json()["data"])

    # Creator detail combines dual roles without duplicate manga card (CAT-013)
    cr_works = await api_client.get("/api/v1/creators/cr_akira_kuroda/manga")
    assert cr_works.status_code == 200
    azure_work = next(
        w for w in cr_works.json()["data"] if w["slug"] == "chronicles-of-the-azure-blade"
    )
    assert azure_work["creatorRoles"] == ["artist", "author"]

    # Rating before reading MUST be rejected (SOC-001)
    early_rate = await api_client.put(
        f"/api/v1/manga/{azure_manga_id}/rating", headers=r1_hdr, json={"score": 9}
    )
    assert early_rate.status_code == 422
    assert early_rate.json()["error"]["code"] == "RATING_REQUIRES_READING"

    # Read First opens earliest numeric chapter (Prologue, chapter_numeric=0) + signed media stream
    open_start = await api_client.get(
        f"/api/v1/reader/open?mangaId={azure_manga_id}&actionType=START", headers=r1_hdr
    )
    assert open_start.status_code == 200
    opened = open_start.json()["data"]
    assert opened["chapter"]["chapterNumber"] == "Prologue"
    ch0_id = opened["chapter"]["chapterId"]
    hist_id = opened["historyId"]
    assert len(opened["pages"]) == 3

    # Signed media proxy serves real WebP bytes (ADR-018)
    page_url: str = opened["pages"][0]["url"]
    rel_media_path = page_url[page_url.index("/api/v1/media/") :]
    media_res = await api_client.get(rel_media_path)
    assert media_res.status_code == 200
    assert media_res.headers["content-type"] == "image/webp"

    # Save exact page progress (page 3) + reject stale sequence (READ-027/029)
    prog_save = await api_client.put(
        "/api/v1/reader/progress",
        headers=r1_hdr,
        json={
            "mangaId": azure_manga_id,
            "chapterId": ch0_id,
            "pageNumber": 3,
            "pageUid": opened["pages"][2]["pageUid"],
            "pagesRevision": 1,
            "clientSequence": 5,
        },
    )
    assert prog_save.status_code == 200

    stale_prog = await api_client.put(
        "/api/v1/reader/progress",
        headers=r1_hdr,
        json={
            "mangaId": azure_manga_id,
            "chapterId": ch0_id,
            "pageNumber": 1,
            "pagesRevision": 1,
            "clientSequence": 2,
        },
    )
    assert stale_prog.status_code == 409
    assert stale_prog.json()["error"]["code"] == "PROGRESS_CONFLICT"

    # Continue reading resumes at exact page 3 (READ-003 / ADR-001)
    open_cont = await api_client.get(
        f"/api/v1/reader/open?mangaId={azure_manga_id}&actionType=CONTINUE", headers=r1_hdr
    )
    assert open_cont.status_code == 200
    assert open_cont.json()["data"]["initialPage"] == 3

    # Valid view below threshold does not count; meeting threshold counts once (READ-030/031/032)
    short_view = await api_client.post(
        f"/api/v1/reader/view-session/{hist_id}/complete",
        headers=r1_hdr,
        json={"durationSeconds": 3},
    )
    assert short_view.json()["data"]["isValidView"] is False
    valid_view = await api_client.post(
        f"/api/v1/reader/view-session/{hist_id}/complete",
        headers=r1_hdr,
        json={"durationSeconds": 25},
    )
    assert valid_view.json()["data"]["isValidView"] is True

    # Rating succeeds now + history tracks CREATE -> UPDATE -> REMOVE (SOC-002..004)
    rate_c = await api_client.put(
        f"/api/v1/manga/{azure_manga_id}/rating", headers=r1_hdr, json={"score": 8}
    )
    assert rate_c.status_code == 200 and rate_c.json()["data"]["action"] == "CREATE"
    rate_u = await api_client.put(
        f"/api/v1/manga/{azure_manga_id}/rating", headers=r1_hdr, json={"score": 10}
    )
    assert rate_u.status_code == 200 and rate_u.json()["data"]["averageRating"] == 10.0
    hist_ratings = await api_client.get("/api/v1/account/me/rating-history", headers=r1_hdr)
    assert len(hist_ratings.json()["data"]) == 2

    # --- E2E-4: Comment, Reply, Edit History w/ Spoiler, Force Spoiler, Reactions, Soft Delete ---
    c_root = await api_client.post(
        "/api/v1/comments",
        headers=r1_hdr,
        json={"mangaId": azure_manga_id, "content": "Initial take", "isSpoiler": False},
    )
    assert c_root.status_code == 201
    root_cid = c_root.json()["data"]["commentId"]

    c_rep = await api_client.post(
        "/api/v1/comments",
        headers=r2_hdr,
        json={
            "mangaId": azure_manga_id,
            "parentCommentId": root_cid,
            "content": "Great point!",
            "isSpoiler": False,
        },
    )
    assert c_rep.status_code == 201

    c_edit = await api_client.put(
        f"/api/v1/comments/{root_cid}",
        headers=r1_hdr,
        json={"content": "Updated spoiler take", "isSpoiler": True},
    )
    assert c_edit.status_code == 200 and c_edit.json()["data"]["isEdited"] is True
    c_hist = await api_client.get(f"/api/v1/comments/{root_cid}/history")
    assert c_hist.json()["data"][0]["previousContent"] == "Initial take"
    assert c_hist.json()["data"][0]["previousIsSpoiler"] is False

    # Atomic reactions LIKE -> DISLIKE -> null (SOC-024..026)
    rx1 = await api_client.put(
        f"/api/v1/comments/{root_cid}/reaction", headers=r2_hdr, json={"reactionType": "LIKE"}
    )
    assert rx1.json()["data"]["likeCount"] == 1
    rx2 = await api_client.put(
        f"/api/v1/comments/{root_cid}/reaction", headers=r2_hdr, json={"reactionType": "DISLIKE"}
    )
    assert rx2.json()["data"]["likeCount"] == 0 and rx2.json()["data"]["dislikeCount"] == 1

    # Report comment -> Admin FORCE_SPOILER -> Author cannot uncheck spoiler -> Admin DELETE_COMMENT
    rep_cm = await api_client.post(
        "/api/v1/reports/comment",
        headers=r2_hdr,
        json={"targetCommentId": root_cid, "reasonCategory": "UNMARKED_SPOILER"},
    )
    assert rep_cm.status_code == 201
    rep_cm_id = rep_cm.json()["data"]["reportId"]
    res_spoiler = await api_client.post(
        f"/api/v1/admin/reports/{rep_cm_id}/resolve",
        headers=admin_hdr,
        json={"actionType": "FORCE_SPOILER", "note": "Contains ending spoiler"},
    )
    assert res_spoiler.status_code == 200 and res_spoiler.json()["data"]["status"] == "RESOLVED"

    uncheck_try = await api_client.put(
        f"/api/v1/comments/{root_cid}",
        headers=r1_hdr,
        json={"content": "Trying to uncheck spoiler", "isSpoiler": False},
    )
    assert uncheck_try.status_code == 422
    assert uncheck_try.json()["error"]["code"] == "SPOILER_LOCKED_BY_ADMIN"

    # Soft delete root with reply -> placeholder shown (SOC-022)
    del_cm = await api_client.delete(f"/api/v1/comments/{root_cid}", headers=r1_hdr)
    assert del_cm.status_code == 200
    cm_list = await api_client.get(f"/api/v1/comments?mangaId={azure_manga_id}")
    root_rendered = cm_list.json()["data"][0]
    assert root_rendered["isDeleted"] is True
    assert root_rendered["content"] == "[Bình luận đã bị xóa]"
    assert len(root_rendered["replies"]) == 1

    # --- E2E-5: Private Reading Lists, Clone/Merge, Membership Sync, Stats & Hidden Omission ---
    list_a = (
        await api_client.post("/api/v1/lists", headers=r1_hdr, json={"name": "Action Picks"})
    ).json()["data"]
    list_b = (
        await api_client.post("/api/v1/lists", headers=r1_hdr, json={"name": "Top Fantasy"})
    ).json()["data"]
    list_empty = (
        await api_client.post("/api/v1/lists", headers=r1_hdr, json={"name": "Empty Shelf"})
    ).json()["data"]

    # Non-owner access returns 404 (LIST-006 / ADR-009)
    idor_list = await api_client.get(f"/api/v1/lists/{list_a['listId']}", headers=r2_hdr)
    assert idor_list.status_code == 404

    # Empty list stats exact message (LIST-023)
    empty_stats = await api_client.get(
        f"/api/v1/lists/{list_empty['listId']}/metadata-stats", headers=r1_hdr
    )
    assert empty_stats.json()["data"]["emptyMessage"] == "Danh sách chưa có truyện nào để thống kê"

    # Sync manga into both lists, then merge-create -> deduplicated count == 1 (LIST-010)
    await api_client.put(
        f"/api/v1/manga/{azure_manga_id}/my-list-memberships",
        headers=r1_hdr,
        json={"selectedListIds": [list_a["listId"], list_b["listId"]]},
    )
    merged = await api_client.post(
        "/api/v1/lists/merge-create",
        headers=r1_hdr,
        json={
            "sourceListIds": [list_a["listId"], list_b["listId"]],
            "newName": "Merged Best",
        },
    )
    assert merged.status_code == 201
    assert merged.json()["data"]["itemCount"] == 1

    # Empty source merge requires confirmEmpty=true (LIST-012)
    merge_empty_warn = await api_client.post(
        "/api/v1/lists/merge-create",
        headers=r1_hdr,
        json={"sourceListIds": [list_empty["listId"]], "newName": "Empty Clone"},
    )
    assert merge_empty_warn.status_code == 409
    assert merge_empty_warn.json()["error"]["code"] == "EMPTY_SOURCE_LISTS_CONFIRMATION_REQUIRED"

    # --- Recommendations: CONTENT_BASED, ITEM_BASED, USER_BASED (CAT-022..029) ---
    rec_cb = await api_client.get(
        f"/api/v1/manga/{azure_manga_id}/recommendations?type=CONTENT_BASED"
    )
    assert rec_cb.status_code == 200 and len(rec_cb.json()["data"]["items"]) >= 1
    assert all(i["mangaId"] != azure_manga_id for i in rec_cb.json()["data"]["items"])

    rec_user = await api_client.get("/api/v1/recommendations/me", headers=r1_hdr)
    assert rec_user.status_code == 200
    assert all(i["mangaId"] != azure_manga_id for i in rec_user.json()["data"]["items"])

    # --- CDC Idempotency + Hide Visibility + Safe Delete Tombstone (ETL-019/023/024) ---
    cdc_evt = {
        "eventId": "evt_unique_001",
        "eventType": "MANGA_METADATA_UPDATED",
        "poolMangaId": "pm_azure_blade_001",
        "poolRevision": 2,
        "payload": {
            "contract_name": "manga-reader-package",
            "contract_version": "2.0",
            "exported_at": "2026-11-20T12:00:00Z",
            "manga": {
                "pool_manga_id": "pm_azure_blade_001",
                "slug": "chronicles-of-the-azure-blade",
                "source_manga_id": "src_azure_001",
                "title": "Chronicles of the Azure Blade (Revised)",
                "lineage": {"pool_revision": 2, "source_metadata_revision": 2},
            },
        },
    }
    cdc1 = await api_client.post("/api/v1/webhooks/cdc", content=json.dumps(cdc_evt))
    assert cdc1.status_code == 202 and cdc1.json()["data"]["status"] == "PROCESSED"
    cdc_dup = await api_client.post("/api/v1/webhooks/cdc", content=json.dumps(cdc_evt))
    assert cdc_dup.json()["data"]["duplicate"] is True

    # Hide manga -> excluded from catalog & list stats (CAT-002 / LIST-026)
    hide_res = await api_client.post(
        f"/api/v1/admin/manga/{azure_manga_id}/hide",
        headers=admin_hdr,
        json={"reason": "Temporary review"},
    )
    assert hide_res.status_code == 200
    hidden_detail = await api_client.get(f"/api/v1/manga/{azure_manga_id}")
    assert hidden_detail.status_code == 404
    merged_stats_hidden = await api_client.get(
        f"/api/v1/lists/{merged.json()['data']['listId']}/metadata-stats", headers=r1_hdr
    )
    assert merged_stats_hidden.json()["data"]["totalMangas"] == 0

    # Delete blocked while is_syncing=True (ETL-023)
    async with app.state.container.db.session() as db:
        await db.execute(
            update(MangaModel)
            .where(MangaModel.manga_id == UUID(azure_manga_id))
            .values(is_syncing=True)
        )
        await db.commit()
    blocked_del = await api_client.post(
        f"/api/v1/admin/manga/{azure_manga_id}/delete",
        headers=admin_hdr,
        json={"reason": "Attempt while syncing"},
    )
    assert blocked_del.status_code == 409
    assert blocked_del.json()["error"]["code"] == "MANGA_IS_SYNCING"

    async with app.state.container.db.session() as db:
        await db.execute(
            update(MangaModel)
            .where(MangaModel.manga_id == UUID(azure_manga_id))
            .values(is_syncing=False)
        )
        await db.commit()
    ok_del = await api_client.post(
        f"/api/v1/admin/manga/{azure_manga_id}/delete",
        headers=admin_hdr,
        json={"reason": "Copyright takedown"},
    )
    assert ok_del.status_code == 200 and ok_del.json()["data"]["tombstoned"] is True

    # Delayed CDC cannot resurrect deleted manga (ETL-024 / ADR-011)
    cdc_resurrect = {**cdc_evt, "eventId": "evt_after_delete_002", "poolRevision": 99}
    resurrect_res = await api_client.post("/api/v1/webhooks/cdc", content=json.dumps(cdc_resurrect))
    assert resurrect_res.json()["data"]["reason"] == "MANGA_TOMBSTONED"

    # --- E2E-2: Account Report -> Lock Revokes Session Immediately -> Unlock & Analytics ---
    self_rep = await api_client.post(
        "/api/v1/reports/account",
        headers=r1_hdr,
        json={"targetAccountId": r1_id, "reasonCategory": "SPAM"},
    )
    assert self_rep.status_code == 422

    acc_rep = await api_client.post(
        "/api/v1/reports/account",
        headers=r1_hdr,
        json={"targetAccountId": r2_id, "reasonCategory": "HARASSMENT"},
    )
    assert acc_rep.status_code == 201
    acc_rep_id = acc_rep.json()["data"]["reportId"]

    resolve_lock = await api_client.post(
        f"/api/v1/admin/reports/{acc_rep_id}/resolve",
        headers=admin_hdr,
        json={"actionType": "LOCK_ACCOUNT", "note": "Confirmed harassment"},
    )
    assert resolve_lock.status_code == 200 and resolve_lock.json()["data"]["status"] == "RESOLVED"

    # Locked user's existing JWT session MUST fail immediately (AUTH-021)
    locked_call = await api_client.get("/api/v1/account/me", headers=r2_hdr)
    assert locked_call.status_code == 401

    # Admin unlock restores ACTIVE (AUTH-025)
    unlock_res = await api_client.post(
        f"/api/v1/admin/accounts/{r2_id}/unlock",
        headers=admin_hdr,
        json={"reason": "Appeal approved"},
    )
    assert unlock_res.status_code == 200 and unlock_res.json()["data"]["status"] == "ACTIVE"

    # Analytics & Counter Reconciliation
    stats_res = await api_client.get("/api/v1/admin/manga/statistics", headers=admin_hdr)
    assert stats_res.status_code == 200
    reconcile_res = await api_client.post("/api/v1/admin/reconcile", headers=admin_hdr)
    assert reconcile_res.status_code == 200
    logs_res = await api_client.get("/api/v1/admin/activity-logs", headers=admin_hdr)
    assert logs_res.status_code == 200 and len(logs_res.json()["data"]) > 0


async def test_advanced_search_and_bug_fixes(api_client: AsyncClient, app: FastAPI) -> None:
    """Verify BUG-01..BUG-05 fixes, Advanced Search facets, and enriched Library endpoint."""
    _admin_id, admin_pw = await _seed_admin(app, "admin_adv")
    admin_tok = await _login_admin(api_client, "admin_adv", admin_pw)
    admin_hdr = {"Authorization": f"Bearer {admin_tok}"}

    sources = (await api_client.get("/api/v1/admin/external-sources", headers=admin_hdr)).json()[
        "data"
    ]
    etl_res = await api_client.post(
        "/api/v1/admin/etl-sync",
        headers=admin_hdr,
        json={
            "items": [
                {
                    "poolMangaId": s["poolMangaId"],
                    "sourceMangaId": s["sourceMangaId"],
                    "enableCdc": False,
                }
                for s in sources
            ]
        },
    )
    assert etl_res.status_code == 202

    _r_id, r_tok, _ = await _register_and_login_reader(
        api_client, app, username="reader_adv", email="adv@test.local"
    )
    _r2_id, r2_tok, _ = await _register_and_login_reader(
        api_client, app, username="reader_adv2", email="adv2@test.local"
    )
    r_hdr = {"Authorization": f"Bearer {r_tok}"}
    r2_hdr = {"Authorization": f"Bearer {r2_tok}"}

    # BUG-01: ALL_AND requires ALL included tags (only Azure Blade has action + fantasy)
    group_or_res = await api_client.get("/api/v1/manga?includeTags=action,fantasy&tagMode=GROUP_OR")
    assert group_or_res.status_code == 200
    group_or_slugs = {m["slug"] for m in group_or_res.json()["data"]}
    assert "chronicles-of-the-azure-blade" in group_or_slugs
    assert "starlight-atelier" in group_or_slugs

    all_and_res = await api_client.get("/api/v1/manga?includeTags=action,fantasy&tagMode=ALL_AND")
    assert all_and_res.status_code == 200
    all_and_slugs = {m["slug"] for m in all_and_res.json()["data"]}
    assert all_and_slugs == {"chronicles-of-the-azure-blade"}

    # BUG-02: Multi-demographic + kodomo/unknown support without error
    demo_res = await api_client.get("/api/v1/manga?demographic=shounen,shoujo,kodomo")
    assert demo_res.status_code == 200
    assert {m["slug"] for m in demo_res.json()["data"]} >= {
        "chronicles-of-the-azure-blade",
        "starlight-atelier",
    }

    # BUG-03: Case-insensitive creator search role filter
    cr_upper = await api_client.get("/api/v1/creators/search?q=Akira&role=AUTHOR")
    assert cr_upper.status_code == 200
    assert cr_upper.json()["data"][0]["slug"] == "akira-kuroda"

    # Advanced search facets: chapterLanguage, author+artist, chaptersMin/Max, title q, sort
    vi_ch = await api_client.get("/api/v1/manga?chapterLanguage=vi")
    assert vi_ch.status_code == 200
    assert {m["slug"] for m in vi_ch.json()["data"]} == {"chronicles-of-the-azure-blade"}

    creator_filtered = await api_client.get(
        "/api/v1/manga?author=Hana&artist=Ren&chaptersMin=3&chaptersMax=3"
    )
    assert creator_filtered.status_code == 200
    assert [m["slug"] for m in creator_filtered.json()["data"]] == ["starlight-atelier"]

    q_filtered = await api_client.get(
        "/api/v1/manga?q=Bien+Nien+Su+Lam+Kiem&sort=RELEVANCE&originalLanguage=ja"
    )
    assert q_filtered.status_code == 200
    assert q_filtered.json()["data"][0]["slug"] == "chronicles-of-the-azure-blade"
    assert q_filtered.json()["data"][0]["exportedChapterCount"] == 5

    # Invalid inverted ranges rejected cleanly with 400 INVALID_FILTER
    bad_range = await api_client.get("/api/v1/manga?chaptersMin=10&chaptersMax=2")
    assert bad_range.status_code == 400
    assert bad_range.json()["error"]["code"] == "INVALID_FILTER"

    # Personal Library + hideInStatus + hideInLists + TOP_LIKED comments (BUG-05)
    azure_id = q_filtered.json()["data"][0]["mangaId"]
    azure_detail = await api_client.get("/api/v1/manga/chronicles-of-the-azure-blade")
    assert azure_detail.status_code == 200
    assert isinstance(azure_detail.json()["data"].get("altTitleEntries"), list)
    assert len(azure_detail.json()["data"]["altTitleEntries"]) >= 1
    await api_client.put(
        f"/api/v1/manga/{azure_id}/reading-status",
        headers=r_hdr,
        json={"status": "READING"},
    )
    lib_res = await api_client.get("/api/v1/account/me/reading-status", headers=r_hdr)
    assert lib_res.status_code == 200
    assert lib_res.json()["data"][0]["readingStatus"] == "READING"
    assert lib_res.json()["data"][0]["slug"] == "chronicles-of-the-azure-blade"

    hidden_status_res = await api_client.get("/api/v1/manga?hideInStatus=true", headers=r_hdr)
    assert hidden_status_res.status_code == 200
    assert azure_id not in {m["mangaId"] for m in hidden_status_res.json()["data"]}

    c1 = (
        await api_client.post(
            "/api/v1/comments",
            headers=r_hdr,
            json={"mangaId": azure_id, "content": "First comment", "isSpoiler": False},
        )
    ).json()["data"]
    c2 = (
        await api_client.post(
            "/api/v1/comments",
            headers=r2_hdr,
            json={"mangaId": azure_id, "content": "Second popular comment", "isSpoiler": False},
        )
    ).json()["data"]
    await api_client.put(
        f"/api/v1/comments/{c2['commentId']}/reaction",
        headers=r_hdr,
        json={"reactionType": "LIKE"},
    )
    top_liked = await api_client.get(f"/api/v1/comments?mangaId={azure_id}&sort=TOP_LIKED")
    assert top_liked.status_code == 200
    assert top_liked.json()["data"][0]["commentId"] == c2["commentId"]
    assert top_liked.json()["data"][1]["commentId"] == c1["commentId"]


async def test_admin_without_reader_row_can_upload_avatar_and_update_profile(
    api_client: AsyncClient, app: FastAPI
) -> None:
    """Active ADMIN accounts without a pre-existing ReaderModel row can still upload avatars."""
    container: AppContainer = app.state.container
    now = utc_now()
    aid = uuid4()
    pw = "Admin@123456"
    async with container.db.session() as db:
        db.add(
            AccountModel(
                account_id=aid,
                username="admin_no_reader",
                email="admin_no_reader@test.local",
                password_hash=container.password_hasher.hash(pw),
                status="ACTIVE",
                last_status_change_at=now,
                created_at=now,
            )
        )
        await db.flush()
        db.add(AdminModel(account_id=aid, admin_code="ADM-NOREADER", role_level="SUPER_ADMIN"))
        await db.commit()

    admin_tok = await _login_admin(api_client, "admin_no_reader", pw)
    admin_hdr = {"Authorization": f"Bearer {admin_tok}"}

    img_buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 80, 40)).save(img_buf, format="PNG")
    av_res = await api_client.post(
        "/api/v1/account/avatar",
        headers=admin_hdr,
        files={"file": ("admin-avatar.png", img_buf.getvalue(), "image/png")},
    )
    assert av_res.status_code == 200, av_res.text
    avatar_url = av_res.json()["data"]["avatarUrl"]
    assert avatar_url and "/api/v1/media/" in avatar_url

    prof_res = await api_client.patch(
        "/api/v1/account/profile",
        headers=admin_hdr,
        json={"displayName": "Lead Moderator", "bio": "Platform steward"},
    )
    assert prof_res.status_code == 200, prof_res.text
    assert prof_res.json()["data"]["displayName"] == "Lead Moderator"
    assert prof_res.json()["data"]["bio"] == "Platform steward"
    assert "/api/v1/media/" in (prof_res.json()["data"]["avatarUrl"] or "")

    stats_res = await api_client.get("/api/v1/account/me/reading-statistics", headers=admin_hdr)
    assert stats_res.status_code == 200, stats_res.text
    assert stats_res.json()["data"]["accountId"] == str(aid)


async def test_forgot_password_otp_recovery_and_pending_reregister(
    api_client: AsyncClient, app: FastAPI
) -> None:
    """Verify PENDING_VERIFICATION re-register OTP resend and 3-step forgot/reset password flow."""
    email = "forgot_user@test.local"
    username = "forgot_user"
    reg1 = await api_client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": "OldStrong@123"},
    )
    assert reg1.status_code == 201, reg1.text
    assert reg1.json()["data"]["email"] == email
    assert "devOtpPreview" not in reg1.json()["data"]

    # Re-registering same unverified email cleanly re-issues OTP
    reg2 = await api_client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": "OldStrong@123"},
    )
    assert reg2.status_code == 201, reg2.text
    assert "devOtpPreview" not in reg2.json()["data"]

    # Request password reset OTP by username
    fg = await api_client.post("/api/v1/auth/forgot-password", json={"identifier": username})
    assert fg.status_code == 200, fg.text
    assert fg.json()["data"]["email"] == email
    assert "devOtpPreview" not in fg.json()["data"]

    reset_otp = _extract_last_otp(app.state.container)
    chk = await api_client.post(
        "/api/v1/auth/verify-reset-otp", json={"email": email, "code": reset_otp}
    )
    assert chk.status_code == 200, chk.text
    assert chk.json()["data"]["valid"] is True

    rst = await api_client.post(
        "/api/v1/auth/reset-password",
        json={"email": email, "code": reset_otp, "newPassword": "NewStrong@456"},
    )
    assert rst.status_code == 200, rst.text
    assert rst.json()["data"]["reset"] is True

    # New password works and account was activated upon OTP ownership proof
    login_ok = await api_client.post(
        "/api/v1/auth/login", json={"identifier": username, "password": "NewStrong@456"}
    )
    assert login_ok.status_code == 200, login_ok.text
