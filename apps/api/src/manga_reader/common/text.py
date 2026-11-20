"""Unicode normalization, accent folding, list-name canonicalization, and XSS sanitization."""

from __future__ import annotations

import html
import re
import unicodedata

_WHITESPACE_RE = re.compile(r"\s+")
_RESERVED_DISPLAY_NAMES = frozenset(
    {
        "admin",
        "administrator",
        "moderator",
        "mod",
        "system",
        "root",
        "support",
        "staff",
        "official",
    }
)


def strip_accents(value: str) -> str:
    """Fold Unicode accents/diacritics (including Vietnamese d/đ) for search & dedupe."""
    replaced = value.replace("đ", "d").replace("Đ", "D")
    nfd = unicodedata.normalize("NFD", replaced)
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def normalize_search_text(value: str) -> str:
    """Case-insensitive, accent-insensitive collapsed search key."""
    collapsed = _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", value).strip())
    return strip_accents(collapsed).casefold()


def normalize_list_name(value: str) -> str:
    """Canonical unique reading-list name per owner (03_DOMAIN_RULES §12)."""
    collapsed = _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", value).strip())
    return collapsed.casefold()


def normalize_identifier(value: str) -> str:
    """Normalize email or username for case-insensitive unique lookup."""
    return unicodedata.normalize("NFKC", value).strip().casefold()


def is_reserved_display_name(value: str) -> bool:
    """Detect impersonation attempts (`Admin`, `Moderator`, `System`, spaced/accented variants)."""
    folded = normalize_search_text(value)
    compact = re.sub(r"[^a-z0-9]", "", folded)
    tokens = re.findall(r"[a-z0-9]+", folded)
    return (
        folded in _RESERVED_DISPLAY_NAMES
        or compact in _RESERVED_DISPLAY_NAMES
        or any(tok in _RESERVED_DISPLAY_NAMES for tok in tokens)
    )


def sanitize_user_text(value: str, *, preserve_newlines: bool = True) -> str:
    """Escape raw HTML/script payloads while preserving safe plain text."""
    normalized = unicodedata.normalize("NFKC", value)
    if preserve_newlines:
        normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    return html.escape(normalized.strip(), quote=False)
