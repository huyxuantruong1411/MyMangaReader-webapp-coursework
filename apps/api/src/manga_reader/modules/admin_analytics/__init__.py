"""Module 12: Admin Analytics and Activity Logs (`UC-1.4`, `UC-1.5`, `UC-2.5`).

Owns: Immutable `activity_logs` persistence/query, Reader behavior statistics,
Manga interaction statistics, and periodic counter reconciliation jobs.
"""

from manga_reader.common.audit import AuditEvent, AuditLogWriter

__all__ = ["AuditEvent", "AuditLogWriter"]
