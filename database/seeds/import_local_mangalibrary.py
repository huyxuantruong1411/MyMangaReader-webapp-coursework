"""Import real local manga catalog from SQL Server `MangaLibrary` + MinIO covers into app DB.

Read-only against `MangaLibrary` and MinIO (`manga-media`). Never modifies coursework DB or buckets.
Downloads real cover images into `storage/local-dev/manga-reader-media/` so the app runs cleanly
even when Docker/MinIO is stopped, and prepares chapters for hybrid live MangaDex At-Home API
page delivery with automatic illustrated WebP demo page fallback.

Demo Accounts Created:
- Admin:   `admin`   / `Admin@123456`
- Reader1: `reader1` / `Reader@123456`
- Reader2: `reader2` / `Reader@123456`
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import sys
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import httpx
import pyodbc
from sqlalchemy import func, select

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from manga_reader.common.clock import utc_now  # noqa: E402
from manga_reader.common.identities import AccountId, MediaObjectRef  # noqa: E402
from manga_reader.common.security import AccountRole, AccountStatus, SecurityPrincipal  # noqa: E402
from manga_reader.common.text import sanitize_user_text  # noqa: E402
from manga_reader.config.settings import Settings  # noqa: E402
from manga_reader.infrastructure.container import AppContainer  # noqa: E402
from manga_reader.infrastructure.orm import (  # noqa: E402
    AccountModel,
    AdminModel,
    ChapterModel,
    ChapterPageModel,
    CommentModel,
    CreatorBiographyModel,
    CreatorModel,
    MangaAltTitleModel,
    MangaContentVectorModel,
    MangaCoverArtModel,
    MangaCreatorModel,
    MangaLineageModel,
    MangaLinkModel,
    MangaModel,
    MangaStatsLanguageModel,
    MangaStatsModel,
    MangaTagModel,
    MediaObjectModel,
    RatingModel,
    ReaderModel,
    ReaderProgressModel,
    ReaderSettingsModel,
    ReadingHistoryModel,
    ReadingStatusRecordModel,
    TagModel,
    TagNameModel,
)
from manga_reader.modules.etl_cdc.application.service import (  # noqa: E402
    compute_content_feature_vector,
)
from manga_reader.modules.etl_cdc.infrastructure.sample_upstream import (  # noqa: E402
    render_placeholder_webp,
)
from manga_reader.modules.moderation_reporting.application.service import (  # noqa: E402
    ModerationReportingService,
)
from manga_reader.modules.reading_lists.application.service import (  # noqa: E402
    ReadingListService,
)

SOURCE_MSSQL_CONN = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"
    "DATABASE=MangaLibrary;"
    "Trusted_Connection=yes;"
    "TrustServerCertificate=yes;"
)
MINIO_ENDPOINT = "http://127.0.0.1:9010"
MINIO_SOURCE_BUCKET = "manga-media"
MINIO_ACCESS_KEY = "mangaadmin"
MINIO_SECRET_KEY = "MangaMinio2026!"  # noqa: S105

TARGET_MANGA_LIMIT = 80
MAX_CHAPTERS_PER_MANGA = 20
DEFAULT_DEMO_PAGES_PER_CHAPTER = 6

VI_TAG_NAMES: dict[str, str] = {
    "action": "Hành động",
    "adventure": "Phiêu lưu",
    "comedy": "Hài hước",
    "drama": "Chính kịch",
    "fantasy": "Giả tưởng",
    "horror": "Kinh dị",
    "isekai": "Dị giới (Isekai)",
    "mystery": "Bí ẩn",
    "psychological": "Tâm lý",
    "romance": "Lãng mạn",
    "school-life": "Học đường",
    "sci-fi": "Khoa học viễn tưởng",
    "slice-of-life": "Đời thường",
    "sports": "Thể thao",
    "supernatural": "Siêu nhiên",
    "thriller": "Giật gân",
    "tragedy": "Bi kịch",
    "historical": "Lịch sử",
    "martial-arts": "Võ thuật",
    "magic": "Phép thuật",
    "monsters": "Quái vật",
    "demons": "Ác quỷ",
    "reincarnation": "Chuyển sinh",
    "long-strip": "Webtoon cuộn dọc",
}


def _slugify(value: str, fallback: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (clean[:180] or fallback).strip("-")


def _parse_chapter_numeric(raw: str | None) -> Decimal:
    if not raw:
        return Decimal("0")
    match = re.search(r"\d+(?:\.\d+)?", raw.strip())
    if not match:
        return Decimal("0")
    try:
        return Decimal(match.group(0)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0")


def _sign_s3_get_headers(
    *,
    endpoint: str,
    bucket: str,
    object_key: str,
    access_key: str,
    secret_key: str,
    region: str = "us-east-1",
) -> tuple[str, dict[str, str]]:
    """Build AWS Signature Version 4 headers for a MinIO/S3 GET request (stdlib only)."""
    parsed = urlparse(endpoint)
    host = parsed.netloc
    now = datetime.now(UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    encoded_key = quote(object_key.lstrip("/"), safe="/-_.~")
    canonical_uri = f"/{bucket}/{encoded_key}"
    payload_hash = "UNSIGNED-PAYLOAD"

    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = (
        f"GET\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    )

    scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )

    def _hmac_sha256(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    k_date = _hmac_sha256(f"AWS4{secret_key}".encode(), date_stamp)
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, "s3")
    k_signing = _hmac_sha256(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    headers = {
        "Host": host,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        ),
    }
    return f"{endpoint.rstrip('/')}{canonical_uri}", headers


async def _fetch_cover_from_minio(
    client: httpx.AsyncClient,
    object_key: str,
) -> tuple[bytes, str] | None:
    try:
        url, headers = _sign_s3_get_headers(
            endpoint=MINIO_ENDPOINT,
            bucket=MINIO_SOURCE_BUCKET,
            object_key=object_key,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
        )
        resp = await client.get(url, headers=headers)
        if resp.status_code == 200 and resp.content:
            ct = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip().lower()
            if ct.startswith("image/"):
                return resp.content, ct
    except Exception:
        return None
    return None


def _read_source_mangalibrary(limit: int = TARGET_MANGA_LIMIT) -> dict[str, Any]:
    """Read a clean, referentially-consistent slice of real manga from local SQL Server."""
    with pyodbc.connect(SOURCE_MSSQL_CONN, timeout=10) as conn:
        cur = conn.cursor()

        tags = [
            {"tag_id": str(r[0]).lower(), "group": (r[1] or "genre").lower(), "name": r[2] or "Tag"}
            for r in cur.execute("SELECT TagId, GroupName, NameEn FROM Tag").fetchall()
        ]

        manga_rows = cur.execute(
            """
            SELECT TOP (?)
                m.MangaId, m.TitleEn, m.Status, m.ContentRating, m.PublicationDemographic,
                m.OriginalLanguage, m.Year, m.LastVolume, m.LastChapter, m.CreatedAt, m.UpdatedAt,
                cv.cover_id, cv.url, cv.fileName, cv.volume, cv.locale,
                ISNULL(ms.Follows, 0) AS follows,
                ISNULL(ms.AverageRating, 0) AS avg_rating
            FROM Manga m
            CROSS APPLY (
                SELECT TOP 1 c.cover_id, c.url, c.fileName, c.volume, c.locale
                FROM Covers c
                WHERE c.manga_id = m.MangaId AND c.url LIKE 'covers/%'
                ORDER BY c.updatedAt DESC
            ) cv
            LEFT JOIN MangaStatistics ms ON ms.MangaId = m.MangaId
            WHERE m.TitleEn IS NOT NULL AND LTRIM(RTRIM(m.TitleEn)) <> ''
              AND EXISTS (
                  SELECT 1 FROM Chapter ch
                  WHERE ch.MangaId = m.MangaId
                    AND ISNULL(ch.IsUnavailable, 0) = 0
                    AND ISNULL(ch.Pages, 0) > 0
                    AND ch.TranslatedLang IN ('en', 'vi')
              )
            ORDER BY ISNULL(ms.Follows, 0) DESC
            """,
            limit,
        ).fetchall()

        manga_ids = [str(r[0]) for r in manga_rows]
        if not manga_ids:
            return {"tags": tags, "creators": {}, "mangas": []}

        placeholders = ",".join("?" for _ in manga_ids)

        desc_map: dict[str, dict[str, str]] = defaultdict(dict)
        for mid, lang, desc in cur.execute(
            f"SELECT MangaId, LangCode, Description FROM MangaDescription WHERE MangaId IN ({placeholders})",  # noqa: S608
            manga_ids,
        ).fetchall():
            if desc and str(desc).strip():
                desc_map[str(mid).lower()][(lang or "en").lower()] = str(desc).strip()

        alt_map: dict[str, list[str]] = defaultdict(list)
        for mid, alt in cur.execute(
            f"SELECT MangaId, AltTitle FROM MangaAltTitle WHERE MangaId IN ({placeholders})",  # noqa: S608
            manga_ids,
        ).fetchall():
            if alt and str(alt).strip():
                clean_alt = str(alt).strip()
                if clean_alt not in alt_map[str(mid).lower()]:
                    alt_map[str(mid).lower()].append(clean_alt)

        link_map: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for mid, provider, url in cur.execute(
            f"SELECT MangaId, Provider, Url FROM MangaLink WHERE MangaId IN ({placeholders})",  # noqa: S608
            manga_ids,
        ).fetchall():
            if provider and url and str(url).strip():
                u = str(url).strip()
                if u.startswith(("http://", "https://")):
                    link_map[str(mid).lower()].append((str(provider).strip(), u))

        mtag_map: dict[str, list[str]] = defaultdict(list)
        for mid, tid in cur.execute(
            f"SELECT MangaId, TagId FROM MangaTag WHERE MangaId IN ({placeholders})",  # noqa: S608
            manga_ids,
        ).fetchall():
            mtag_map[str(mid).lower()].append(str(tid).lower())

        creators_by_id: dict[str, dict[str, Any]] = {}
        mcreator_map: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for cid, ctype, cname, bio_en, bio_ja, mid in cur.execute(
            f"""
            SELECT c.CreatorId, c.Type, c.Name, c.BiographyEn, c.BiographyJa, cr.RelatedId
            FROM CreatorRelationship cr
            JOIN Creator c ON c.CreatorId = cr.CreatorId
            WHERE cr.RelatedType = 'manga' AND cr.RelatedId IN ({placeholders})
            """,  # noqa: S608
            manga_ids,
        ).fetchall():
            cid_s = str(cid).lower()
            role = "artist" if (ctype or "").lower() == "artist" else "author"
            if cid_s not in creators_by_id:
                creators_by_id[cid_s] = {
                    "creator_id": cid_s,
                    "name": (cname or "Unknown Creator").strip(),
                    "bio_en": (bio_en or "").strip() or None,
                    "bio_ja": (bio_ja or "").strip() or None,
                }
            pair = (cid_s, role)
            if pair not in mcreator_map[str(mid).lower()]:
                mcreator_map[str(mid).lower()].append(pair)

        chapters_by_manga: dict[str, list[dict[str, Any]]] = defaultdict(list)
        raw_chapters = cur.execute(
            f"""
            SELECT ChapterId, MangaId, Volume, ChapterNumber, Title, TranslatedLang, Pages, PublishAt
            FROM Chapter
            WHERE MangaId IN ({placeholders})
              AND ISNULL(IsUnavailable, 0) = 0
              AND ISNULL(Pages, 0) > 0
              AND TranslatedLang IN ('vi', 'en')
            ORDER BY MangaId, TRY_CAST(ChapterNumber AS FLOAT) ASC, PublishAt DESC
            """,  # noqa: S608
            manga_ids,
        ).fetchall()

        seen_ch_key: set[tuple[str, str, str]] = set()
        for ch_id, mid, vol, ch_num, ch_title, lang, pages, pub_at in raw_chapters:
            mid_s = str(mid).lower()
            if len(chapters_by_manga[mid_s]) >= MAX_CHAPTERS_PER_MANGA:
                continue
            lang_s = (lang or "en").lower()
            num_s = (ch_num or "0").strip() or "0"
            dedupe_k = (mid_s, num_s, lang_s)
            if dedupe_k in seen_ch_key:
                continue
            seen_ch_key.add(dedupe_k)
            chapters_by_manga[mid_s].append(
                {
                    "chapter_id": str(ch_id).lower(),
                    "volume": (vol or "").strip()[:40] or None,
                    "chapter_number": num_s[:50],
                    "chapter_numeric": _parse_chapter_numeric(num_s),
                    "title": (ch_title or "").strip()[:500],
                    "language": lang_s[:16],
                    "reported_pages": int(pages or DEFAULT_DEMO_PAGES_PER_CHAPTER),
                    "publish_at": pub_at,
                }
            )

        comments_by_manga: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for mid, content, is_spoiler, created_at in cur.execute(
            f"""
            SELECT TOP 160 MangaId, Content, ISNULL(IsSpoiler, 0), CreatedAt
            FROM Comment
            WHERE MangaId IN ({placeholders})
              AND ISNULL(IsDeleted, 0) = 0
              AND Content IS NOT NULL AND LEN(LTRIM(RTRIM(Content))) >= 6
            ORDER BY CreatedAt DESC
            """,  # noqa: S608
            manga_ids,
        ).fetchall():
            mid_s = str(mid).lower()
            if len(comments_by_manga[mid_s]) < 4:
                comments_by_manga[mid_s].append(
                    {
                        "content": str(content).strip()[:1800],
                        "is_spoiler": bool(is_spoiler),
                        "created_at": created_at,
                    }
                )

        mangas: list[dict[str, Any]] = []
        for r in manga_rows:
            mid_s = str(r[0]).lower()
            descs = desc_map.get(mid_s, {})
            chosen_desc = (
                descs.get("vi")
                or descs.get("en")
                or next(iter(descs.values()), "")
                or "Imported from local MangaLibrary catalog."
            )
            status_raw = (r[2] or "ongoing").lower()
            if status_raw not in ("ongoing", "completed", "hiatus", "cancelled"):
                status_raw = "unknown"
            rating_raw = (r[3] or "safe").lower()
            if rating_raw not in ("safe", "suggestive", "erotica", "pornographic"):
                rating_raw = "unknown"
            demo_raw = (r[4] or "unknown").lower()
            if demo_raw not in ("shounen", "shoujo", "seinen", "josei", "kodomo"):
                demo_raw = "unknown"

            def _to_int_or_none(v: Any) -> int | None:
                try:
                    return int(float(str(v))) if v is not None and str(v).strip() else None
                except ValueError:
                    return None

            mangas.append(
                {
                    "manga_id": mid_s,
                    "title": str(r[1]).strip()[:500],
                    "status": status_raw,
                    "content_rating": rating_raw,
                    "demographic": demo_raw,
                    "original_language": (r[5] or "ja").lower()[:16],
                    "year": int(r[6]) if r[6] and 1800 <= int(r[6]) <= 2200 else None,
                    "official_volumes": _to_int_or_none(r[7]),
                    "official_chapters": _to_int_or_none(r[8]),
                    "cover_id": str(r[11]).lower() if r[11] else None,
                    "cover_key": str(r[12]).lstrip("/"),
                    "cover_volume": (str(r[14])[:40] if r[14] else "1"),
                    "cover_locale": (str(r[15])[:16] if r[15] else "ja"),
                    "follows": int(r[16] or 0),
                    "avg_rating": float(r[17] or 0.0),
                    "description": chosen_desc,
                    "alt_titles": alt_map.get(mid_s, [])[:12],
                    "links": link_map.get(mid_s, [])[:6],
                    "tag_ids": mtag_map.get(mid_s, []),
                    "creators": mcreator_map.get(mid_s, []),
                    "chapters": chapters_by_manga.get(mid_s, []),
                    "comments": comments_by_manga.get(mid_s, []),
                }
            )

        return {"tags": tags, "creators": creators_by_id, "mangas": mangas}


async def _ensure_account(
    container: AppContainer,
    *,
    username: str,
    email: str,
    password: str,
    display_name: str,
    bio: str,
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
                bio=bio,
                is_birth_date_public=False,
            )
        )
        db.add(ReaderSettingsModel(reader_account_id=acc.account_id, updated_at=now))
        await db.commit()
        return acc


async def run_import() -> int:
    settings = Settings()
    container = AppContainer(settings)
    bucket = settings.s3_default_bucket

    try:
        print("[import-local] Reading top manga & metadata from local SQL Server `MangaLibrary`...")
        source_data = _read_source_mangalibrary(limit=TARGET_MANGA_LIMIT)
        source_mangas: list[dict[str, Any]] = source_data["mangas"]
        print(
            f"[import-local] Found {len(source_mangas)} popular titles, "
            f"{len(source_data['tags'])} tags, {len(source_data['creators'])} linked creators."
        )

        # 1. Ensure demo & community accounts
        await _ensure_account(
            container,
            username="admin",
            email="admin@manga-reader.local",
            password="Admin@123456",
            display_name="Platform Admin",
            bio="System administrator for QL-DocTruyen.",
            is_admin=True,
        )
        reader1 = await _ensure_account(
            container,
            username="reader1",
            email="reader1@manga-reader.local",
            password="Reader@123456",
            display_name="Minh Anh",
            bio="Avid shounen & fantasy reader.",
        )
        reader2 = await _ensure_account(
            container,
            username="reader2",
            email="reader2@manga-reader.local",
            password="Reader@123456",
            display_name="Quoc Bao",
            bio="Seinen & mystery enthusiast.",
        )
        community_specs = [
            (
                "linh_nguyen",
                "linh@manga-reader.local",
                "Linh Nguyen",
                "Love slice-of-life and romance.",
            ),
            ("minh_tran", "minh@manga-reader.local", "Minh Tran", "Action & martial arts fan."),
            (
                "kenji_fan",
                "kenji@manga-reader.local",
                "Kenji Fan",
                "Reading raw & translated manga daily.",
            ),
            ("hana_reads", "hana@manga-reader.local", "Hana Reads", "Collecting favorite series."),
            ("bao_otaku", "bao@manga-reader.local", "Bao Otaku", "Isekai & comedy connoisseur."),
            (
                "thu_trang",
                "trang@manga-reader.local",
                "Thu Trang",
                "Mystery & historical manga reader.",
            ),
        ]
        community_accounts: list[AccountModel] = [reader1, reader2]
        for uname, email, dname, bio in community_specs:
            acc = await _ensure_account(
                container,
                username=uname,
                email=email,
                password="Reader@123456",
                display_name=dname,
                bio=bio,
            )
            community_accounts.append(acc)

        # 2. Download real covers from local MinIO into storage/local-dev (idempotent)
        print("[import-local] Syncing real cover images from local MinIO (`manga-media`)...")
        cover_meta: dict[str, tuple[str, str, int, str, str]] = {}
        downloaded_count = 0
        fallback_count = 0
        async with httpx.AsyncClient(timeout=8.0) as http_client:
            for item in source_mangas:
                src_key = item["cover_key"]
                ext = src_key.rsplit(".", 1)[-1].lower() if "." in src_key else "jpg"
                if ext not in ("jpg", "jpeg", "png", "webp"):
                    ext = "jpg"
                local_key = f"covers/local/{item['manga_id']}/cover.{ext}"
                ref = MediaObjectRef(bucket=bucket, object_key=local_key)
                if await container.storage.exists(ref):
                    raw = await container.storage.get_bytes(ref)
                    ct = (
                        "image/webp"
                        if ext == "webp"
                        else ("image/png" if ext == "png" else "image/jpeg")
                    )
                    cover_meta[item["manga_id"]] = (
                        local_key,
                        ct,
                        len(raw),
                        hashlib.md5(raw, usedforsecurity=False).hexdigest(),
                        hashlib.sha256(raw).hexdigest(),
                    )
                    downloaded_count += 1
                    continue

                fetched = await _fetch_cover_from_minio(http_client, src_key)
                if fetched is not None:
                    raw, ct = fetched
                    await container.storage.put_bytes(ref, raw, content_type=ct)
                    cover_meta[item["manga_id"]] = (
                        local_key,
                        ct,
                        len(raw),
                        hashlib.md5(raw, usedforsecurity=False).hexdigest(),
                        hashlib.sha256(raw).hexdigest(),
                    )
                    downloaded_count += 1
                else:
                    local_key = f"covers/local/{item['manga_id']}/cover.webp"
                    fb_ref = MediaObjectRef(bucket=bucket, object_key=local_key)
                    raw, md5_h, sha_h = render_placeholder_webp(
                        title=item["title"],
                        subtitle=f"{item['demographic'].upper()} | {item['status'].upper()}",
                        accent_rgb=(56, 189, 248),
                        width=600,
                        height=860,
                    )
                    await container.storage.put_bytes(fb_ref, raw, content_type="image/webp")
                    cover_meta[item["manga_id"]] = (local_key, "image/webp", len(raw), md5_h, sha_h)
                    fallback_count += 1

        print(
            f"[import-local] Covers ready: {downloaded_count} real MinIO covers, "
            f"{fallback_count} fallback covers."
        )

        # 3. Populate clean 47-table app database
        now = utc_now()
        async with container.db.session() as db:
            # 3a. Upsert all 76 tags
            tag_id_map: dict[str, tuple[int, str]] = {}
            for t in source_data["tags"]:
                tslug = _slugify(t["name"], t["tag_id"][:12])
                tgroup = (
                    t["group"] if t["group"] in ("genre", "theme", "format", "content") else "other"
                )
                existing_tag = await db.scalar(select(TagModel).where(TagModel.slug == tslug))
                if existing_tag is None:
                    existing_tag = TagModel(
                        source_tag_id=t["tag_id"],
                        mangadex_id=t["tag_id"],
                        slug=tslug,
                        name=t["name"][:200],
                        tag_group=tgroup,
                    )
                    db.add(existing_tag)
                    await db.flush()
                    db.add(
                        TagNameModel(
                            tag_id=existing_tag.tag_id,
                            language_code="en",
                            tag_name=t["name"][:200],
                        )
                    )
                    if tslug in VI_TAG_NAMES:
                        db.add(
                            TagNameModel(
                                tag_id=existing_tag.tag_id,
                                language_code="vi",
                                tag_name=VI_TAG_NAMES[tslug],
                            )
                        )
                tag_id_map[t["tag_id"]] = (existing_tag.tag_id, existing_tag.slug)

            # 3b. Upsert creators (`creator_id` is String(100))
            creator_id_set: set[str] = set()
            for cid_raw, cinfo in source_data["creators"].items():
                existing_cr = await db.get(CreatorModel, cid_raw)
                if existing_cr is None:
                    cslug = f"{_slugify(cinfo['name'], cid_raw[:8])}-{cid_raw[:6]}"
                    existing_cr = CreatorModel(
                        creator_id=cid_raw,
                        mangadex_id=cid_raw,
                        slug=cslug[:255],
                        name=cinfo["name"][:200],
                        biography=cinfo["bio_en"] or cinfo["bio_ja"],
                    )
                    db.add(existing_cr)
                    await db.flush()
                    if cinfo["bio_en"]:
                        db.add(
                            CreatorBiographyModel(
                                creator_id=cid_raw,
                                language_code="en",
                                biography=cinfo["bio_en"],
                            )
                        )
                    if cinfo["bio_ja"]:
                        db.add(
                            CreatorBiographyModel(
                                creator_id=cid_raw,
                                language_code="ja",
                                biography=cinfo["bio_ja"],
                            )
                        )
                creator_id_set.add(cid_raw)

            # 3c. Upsert all 80 real manga + chapters + lazy demo pages + vectors
            used_slugs: set[str] = set((await db.scalars(select(MangaModel.slug))).all())
            imported_mangas: list[MangaModel] = []
            total_chapters_inserted = 0

            for idx, item in enumerate(source_mangas):
                m_uuid = UUID(item["manga_id"])
                existing_m = await db.get(MangaModel, m_uuid)
                if existing_m is not None:
                    imported_mangas.append(existing_m)
                    continue

                base_slug = _slugify(item["title"], f"manga-{item['manga_id'][:8]}")
                slug = base_slug
                if slug in used_slugs:
                    slug = f"{base_slug}-{item['manga_id'][:6]}"
                used_slugs.add(slug)

                c_key, c_ct, c_size, c_md5, c_sha = cover_meta[item["manga_id"]]
                cover_media = await db.scalar(
                    select(MediaObjectModel).where(
                        MediaObjectModel.bucket == bucket,
                        MediaObjectModel.object_key == c_key,
                    )
                )
                if cover_media is None:
                    cover_media = MediaObjectModel(
                        bucket=bucket,
                        object_key=c_key,
                        content_type=c_ct,
                        file_size=c_size,
                        md5_hash=c_md5,
                        sha256=c_sha,
                        created_at=now,
                    )
                    db.add(cover_media)
                    await db.flush()

                initial_views = max(50, int(item["follows"] // 25))
                initial_rating = (
                    round(float(item["avg_rating"]), 2) if item["avg_rating"] > 0 else 8.0
                )

                manga = MangaModel(
                    manga_id=m_uuid,
                    pool_manga_id=f"mangadex:{item['manga_id']}",
                    source_manga_id=item["manga_id"],
                    mangadex_id=item["manga_id"],
                    slug=slug,
                    title=item["title"],
                    description=item["description"],
                    publication_status=item["status"],
                    content_rating=item["content_rating"],
                    publication_demographic=item["demographic"],
                    original_language=item["original_language"],
                    year=item["year"],
                    official_volumes=item["official_volumes"],
                    official_chapters=item["official_chapters"],
                    primary_cover_media_id=cover_media.media_id,
                    visibility_status="PUBLIC",
                    deletion_status="ACTIVE",
                    is_cdc_enabled=False,
                    is_syncing=False,
                    ignore_all_reports=False,
                    total_views=initial_views,
                    average_rating=Decimal(str(initial_rating)),
                    latest_chapter_at=now,
                    created_at=now,
                    updated_at=now,
                )
                db.add(manga)
                await db.flush()

                db.add(
                    MangaCoverArtModel(
                        manga_id=m_uuid,
                        cover_id=item["cover_id"],
                        volume=item["cover_volume"],
                        locale=item["cover_locale"],
                        description="Cover imported from local MinIO",
                        media_id=cover_media.media_id,
                    )
                )

                for alt_idx, alt in enumerate(item["alt_titles"]):
                    db.add(
                        MangaAltTitleModel(
                            manga_id=m_uuid,
                            alternative_title=alt[:500],
                            display_order=alt_idx,
                        )
                    )

                for site, url in item["links"]:
                    db.add(MangaLinkModel(manga_id=m_uuid, site=site[:100], url=url[:1000]))

                tag_slugs_for_vec: list[str] = []
                seen_tids: set[int] = set()
                for raw_tid in item["tag_ids"]:
                    mapped = tag_id_map.get(raw_tid)
                    if mapped and mapped[0] not in seen_tids:
                        seen_tids.add(mapped[0])
                        db.add(MangaTagModel(manga_id=m_uuid, tag_id=mapped[0]))
                        tag_slugs_for_vec.append(mapped[1])

                creator_ids_for_vec: list[str] = []
                seen_cr_roles: set[tuple[str, str]] = set()
                for raw_cid, role in item["creators"]:
                    if raw_cid in creator_id_set and (raw_cid, role) not in seen_cr_roles:
                        seen_cr_roles.add((raw_cid, role))
                        db.add(MangaCreatorModel(manga_id=m_uuid, creator_id=raw_cid, role=role))
                        creator_ids_for_vec.append(raw_cid)

                langs_seen: set[str] = set()
                total_pages_exported = 0
                for ch in item["chapters"]:
                    ch_uuid = UUID(ch["chapter_id"])
                    if await db.get(ChapterModel, ch_uuid) is not None:
                        continue
                    langs_seen.add(ch["language"])
                    demo_count = DEFAULT_DEMO_PAGES_PER_CHAPTER
                    total_pages_exported += demo_count
                    pub_at = ch["publish_at"]
                    if isinstance(pub_at, datetime) and pub_at.tzinfo is None:
                        pub_at = pub_at.replace(tzinfo=UTC)

                    ch_row = ChapterModel(
                        chapter_id=ch_uuid,
                        manga_id=m_uuid,
                        pool_chapter_id=f"mangadex:{ch['chapter_id']}",
                        source_chapter_id=ch["chapter_id"],
                        chapter_number=ch["chapter_number"],
                        chapter_numeric=ch["chapter_numeric"],
                        volume=ch["volume"],
                        title=ch["title"],
                        language=ch["language"],
                        scanlation_group="MangaLibrary Local",
                        publish_at=pub_at or now,
                        source="mangadex-local",
                        page_count=demo_count,
                        total_size_bytes=demo_count * 45_000,
                        pages_revision=1,
                        view_count=max(10, initial_views // max(len(item["chapters"]), 1)),
                        created_at=now,
                        updated_at=now,
                    )
                    db.add(ch_row)
                    await db.flush()

                    for p_num in range(1, demo_count + 1):
                        p_key = f"demo-pages/{ch_uuid}/{p_num:03d}.webp"
                        p_media = MediaObjectModel(
                            bucket=bucket,
                            object_key=p_key,
                            content_type="image/webp",
                            width=840,
                            height=1200,
                            created_at=now,
                        )
                        db.add(p_media)
                        await db.flush()
                        db.add(
                            ChapterPageModel(
                                chapter_id=ch_uuid,
                                page_uid=f"demo_{ch_uuid.hex[:12]}_{p_num:03d}",
                                page_number=p_num,
                                filename=f"{p_num:03d}.webp",
                                media_id=p_media.media_id,
                            )
                        )
                    total_chapters_inserted += 1

                db.add(
                    MangaLineageModel(
                        manga_id=m_uuid,
                        pool_revision=1,
                        source_metadata_revision=1,
                        manifest_sha256=hashlib.sha256(item["manga_id"].encode()).hexdigest(),
                        published_at=now,
                        updated_at=now,
                    )
                )
                db.add(
                    MangaStatsModel(
                        manga_id=m_uuid,
                        chapter_count=len(item["chapters"]),
                        page_count=total_pages_exported,
                        total_size_bytes=total_pages_exported * 45_000,
                        updated_at=now,
                    )
                )
                for lang_code in sorted(langs_seen):
                    db.add(MangaStatsLanguageModel(manga_id=m_uuid, language_code=lang_code))

                vec = compute_content_feature_vector(
                    tag_slugs=tag_slugs_for_vec,
                    creator_ids=creator_ids_for_vec,
                    demographic=item["demographic"],
                    title=item["title"],
                    description=item["description"],
                )
                db.add(
                    MangaContentVectorModel(
                        manga_id=m_uuid,
                        feature_vector_json=json.dumps(vec),
                        model_version="tfidf-v1",
                        updated_at=now,
                    )
                )

                for c_idx, cm in enumerate(item["comments"]):
                    author_acc = community_accounts[(idx + c_idx) % len(community_accounts)]
                    db.add(
                        CommentModel(
                            comment_id=uuid4(),
                            manga_id=m_uuid,
                            chapter_id=None,
                            parent_comment_id=None,
                            reader_account_id=author_acc.account_id,
                            content=sanitize_user_text(cm["content"], preserve_newlines=True),
                            is_deleted=False,
                            is_spoiler=cm["is_spoiler"],
                            is_spoiler_locked_by_admin=False,
                            is_edited=False,
                            like_count=(idx + c_idx) % 9,
                            dislike_count=0,
                            created_at=now,
                            updated_at=now,
                        )
                    )

                imported_mangas.append(manga)

            # 3d. Add 1 unrated (`content_rating = unknown`) demo title for Explore filter testing
            unknown_uuid = uuid5(NAMESPACE_URL, "ql-doctruyen:unknown-rating-sample")
            if await db.get(MangaModel, unknown_uuid) is None:
                u_key = "covers/local/unknown-sample/cover.webp"
                u_ref = MediaObjectRef(bucket=bucket, object_key=u_key)
                u_raw, u_md5, u_sha = render_placeholder_webp(
                    title="Mystery of the Silent Bell",
                    subtitle="UNRATED SAMPLE | DEMO CHAPTER",
                    accent_rgb=(248, 113, 113),
                    width=600,
                    height=860,
                )
                if not await container.storage.exists(u_ref):
                    await container.storage.put_bytes(u_ref, u_raw, content_type="image/webp")
                u_media = MediaObjectModel(
                    bucket=bucket,
                    object_key=u_key,
                    content_type="image/webp",
                    width=600,
                    height=860,
                    file_size=len(u_raw),
                    md5_hash=u_md5,
                    sha256=u_sha,
                    created_at=now,
                )
                db.add(u_media)
                await db.flush()
                u_manga = MangaModel(
                    manga_id=unknown_uuid,
                    pool_manga_id="local:unknown-sample",
                    source_manga_id="local-unknown-001",
                    slug="mystery-of-the-silent-bell",
                    title="Mystery of the Silent Bell",
                    description="An unrated folklore mystery anthology (verifies `safe` excludes `unknown`).",
                    publication_status="hiatus",
                    content_rating="unknown",
                    publication_demographic="josei",
                    original_language="ja",
                    year=2021,
                    primary_cover_media_id=u_media.media_id,
                    visibility_status="PUBLIC",
                    deletion_status="ACTIVE",
                    total_views=42,
                    average_rating=Decimal("7.50"),
                    latest_chapter_at=now,
                    created_at=now,
                    updated_at=now,
                )
                db.add(u_manga)
                await db.flush()
                u_ch_id = uuid5(NAMESPACE_URL, "ql-doctruyen:unknown-sample:ch1")
                db.add(
                    ChapterModel(
                        chapter_id=u_ch_id,
                        manga_id=unknown_uuid,
                        pool_chapter_id="local:unknown-sample:ch1",
                        source_chapter_id="local-unknown-ch1",
                        chapter_number="1",
                        chapter_numeric=Decimal("1.00"),
                        volume="1",
                        title="Fog Over Kiri Pass",
                        language="en",
                        scanlation_group="Demo Studio",
                        publish_at=now,
                        source="local-demo",
                        page_count=4,
                        pages_revision=1,
                        view_count=42,
                        created_at=now,
                        updated_at=now,
                    )
                )
                await db.flush()
                for p_num in range(1, 5):
                    pm = MediaObjectModel(
                        bucket=bucket,
                        object_key=f"demo-pages/{u_ch_id}/{p_num:03d}.webp",
                        content_type="image/webp",
                        width=840,
                        height=1200,
                        created_at=now,
                    )
                    db.add(pm)
                    await db.flush()
                    db.add(
                        ChapterPageModel(
                            chapter_id=u_ch_id,
                            page_uid=f"demo_unk_{p_num:03d}",
                            page_number=p_num,
                            filename=f"{p_num:03d}.webp",
                            media_id=pm.media_id,
                        )
                    )
                db.add(
                    MangaStatsModel(
                        manga_id=unknown_uuid,
                        chapter_count=1,
                        page_count=4,
                        total_size_bytes=180_000,
                        updated_at=now,
                    )
                )
                db.add(MangaStatsLanguageModel(manga_id=unknown_uuid, language_code="en"))

            await db.commit()

            # 4. Seed realistic ratings, reading histories, lists & sample reports for immediate testing
            existing_ratings_cnt = int(
                await db.scalar(select(func.count()).select_from(RatingModel)) or 0
            )
            if existing_ratings_cnt == 0 and len(imported_mangas) >= 12:
                for u_idx, acc in enumerate(community_accounts):
                    start_i = (u_idx * 2) % 10
                    for offset in range(6):
                        m = imported_mangas[start_i + offset]
                        first_ch = await db.scalar(
                            select(ChapterModel)
                            .where(ChapterModel.manga_id == m.manga_id)
                            .order_by(ChapterModel.chapter_numeric.asc())
                        )
                        if first_ch is None:
                            continue
                        db.add(
                            ReadingHistoryModel(
                                history_id=uuid4(),
                                reader_account_id=acc.account_id,
                                chapter_id=first_ch.chapter_id,
                                opened_at=now,
                                last_read_at=now,
                                reading_duration_seconds=45 + offset * 10,
                                is_valid_view=True,
                            )
                        )
                        db.add(
                            ReaderProgressModel(
                                reader_account_id=acc.account_id,
                                manga_id=m.manga_id,
                                chapter_id=first_ch.chapter_id,
                                page_number=min(3, first_ch.page_count),
                                page_uid=f"demo_{first_ch.chapter_id.hex[:12]}_003",
                                pages_revision=1,
                                client_sequence=1,
                                updated_at=now,
                            )
                        )
                        score = 7 + ((u_idx + offset) % 4)
                        db.add(
                            RatingModel(
                                rating_id=uuid4(),
                                reader_account_id=acc.account_id,
                                manga_id=m.manga_id,
                                score=score,
                                updated_at=now,
                            )
                        )
                        db.add(
                            ReadingStatusRecordModel(
                                reader_account_id=acc.account_id,
                                manga_id=m.manga_id,
                                status="READING" if offset < 4 else "COMPLETED",
                                updated_at=now,
                            )
                        )
                await db.commit()

                for m in imported_mangas[:20]:
                    avg_val = await db.scalar(
                        select(func.avg(RatingModel.score)).where(
                            RatingModel.manga_id == m.manga_id
                        )
                    )
                    if avg_val is not None:
                        m.average_rating = Decimal(f"{float(avg_val):.2f}")
                await db.commit()

                p1 = SecurityPrincipal(
                    account_id=AccountId(reader1.account_id),
                    role=AccountRole.READER,
                    status=AccountStatus.ACTIVE,
                )
                list_svc = ReadingListService(container)
                list_a = await list_svc.create_list(
                    db,
                    principal=p1,
                    name="Top Action & Fantasy",
                    description="My favorite high-energy manga from the catalog.",
                )
                list_b = await list_svc.create_list(
                    db,
                    principal=p1,
                    name="Weekend Binge List",
                    description="Series saved for weekend reading sessions.",
                )
                await list_svc.create_list(
                    db,
                    principal=p1,
                    name="Empty Starter List",
                    description="An empty list ready to test empty metadata statistics.",
                )
                for m in imported_mangas[:5]:
                    await list_svc.sync_manga_memberships(
                        db,
                        principal=p1,
                        manga_id=m.manga_id,
                        selected_list_ids=[UUID(list_a["listId"])],
                    )
                for m in imported_mangas[3:8]:
                    current_ids = [UUID(list_b["listId"])]
                    if m in imported_mangas[:5]:
                        current_ids.append(UUID(list_a["listId"]))
                    await list_svc.sync_manga_memberships(
                        db,
                        principal=p1,
                        manga_id=m.manga_id,
                        selected_list_ids=current_ids,
                    )

                mod_svc = ModerationReportingService(container)
                await mod_svc.submit_manga_report(
                    db,
                    principal=p1,
                    target_manga_id=imported_mangas[0].manga_id,
                    target_chapter_id=None,
                    reason_category="WRONG_METADATA",
                    description="Sample pending report to test Admin Moderation Queue.",
                )
                first_comment = await db.scalar(
                    select(CommentModel).where(CommentModel.reader_account_id != reader1.account_id)
                )
                if first_comment is not None:
                    await mod_svc.submit_comment_report(
                        db,
                        principal=p1,
                        target_comment_id=first_comment.comment_id,
                        reason_category="UNMARKED_SPOILER",
                        description="Sample pending comment report for Admin Spoiler Lock test.",
                    )

        print(
            f"[import-local] DONE! Imported {len(imported_mangas)} real mangas "
            f"(+1 unrated test manga), {total_chapters_inserted} real chapters, "
            f"{len(source_data['tags'])} tags, {len(source_data['creators'])} creators, "
            "plus community comments, ratings, reading lists & demo accounts."
        )
        return 0
    finally:
        await container.shutdown()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_import()))
