"""Module 1: Account and Authentication (`UC-1.1..1.3`, `UC-6.1..6.5`).

Owns: `accounts`, `readers`, `admins`, `user_sessions`, `account_status_histories`.
Canonical invariants:
- `LOCKED` is a business account state distinct from temporary cache login throttling (ADR-003).
- Locking revokes all active sessions (`revoke_reason = ACCOUNT_LOCK`) and records audit.
- OTP challenges live only in shared cache with 120s TTL (ADR-004), never SQL.
"""

from manga_reader.common.security import AccountRole, AccountStatus

__all__ = ["AccountRole", "AccountStatus"]
