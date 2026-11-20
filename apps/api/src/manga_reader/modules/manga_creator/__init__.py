"""Module 2: Manga and Creator Management (`UC-2.1`, `UC-2.2`, `UC-2.4`).

Owns: `mangas`, `chapters`, `chapter_pages`, `creators`, `tags`, `media_objects`,
`manga_lineage`, `manga_stats`, `manga_moderation_logs`, and localization tables.
Canonical invariants:
- Only `PUBLIC` manga appear in public endpoints.
- Chapter sorting uses `(chapter_numeric, language, pool_chapter_id/chapter_id)` (ADR-013).
- Local deletion blocks while `is_syncing=True`, cancels CDC, writes tombstone (ADR-011).
"""

from enum import StrEnum


class MangaVisibilityStatus(StrEnum):
    PUBLIC = "PUBLIC"
    HIDDEN = "HIDDEN"


class MangaDeletionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DELETING = "DELETING"
    TOMBSTONED = "TOMBSTONED"


__all__ = ["MangaDeletionStatus", "MangaVisibilityStatus"]
