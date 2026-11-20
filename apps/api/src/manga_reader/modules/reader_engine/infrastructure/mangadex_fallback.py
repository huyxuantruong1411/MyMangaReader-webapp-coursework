"""Hybrid chapter page delivery: live MangaDex At-Home fallback + illustrated demo WebP renderer.

Allows chapters imported from local `MangaLibrary` (which have real MangaDex chapter UUIDs
but no pre-downloaded page files) to seamlessly load live pages via MangaDex At-Home API
with local disk caching, while guaranteeing 100% readable illustrated demo WebP pages
whenever offline or when an external chapter is unavailable.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import textwrap
from typing import Any
from uuid import UUID

import httpx
from PIL import Image, ImageDraw

from manga_reader.infrastructure.cache import CacheAdapter

logger = logging.getLogger(__name__)

_MANGADEX_AT_HOME_URL = "https://api.mangadex.org/at-home/server/{chapter_id}"
_MANGADEX_CACHE_TTL_SECONDS = 600
_HTTP_HEADERS = {"User-Agent": "QL-DocTruyen-MangaReader/1.0"}


def is_mangadex_uuid(value: str | None) -> bool:
    """Return True if value looks like a canonical 36-char MangaDex UUID."""
    if not value or len(value) != 36:
        return False
    try:
        UUID(value)
        return True
    except ValueError:
        return False


async def fetch_mangadex_at_home(
    chapter_uuid: str,
    *,
    cache: CacheAdapter,
    use_data_saver: bool = True,
) -> list[dict[str, str]] | None:
    """Fetch and cache MangaDex At-Home page URLs for a chapter UUID.

    Returns a list of `{"filename": ..., "remote_url": ...}` dicts or `None` if unavailable.
    """
    norm_id = chapter_uuid.strip().lower()
    if not is_mangadex_uuid(norm_id):
        return None

    cache_key = f"mdex:athome:{'ds' if use_data_saver else 'full'}:{norm_id}"
    cached = await cache.get(cache_key)
    if cached is not None:
        if cached == "NONE":
            return None
        try:
            parsed = json.loads(cached)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

    url = _MANGADEX_AT_HOME_URL.format(chapter_id=norm_id)
    try:
        async with httpx.AsyncClient(timeout=6.0, headers=_HTTP_HEADERS) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                await cache.set(cache_key, "NONE", ttl_seconds=180)
                return None
            payload: dict[str, Any] = resp.json()
    except Exception as exc:
        logger.debug("MangaDex At-Home lookup failed for %s: %s", norm_id, exc)
        await cache.set(cache_key, "NONE", ttl_seconds=60)
        return None

    base_url = str(payload.get("baseUrl") or "").rstrip("/")
    ch_obj = payload.get("chapter")
    if not base_url or not isinstance(ch_obj, dict):
        await cache.set(cache_key, "NONE", ttl_seconds=180)
        return None

    ch_hash = str(ch_obj.get("hash") or "")
    data_saver_list = ch_obj.get("dataSaver")
    data_list = ch_obj.get("data")

    if use_data_saver and isinstance(data_saver_list, list) and data_saver_list:
        mode = "data-saver"
        filenames = [str(x) for x in data_saver_list]
    elif isinstance(data_list, list) and data_list:
        mode = "data"
        filenames = [str(x) for x in data_list]
    else:
        await cache.set(cache_key, "NONE", ttl_seconds=180)
        return None

    if not ch_hash or not filenames:
        await cache.set(cache_key, "NONE", ttl_seconds=180)
        return None

    pages = [
        {
            "filename": fname,
            "remote_url": f"{base_url}/{mode}/{ch_hash}/{fname}",
        }
        for fname in filenames
    ]
    await cache.set(cache_key, json.dumps(pages), ttl_seconds=_MANGADEX_CACHE_TTL_SECONDS)
    return pages


async def fetch_remote_image_bytes(remote_url: str) -> tuple[bytes, str] | None:
    """Download image bytes from an upstream MangaDex CDN URL."""
    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True,
            headers=_HTTP_HEADERS,
        ) as client:
            resp = await client.get(remote_url)
            if resp.status_code != 200 or not resp.content:
                return None
            ct = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip().lower()
            if not ct.startswith("image/"):
                return None
            return resp.content, ct
    except Exception as exc:
        logger.debug("Failed downloading MangaDex page %s: %s", remote_url, exc)
        return None


def _pick_accent_rgb(seed_text: str) -> tuple[int, int, int]:
    palette = [
        (56, 189, 248),  # sky
        (168, 85, 247),  # purple
        (52, 211, 153),  # emerald
        (251, 146, 60),  # orange
        (244, 114, 182),  # pink
        (250, 204, 21),  # amber
    ]
    digest = hashlib.md5(seed_text.encode("utf-8"), usedforsecurity=False).digest()
    return palette[digest[0] % len(palette)]


def render_manga_demo_page_webp(
    *,
    manga_title: str,
    chapter_number: str,
    chapter_title: str,
    language: str,
    page_number: int,
    total_pages: int,
    width: int = 840,
    height: int = 1200,
) -> bytes:
    """Render a crisp manga-panel-styled fallback WebP page so reading never shows broken images."""
    accent = _pick_accent_rgb(manga_title)
    img = Image.new("RGB", (width, height), (245, 244, 240))
    draw = ImageDraw.Draw(img)

    # Outer manga page margin & ink border
    draw.rectangle(
        [(24, 24), (width - 24, height - 24)], fill=(255, 255, 255), outline=(22, 24, 30), width=5
    )

    # Header ribbon
    draw.rectangle([(24, 24), (width - 24, 92)], fill=(18, 22, 32))
    header_title = manga_title[:44] + ("..." if len(manga_title) > 44 else "")
    draw.text((44, 40), header_title, fill=(248, 250, 252))
    draw.text(
        (44, 64),
        f"Chapter {chapter_number} ({language.upper()})  |  Page {page_number} of {total_pages}",
        fill=accent,
    )

    # Vary comic panel layout by page number for a realistic manga spread feel
    layout_variant = page_number % 3
    if layout_variant == 1:
        panels = [
            (46, 114, width - 46, 480),
            (46, 502, 410, 860),
            (430, 502, width - 46, 860),
            (46, 882, width - 46, 1122),
        ]
    elif layout_variant == 2:
        panels = [
            (46, 114, 480, 540),
            (500, 114, width - 46, 540),
            (46, 562, width - 46, 820),
            (46, 842, 390, 1122),
            (410, 842, width - 46, 1122),
        ]
    else:
        panels = [
            (46, 114, width - 46, 390),
            (46, 412, width - 46, 770),
            (46, 792, 420, 1122),
            (440, 792, width - 46, 1122),
        ]

    shades = [(240, 244, 248), (232, 237, 244), (246, 242, 236), (235, 241, 239), (242, 236, 246)]
    for idx, (x1, y1, x2, y2) in enumerate(panels):
        fill_col = shades[(idx + page_number) % len(shades)]
        draw.rectangle([(x1, y1), (x2, y2)], fill=fill_col, outline=(22, 24, 30), width=4)
        # Subtle comic speed-lines / halftone diagonals in corner
        for step in range(0, 90, 12):
            draw.line(
                [(x1 + 8, y1 + 8 + step), (x1 + 8 + step, y1 + 8)], fill=(205, 213, 225), width=1
            )

    # First panel: scene title & speech bubble
    p0 = panels[0]
    bubble_box = (p0[0] + 36, p0[1] + 34, min(p0[2] - 36, p0[0] + 540), p0[1] + 170)
    draw.rounded_rectangle(
        bubble_box, radius=24, fill=(255, 255, 255), outline=(22, 24, 30), width=3
    )
    ch_label = chapter_title or f"Chapter {chapter_number}"
    wrapped_lines = textwrap.wrap(f"{manga_title} — {ch_label}", width=44)[:3]
    y_cursor = bubble_box[1] + 22
    for line in wrapped_lines:
        draw.text((bubble_box[0] + 20, y_cursor), line, fill=(15, 23, 42))
        y_cursor += 24
    draw.text(
        (bubble_box[0] + 20, bubble_box[3] - 32),
        f"Demo Fallback Panel · Page {page_number}/{total_pages}",
        fill=(100, 116, 139),
    )

    # Accent badge inside second panel
    p1 = panels[1]
    draw.rounded_rectangle(
        (p1[0] + 24, p1[1] + 24, p1[0] + 280, p1[1] + 84),
        radius=12,
        fill=(18, 22, 32),
        outline=accent,
        width=2,
    )
    draw.text((p1[0] + 40, p1[1] + 46), f"SCENE {page_number:02d} · DEMO ART", fill=accent)

    # Bottom page footer
    draw.text(
        (width // 2 - 110, height - 56),
        f"QL-DocTruyen Reader · Page {page_number} / {total_pages}",
        fill=(71, 85, 105),
    )

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=84)
    return buf.getvalue()
