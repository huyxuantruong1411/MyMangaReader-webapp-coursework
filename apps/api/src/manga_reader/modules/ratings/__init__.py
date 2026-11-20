"""Module 7: Rating Management (`UC-4.7`, `UC-4.8`).

Owns: `ratings` (single current rating per reader/manga, score 1..10) and
append-only `rating_histories` (`CREATE`, `UPDATE`, `REMOVE`).
Requires at least one persisted chapter-open history row before rating (ADR-010).
"""

from enum import StrEnum

RATING_MIN_SCORE = 1
RATING_MAX_SCORE = 10


class RatingHistoryAction(StrEnum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    REMOVE = "REMOVE"


__all__ = ["RATING_MAX_SCORE", "RATING_MIN_SCORE", "RatingHistoryAction"]
