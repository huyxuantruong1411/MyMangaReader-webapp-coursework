"""Module 9: Moderation and Reporting (`UC-1.6`, `UC-1.7`, `UC-4.9`, `UC-5.7`, `UC-6.6`).

Owns: `reports`, `account_reports`, `manga_reports`, `comment_reports`,
and `report_action_histories`.
Canonical invariants:
- Report snapshots survive deletion of the target entity.
- Four canonical statuses: `PENDING`, `RESOLVED`, `IGNORED`, `CLOSED` (ADR-005).
- `mangas.ignore_all_reports` is the single source of truth for future report suppression (ADR-006).
"""

from enum import StrEnum


class ReportType(StrEnum):
    ACCOUNT = "ACCOUNT"
    MANGA = "MANGA"
    COMMENT = "COMMENT"


class ReportStatus(StrEnum):
    PENDING = "PENDING"
    RESOLVED = "RESOLVED"
    IGNORED = "IGNORED"
    CLOSED = "CLOSED"


__all__ = ["ReportStatus", "ReportType"]
