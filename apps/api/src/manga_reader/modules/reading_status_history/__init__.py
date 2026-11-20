"""Module 6: Reading Status and History (`UC-3.10`, `UC-3.11`).

Owns: `reading_status_records` (1 current state per reader/manga), `reading_histories`
(append-only chapter-open sessions + valid view qualification per ADR-016).
"""

from enum import StrEnum


class ReadingStatus(StrEnum):
    READING = "READING"
    PLAN_TO_READ = "PLAN_TO_READ"
    COMPLETED = "COMPLETED"
    ON_HOLD = "ON_HOLD"
    DROPPED = "DROPPED"


__all__ = ["ReadingStatus"]
