"""Mock external provider adapters for isolated testing (`11_TEST_STRATEGY_ACCEPTANCE.md`)."""

from __future__ import annotations

from manga_reader.common.identities import PoolMangaId, SourceMangaId
from manga_reader.modules.etl_cdc.application.pipeline import ReadyPackageSummary


class MockExternalMangaSourceProvider:
    """Deterministic in-memory stand-in for the upstream External Manga Service."""

    def __init__(self, packages: dict[PoolMangaId, bytes] | None = None) -> None:
        self._packages: dict[PoolMangaId, bytes] = packages or {}
        self.subscriptions: dict[str, PoolMangaId] = {}

    async def list_ready_packages(self) -> list[ReadyPackageSummary]:
        return [
            ReadyPackageSummary(
                source_manga_id=SourceMangaId(f"src_{pool_id}"),
                pool_manga_id=pool_id,
                title=f"Mock Manga {pool_id}",
                contract_name="manga-reader-package",
                contract_version="2.0",
            )
            for pool_id in sorted(self._packages.keys())
        ]

    async def fetch_package_bytes(self, pool_manga_id: PoolMangaId) -> bytes:
        return self._packages[pool_manga_id]

    async def register_cdc_subscription(self, pool_manga_id: PoolMangaId) -> str:
        key = f"sub_{pool_manga_id}"
        self.subscriptions[key] = pool_manga_id
        return key

    async def cancel_cdc_subscription(self, provider_subscription_key: str) -> None:
        self.subscriptions.pop(provider_subscription_key, None)
