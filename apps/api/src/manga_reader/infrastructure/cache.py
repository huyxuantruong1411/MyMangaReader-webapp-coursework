"""Cache & rate-limiter abstractions (Memurai/Redis + dev InMemory fallback).

Used for:
- OTP challenges with 120s TTL and atomic single-use consumption (`ADR-004`, never SQL)
- Temporary login throttling (`ADR-003`, separate from Admin `accounts.status=LOCKED`)
- API rate limiting and short-lived catalog caching
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Protocol

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class AdapterHealth:
    healthy: bool
    backend: str
    mode: str
    detail: str


class CacheAdapter(Protocol):
    """Async key-value cache contract with TTL and atomic operations."""

    @property
    def backend_name(self) -> str: ...
    @property
    def adapter_mode(self) -> str: ...
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None: ...
    async def delete(self, key: str) -> bool: ...
    async def pop(self, key: str) -> str | None: ...
    async def increment(self, key: str, *, window_seconds: int) -> int: ...
    async def check_health(self) -> AdapterHealth: ...
    async def close(self) -> None: ...


class InMemoryCacheAdapter:
    """Single-process development/test cache adapter.

    Explicitly reports `mode='dev-fallback'` and is rejected in staging/production.
    """

    def __init__(self, *, key_prefix: str = "mreader:") -> None:
        self._prefix = key_prefix
        self._store: dict[str, tuple[str, float]] = {}
        self._lock = asyncio.Lock()

    @property
    def backend_name(self) -> str:
        return "memory"

    @property
    def adapter_mode(self) -> str:
        return "dev-fallback"

    def _prefixed(self, key: str) -> str:
        return f"{self._prefix}{key}"

    def _evict_if_expired(self, full_key: str) -> None:
        entry = self._store.get(full_key)
        if entry is not None and entry[1] <= time.monotonic():
            del self._store[full_key]

    async def get(self, key: str) -> str | None:
        full_key = self._prefixed(key)
        async with self._lock:
            self._evict_if_expired(full_key)
            entry = self._store.get(full_key)
            return entry[0] if entry is not None else None

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None:
        full_key = self._prefixed(key)
        expires_at = time.monotonic() + max(ttl_seconds, 1)
        async with self._lock:
            self._store[full_key] = (value, expires_at)

    async def delete(self, key: str) -> bool:
        full_key = self._prefixed(key)
        async with self._lock:
            return self._store.pop(full_key, None) is not None

    async def pop(self, key: str) -> str | None:
        """Atomic single-use read-and-delete (suitable for OTP challenge consumption)."""
        full_key = self._prefixed(key)
        async with self._lock:
            self._evict_if_expired(full_key)
            entry = self._store.pop(full_key, None)
            return entry[0] if entry is not None else None

    async def increment(self, key: str, *, window_seconds: int) -> int:
        full_key = self._prefixed(key)
        now = time.monotonic()
        async with self._lock:
            self._evict_if_expired(full_key)
            entry = self._store.get(full_key)
            if entry is None:
                self._store[full_key] = ("1", now + max(window_seconds, 1))
                return 1
            next_val = int(entry[0]) + 1
            self._store[full_key] = (str(next_val), entry[1])
            return next_val

    async def check_health(self) -> AdapterHealth:
        return AdapterHealth(
            healthy=True,
            backend=self.backend_name,
            mode=self.adapter_mode,
            detail="In-memory development cache active (not suitable for multi-instance prod).",
        )

    async def close(self) -> None:
        async with self._lock:
            self._store.clear()


class RedisCacheAdapter:
    """Shared Redis / Memurai cache adapter."""

    def __init__(self, redis_url: str, *, key_prefix: str = "mreader:") -> None:
        self._prefix = key_prefix
        self._client: Redis = Redis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )

    @property
    def backend_name(self) -> str:
        return "redis"

    @property
    def adapter_mode(self) -> str:
        return "configured"

    def _prefixed(self, key: str) -> str:
        return f"{self._prefix}{key}"

    async def get(self, key: str) -> str | None:
        val = await self._client.get(self._prefixed(key))
        return str(val) if val is not None else None

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None:
        await self._client.set(self._prefixed(key), value, ex=max(ttl_seconds, 1))

    async def delete(self, key: str) -> bool:
        deleted = await self._client.delete(self._prefixed(key))
        return bool(deleted)

    async def pop(self, key: str) -> str | None:
        val = await self._client.getdel(self._prefixed(key))
        return str(val) if val is not None else None

    async def increment(self, key: str, *, window_seconds: int) -> int:
        full_key = self._prefixed(key)
        count = int(await self._client.incr(full_key))
        if count == 1:
            await self._client.expire(full_key, max(window_seconds, 1))
        return count

    async def check_health(self) -> AdapterHealth:
        try:
            pong = await self._client.ping()
            return AdapterHealth(
                healthy=bool(pong),
                backend=self.backend_name,
                mode=self.adapter_mode,
                detail="Redis/Memurai PING succeeded.",
            )
        except Exception as exc:
            logger.warning(
                "Redis health check failed",
                extra={"error_type": type(exc).__name__},
            )
            return AdapterHealth(
                healthy=False,
                backend=self.backend_name,
                mode=self.adapter_mode,
                detail=f"Redis/Memurai unreachable ({type(exc).__name__}).",
            )

    async def close(self) -> None:
        await self._client.aclose()


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    current_count: int
    limit: int
    window_seconds: int


class CacheRateLimiter:
    """Fixed-window rate limiter backed by `CacheAdapter`."""

    def __init__(self, cache: CacheAdapter) -> None:
        self._cache = cache

    async def check(
        self, scope: str, subject: str, *, limit: int, window_seconds: int
    ) -> RateLimitResult:
        key = f"rl:{scope}:{subject}"
        count = await self._cache.increment(key, window_seconds=window_seconds)
        return RateLimitResult(
            allowed=count <= limit,
            current_count=count,
            limit=limit,
            window_seconds=window_seconds,
        )
