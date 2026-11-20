"""Module 10: Reading Lists (`UC-7.1..7.6`, `UC-8.1..8.5`).

Owns: `reading_lists` and `list_items`.
Canonical invariants:
- Lists are private and owner-only in MVP (ADR-009).
- `reading_lists.item_count` tracks membership rows; visible `PUBLIC` count is separate (ADR-014).
"""

from enum import StrEnum


class ReadingListVisibility(StrEnum):
    """Canonical MVP enforces PRIVATE only until public sharing ADR is approved."""

    PRIVATE = "PRIVATE"


__all__ = ["ReadingListVisibility"]
