"""Module 5: Reader Engine and Reading Progress (`UC-4.1..4.6`).

Owns: `reader_settings`, `reader_progress` (ADR-001 / M-001), page manifest delivery.
Canonical invariants:
- Exact page progress is stored in `reader_progress`, separate from `reading_histories`.
- Changing display mode preserves current page identity (`page_uid` / `page_number`).
- Media URLs are signed/resolved at runtime from `(bucket, object_key)` (ADR-018).
"""

from enum import StrEnum


class ReaderOpenAction(StrEnum):
    START = "START"
    CONTINUE = "CONTINUE"
    SELECT = "SELECT"


class DisplayMode(StrEnum):
    VERTICAL_WEBTOON = "VERTICAL_WEBTOON"
    SINGLE_PAGE = "SINGLE_PAGE"
    DOUBLE_PAGE = "DOUBLE_PAGE"


class ReadingDirection(StrEnum):
    LTR = "LTR"
    RTL = "RTL"


class FitMode(StrEnum):
    FIT_WIDTH = "FIT_WIDTH"
    FIT_HEIGHT = "FIT_HEIGHT"
    ORIGINAL = "ORIGINAL"


__all__ = ["DisplayMode", "FitMode", "ReaderOpenAction", "ReadingDirection"]
