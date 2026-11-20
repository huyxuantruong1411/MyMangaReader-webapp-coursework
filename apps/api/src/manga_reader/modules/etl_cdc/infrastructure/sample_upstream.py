"""Built-in local development External Manga Service catalog & synthetic WebP asset generator.

Provides realistic, contract-valid `manga-reader-package:2.0` packages and real
rendered WebP cover/page images stored under canonical `(bucket, object_key)`
identities so ETL, Catalog, Reader, and Recommendations work out-of-the-box locally.
"""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageDraw

from manga_reader.common.identities import MediaObjectRef
from manga_reader.infrastructure.storage import ObjectStorageAdapter


@dataclass(frozen=True, slots=True)
class SampleSourcePackage:
    source_manga_id: str
    pool_manga_id: str
    title: str
    payload: dict[str, Any]


def render_placeholder_webp(
    *,
    title: str,
    subtitle: str,
    accent_rgb: tuple[int, int, int],
    width: int = 800,
    height: int = 1150,
) -> tuple[bytes, str, str]:
    """Generate a crisp dark-styled WebP image (returns bytes, md5, sha256)."""
    img = Image.new("RGB", (width, height), (18, 22, 32))
    draw = ImageDraw.Draw(img)
    # Gradient-like accent bands and crisp manga panel framing
    draw.rectangle([(0, 0), (width, 18)], fill=accent_rgb)
    draw.rectangle([(0, height - 18), (width, height)], fill=accent_rgb)
    draw.rectangle([(36, 48), (width - 36, height - 48)], outline=accent_rgb, width=4)
    draw.rectangle(
        [(56, 72), (width - 56, int(height * 0.48))],
        fill=(26, 33, 48),
        outline=(70, 86, 115),
        width=2,
    )
    draw.rectangle(
        [(56, int(height * 0.52)), (int(width * 0.48), height - 72)],
        fill=(23, 29, 43),
        outline=(70, 86, 115),
        width=2,
    )
    draw.rectangle(
        [(int(width * 0.52), int(height * 0.52)), (width - 56, height - 72)],
        fill=(29, 36, 54),
        outline=(70, 86, 115),
        width=2,
    )
    draw.text((84, 120), title[:48], fill=(241, 245, 249))
    draw.text((84, 165), subtitle[:64], fill=accent_rgb)
    draw.text((84, int(height * 0.56)), "Manga Reader Panel Preview", fill=(148, 163, 184))
    draw.text(
        (int(width * 0.55), int(height * 0.56)), f"{width}x{height} WebP", fill=(148, 163, 184)
    )

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=85)
    raw = buf.getvalue()
    return raw, hashlib.md5(raw, usedforsecurity=False).hexdigest(), hashlib.sha256(raw).hexdigest()


async def build_sample_packages(
    storage: ObjectStorageAdapter,
    *,
    bucket: str = "manga-reader-media",
) -> list[SampleSourcePackage]:
    """Generate 5 diverse v2.0 manga packages and upload their WebP assets to storage."""
    specs: list[dict[str, Any]] = [
        {
            "pool_manga_id": "pm_azure_blade_001",
            "slug": "chronicles-of-the-azure-blade",
            "source_manga_id": "src_azure_001",
            "title": "Chronicles of the Azure Blade",
            "alt_titles": ["Ao no Yaiba Senki", "Biên Niên Sử Lam Kiếm"],
            "description": "A wandering archivist uncovers sealed sword chronicles across floating citadels.",
            "status": "ongoing",
            "content_rating": "safe",
            "demographic": "shounen",
            "lang": "ja",
            "year": 2024,
            "accent": (56, 189, 248),
            "creators": [
                ("cr_akira_kuroda", "akira-kuroda", "Akira Kuroda", "author"),
                ("cr_akira_kuroda", "akira-kuroda", "Akira Kuroda", "artist"),
            ],
            "tags": [
                ("action", "genre", "Action", "Hành động"),
                ("fantasy", "genre", "Fantasy", "Giả tưởng"),
                ("adventure", "genre", "Adventure", "Phiêu lưu"),
            ],
            "chapters": [
                ("pc_azure_ch0", "Prologue", 0.0, "1", "The Sealed Archive", "en", 3),
                ("pc_azure_ch1_en", "1", 1.0, "1", "Blade of the North", "en", 4),
                ("pc_azure_ch1_vi", "1", 1.0, "1", "Lưỡi Kiếm Phương Bắc", "vi", 4),
                ("pc_azure_ch2", "2", 2.0, "1", "Citadel of Ash", "en", 3),
                ("pc_azure_extra", "2.5", 2.5, "1", "Extra: Keeper's Diary", "en", 2),
            ],
        },
        {
            "pool_manga_id": "pm_starlight_atelier_002",
            "slug": "starlight-atelier",
            "source_manga_id": "src_starlight_002",
            "title": "Starlight Atelier",
            "alt_titles": ["Hoshikuzu no Kobo", "Xưởng Chế Tác Ánh Sao"],
            "description": "Two rival clockmakers craft celestial lenses while decoding an ancient star map.",
            "status": "completed",
            "content_rating": "safe",
            "demographic": "shoujo",
            "lang": "ja",
            "year": 2022,
            "accent": (192, 132, 252),
            "creators": [
                ("cr_hana_morita", "hana-morita", "Hana Morita", "author"),
                ("cr_ren_takahashi", "ren-takahashi", "Ren Takahashi", "artist"),
            ],
            "tags": [
                ("fantasy", "genre", "Fantasy", "Giả tưởng"),
                ("slice-of-life", "genre", "Slice of Life", "Đời thường"),
                ("mystery", "theme", "Mystery", "Bí ẩn"),
            ],
            "chapters": [
                ("pc_star_ch1", "1", 1.0, "1", "The Broken Astrolabe", "en", 3),
                ("pc_star_ch2", "2", 2.0, "1", "Comet Glass", "en", 3),
                ("pc_star_ch3", "3", 3.0, "2", "Solstice Finale", "en", 3),
            ],
        },
        {
            "pool_manga_id": "pm_neon_courier_003",
            "slug": "neon-courier-2099",
            "source_manga_id": "src_neon_003",
            "title": "Neon Courier 2099",
            "alt_titles": ["Người Giao Hàng Thành Phố Neon", "Cyber Runner 99"],
            "description": "In a rain-drenched megacity, a data runner delivers encrypted memories across rooftop rails.",
            "status": "ongoing",
            "content_rating": "suggestive",
            "demographic": "seinen",
            "lang": "ko",
            "year": 2025,
            "accent": (52, 211, 153),
            "creators": [
                ("cr_minjun_seo", "minjun-seo", "Minjun Seo", "author"),
                ("cr_akira_kuroda", "akira-kuroda", "Akira Kuroda", "artist"),
            ],
            "tags": [
                ("action", "genre", "Action", "Hành động"),
                ("sci-fi", "genre", "Sci-Fi", "Khoa học viễn tưởng"),
                ("long-strip", "format", "Long Strip", "Webtoon cuộn dọc"),
            ],
            "chapters": [
                ("pc_neon_ch1", "1", 1.0, None, "Packet Zero", "en", 4),
                ("pc_neon_ch2", "2", 2.0, None, "Signal Ghost", "en", 4),
            ],
        },
        {
            "pool_manga_id": "pm_crimson_kitchen_004",
            "slug": "crimson-dragon-kitchen",
            "source_manga_id": "src_kitchen_004",
            "title": "Crimson Dragon Kitchen",
            "alt_titles": ["Bếp Rồng Đỏ", "Akaryu Shokudo"],
            "description": "A retired adventurer opens a midnight ramen tavern serving dragons and dungeon guides.",
            "status": "ongoing",
            "content_rating": "safe",
            "demographic": "seinen",
            "lang": "ja",
            "year": 2023,
            "accent": (251, 146, 60),
            "creators": [
                ("cr_kenji_sato", "kenji-sato", "Kenji Sato", "author"),
                ("cr_kenji_sato", "kenji-sato", "Kenji Sato", "artist"),
            ],
            "tags": [
                ("comedy", "genre", "Comedy", "Hài hước"),
                ("fantasy", "genre", "Fantasy", "Giả tưởng"),
                ("slice-of-life", "genre", "Slice of Life", "Đời thường"),
            ],
            "chapters": [
                ("pc_kitchen_ch1", "1", 1.0, "1", "Spicy Wyvern Broth", "en", 3),
                ("pc_kitchen_ch2", "2", 2.0, "1", "Midnight Dumplings", "en", 3),
            ],
        },
        {
            "pool_manga_id": "pm_silent_bell_005",
            "slug": "mystery-of-the-silent-bell",
            "source_manga_id": "src_bell_005",
            "title": "Mystery of the Silent Bell",
            "alt_titles": ["Tiếng Chuông Thầm Lặng"],
            "description": "An unrated folkloric anthology investigating vanished mountain shrines.",
            "status": "hiatus",
            "content_rating": "unknown",
            "demographic": "josei",
            "lang": "ja",
            "year": 2021,
            "accent": (248, 113, 113),
            "creators": [
                ("cr_hana_morita", "hana-morita", "Hana Morita", "author"),
            ],
            "tags": [
                ("mystery", "theme", "Mystery", "Bí ẩn"),
                ("drama", "genre", "Drama", "Chính kịch"),
            ],
            "chapters": [
                ("pc_bell_ch1", "1", 1.0, "1", "Fog Over Kiri Pass", "en", 2),
            ],
        },
    ]

    results: list[SampleSourcePackage] = []
    for spec in specs:
        pm_id: str = spec["pool_manga_id"]
        cover_key = f"covers/{pm_id}/cover.webp"
        cover_ref = MediaObjectRef(bucket=bucket, object_key=cover_key)
        cover_bytes, cover_md5, cover_sha = render_placeholder_webp(
            title=spec["title"],
            subtitle=f"{spec['demographic'].upper()} | {spec['status'].upper()}",
            accent_rgb=spec["accent"],
            width=600,
            height=860,
        )
        if not await storage.exists(cover_ref):
            await storage.put_bytes(cover_ref, cover_bytes, content_type="image/webp")

        chapters_payload: list[dict[str, Any]] = []
        total_pages = 0
        total_bytes = 0
        langs: set[str] = set()

        for pc_id, ch_num, ch_numeric, vol, ch_title, lang, num_pages in spec["chapters"]:
            langs.add(lang)
            pages_payload: list[dict[str, Any]] = []
            ch_size = 0
            for p_num in range(1, num_pages + 1):
                p_key = f"chapters/{pc_id}/{p_num:03d}.webp"
                p_ref = MediaObjectRef(bucket=bucket, object_key=p_key)
                p_bytes, p_md5, p_sha = render_placeholder_webp(
                    title=f"{spec['title']} — Ch.{ch_num}",
                    subtitle=f"{ch_title} · Page {p_num}/{num_pages} ({lang.upper()})",
                    accent_rgb=spec["accent"],
                    width=800,
                    height=1150,
                )
                if not await storage.exists(p_ref):
                    await storage.put_bytes(p_ref, p_bytes, content_type="image/webp")
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
            chapters_payload.append(
                {
                    "pool_chapter_id": pc_id,
                    "pool_manga_id": pm_id,
                    "source_chapter_id": f"src_{pc_id}",
                    "chapter_number": ch_num,
                    "chapter_numeric": ch_numeric,
                    "volume": vol,
                    "title": ch_title,
                    "language": lang,
                    "scanlation_group": "QL-DocTruyen Studio",
                    "publish_at": "2026-11-18T10:00:00Z",
                    "source": "mangadex",
                    "source_id": None,
                    "page_count": num_pages,
                    "total_size_bytes": ch_size,
                    "pages_revision": 1,
                    "manifest_sha256": hashlib.sha256(pc_id.encode()).hexdigest(),
                    "updated_at": "2026-11-18T10:00:00Z",
                    "pages": pages_payload,
                }
            )

        payload: dict[str, Any] = {
            "contract_name": "manga-reader-package",
            "contract_version": "2.0",
            "exported_at": "2026-11-20T10:00:00Z",
            "manga": {
                "pool_manga_id": pm_id,
                "slug": spec["slug"],
                "source_manga_id": spec["source_manga_id"],
                "mangadex_id": None,
                "title": spec["title"],
                "alt_titles": spec["alt_titles"],
                "description": spec["description"],
                "status": spec["status"],
                "content_rating": spec["content_rating"],
                "publication_demographic": spec["demographic"],
                "original_language": spec["lang"],
                "year": spec["year"],
                "published_start_date": f"{spec['year']}-01-01",
                "published_end_date": None,
                "official_volumes": 3,
                "official_chapters": 24,
                "creators": [
                    {
                        "creator_id": cid,
                        "slug": cslug,
                        "name": cname,
                        "role": crole,
                        "mangadex_id": None,
                        "biography": {
                            "en": f"{cname} is a featured creator in the Manga Reader catalog.",
                            "vi": f"{cname} là tác giả/họa sĩ nổi bật trong hệ thống đọc truyện.",
                        },
                        "links": {"website": f"https://example.org/creators/{cslug}"},
                    }
                    for cid, cslug, cname, crole in spec["creators"]
                ],
                "tags": [
                    {
                        "slug": tslug,
                        "source_tag_id": f"src_tag_{tslug}",
                        "mangadex_id": None,
                        "group": tgroup,
                        "name": {"en": t_en, "vi": t_vi},
                    }
                    for tslug, tgroup, t_en, t_vi in spec["tags"]
                ],
                "links": [
                    {"site": "Official Catalog", "url": f"https://example.org/manga/{spec['slug']}"}
                ],
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
                        "cover_id": f"cov_{pm_id}_1",
                        "volume": "1",
                        "locale": spec["lang"],
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
                    "chapter_count": len(chapters_payload),
                    "page_count": total_pages,
                    "total_size_bytes": total_bytes,
                    "languages": sorted(langs),
                },
                "lineage": {
                    "pool_revision": 1,
                    "source_metadata_revision": 1,
                    "manifest_sha256": hashlib.sha256(pm_id.encode()).hexdigest(),
                    "published_at": "2026-11-18T08:00:00Z",
                    "updated_at": "2026-11-20T10:00:00Z",
                },
            },
            "chapters": chapters_payload,
        }
        results.append(
            SampleSourcePackage(
                source_manga_id=spec["source_manga_id"],
                pool_manga_id=pm_id,
                title=spec["title"],
                payload=payload,
            )
        )
    return results


def serialize_package(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")
