"""ETL & CDC pipeline interfaces preparing Phase 3-4 ingestion without premature worker logic."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from manga_reader.common.identities import PoolMangaId, SourceMangaId


@dataclass(frozen=True, slots=True)
class ReadyPackageSummary:
    source_manga_id: SourceMangaId
    pool_manga_id: PoolMangaId
    title: str
    contract_name: str
    contract_version: str


class ExternalSourceProvider(Protocol):
    """Port for communicating with the upstream External Manga Service (UC-2.3)."""

    async def list_ready_packages(self) -> list[ReadyPackageSummary]: ...
    async def fetch_package_bytes(self, pool_manga_id: PoolMangaId) -> bytes: ...
    async def register_cdc_subscription(self, pool_manga_id: PoolMangaId) -> str: ...
    async def cancel_cdc_subscription(self, provider_subscription_key: str) -> None: ...
