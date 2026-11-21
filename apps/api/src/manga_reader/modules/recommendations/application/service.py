"""Phase 10: Three-Method Recommendation Engine (Item-Based CF, Anonymized User-Based CF, Content-Based)."""

from __future__ import annotations

import json
import math
from typing import Any
from uuid import UUID

from sqlalchemy import false, select
from sqlalchemy.ext.asyncio import AsyncSession

from manga_reader.common.errors import ResourceNotFoundError, ValidationAppError
from manga_reader.common.security import SecurityPrincipal
from manga_reader.infrastructure.container import AppContainer
from manga_reader.infrastructure.orm import (
    ChapterModel,
    ListItemModel,
    MangaContentVectorModel,
    MangaCreatorModel,
    MangaModel,
    MangaTagModel,
    RatingModel,
    ReadingHistoryModel,
    ReadingListModel,
    ReadingStatusRecordModel,
    TagModel,
)
from manga_reader.modules.catalog_discovery.application.service import CatalogDiscoveryService
from manga_reader.modules.etl_cdc.application.service import compute_content_feature_vector


def _cosine_sparse(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
    if not vec_a or not vec_b:
        return 0.0
    if len(vec_a) > len(vec_b):
        vec_a, vec_b = vec_b, vec_a
    dot = sum(val * vec_b[k] for k, val in vec_a.items() if k in vec_b)
    if dot <= 0:
        return 0.0
    norm_a = math.sqrt(sum(v * v for v in vec_a.values()))
    norm_b = math.sqrt(sum(v * v for v in vec_b.values()))
    return dot / (norm_a * norm_b) if norm_a > 0 and norm_b > 0 else 0.0


class RecommendationService:
    """Application service for Module 11 (`recommendations`, `UC-3.7`..`UC-3.9`)."""

    def __init__(self, container: AppContainer) -> None:
        self._container = container
        self._catalog = CatalogDiscoveryService(container)

    async def _load_public_mangas(
        self,
        session: AsyncSession,
        *,
        include_ids: set[UUID] | None = None,
        limit: int = 300,
    ) -> dict[UUID, MangaModel]:
        top_ids = list(
            (
                await session.scalars(
                    select(MangaModel.manga_id)
                    .where(
                        MangaModel.visibility_status == "PUBLIC",
                        MangaModel.deletion_status == "ACTIVE",
                    )
                    .order_by(MangaModel.total_views.desc(), MangaModel.manga_id.asc())
                    .limit(limit)
                )
            ).all()
        )
        all_ids = list(top_ids)
        if include_ids:
            seen_ids = set(top_ids)
            for mid in include_ids:
                if mid not in seen_ids:
                    all_ids.append(mid)
                    seen_ids.add(mid)

        result_map: dict[UUID, MangaModel] = {}
        for start in range(0, len(all_ids), 200):
            chunk = all_ids[start : start + 200]
            rows = (
                await session.scalars(
                    select(MangaModel).where(
                        MangaModel.manga_id.in_(chunk),
                        MangaModel.visibility_status == "PUBLIC",
                        MangaModel.deletion_status == "ACTIVE",
                    )
                )
            ).all()
            for m in rows:
                result_map[m.manga_id] = m
        return result_map

    async def _popular_fallback(
        self,
        session: AsyncSession,
        *,
        public_map: dict[UUID, MangaModel],
        exclude_ids: set[UUID],
        limit: int,
    ) -> list[dict[str, Any]]:
        candidates = [m for mid, m in public_map.items() if mid not in exclude_ids]
        candidates.sort(key=lambda m: (-float(m.average_rating), -m.total_views, str(m.manga_id)))
        return await self._catalog.build_manga_cards(session, candidates[:limit])

    async def _build_interaction_matrix(
        self, session: AsyncSession, public_ids: set[UUID]
    ) -> tuple[dict[UUID, dict[str, float]], dict[UUID, dict[str, float]]]:
        """Build sparse user->manga and manga->user interaction maps from read/list/rating signals."""
        user_vecs: dict[UUID, dict[str, float]] = {}
        item_vecs: dict[UUID, dict[str, float]] = {}
        pub_list = list(public_ids)
        if not pub_list:
            return user_vecs, item_vecs

        def _add_signal(uid: UUID, mid: UUID, weight: float) -> None:
            if mid not in public_ids:
                return
            u_key = str(uid)
            m_key = str(mid)
            user_vecs.setdefault(uid, {})[m_key] = user_vecs.get(uid, {}).get(m_key, 0.0) + weight
            item_vecs.setdefault(mid, {})[u_key] = item_vecs.get(mid, {}).get(u_key, 0.0) + weight

        for start in range(0, len(pub_list), 200):
            chunk = pub_list[start : start + 200]
            # 1. Reading history (chapter opens -> +1.0 per unique reader-manga)
            h_rows = (
                await session.execute(
                    select(ReadingHistoryModel.reader_account_id, ChapterModel.manga_id)
                    .join(ChapterModel, ChapterModel.chapter_id == ReadingHistoryModel.chapter_id)
                    .where(ChapterModel.manga_id.in_(chunk))
                    .distinct()
                )
            ).all()
            for uid, mid in h_rows:
                _add_signal(uid, mid, 1.0)

            # 2. Reading list additions (+2.0)
            l_rows = (
                await session.execute(
                    select(ReadingListModel.owner_reader_account_id, ListItemModel.manga_id)
                    .join(ReadingListModel, ReadingListModel.list_id == ListItemModel.list_id)
                    .where(ListItemModel.manga_id.in_(chunk))
                    .distinct()
                )
            ).all()
            for uid, mid in l_rows:
                _add_signal(uid, mid, 2.0)

            # 3. Active ratings (scaled 0.5..5.0)
            r_rows = (
                await session.scalars(
                    select(RatingModel).where(
                        RatingModel.manga_id.in_(chunk),
                        RatingModel.is_removed == false(),
                    )
                )
            ).all()
            for r in r_rows:
                _add_signal(r.reader_account_id, r.manga_id, float(r.score) / 2.0)

        return user_vecs, item_vecs

    async def recommend_content_based(
        self,
        session: AsyncSession,
        *,
        manga_id: UUID,
        limit: int = 8,
        _public_map: dict[UUID, MangaModel] | None = None,
    ) -> dict[str, Any]:
        """UC-3.9 Content-Based cosine similarity over `manga_content_vectors` with fallback."""
        public_map = (
            _public_map
            if _public_map is not None
            else await self._load_public_mangas(session, include_ids={manga_id})
        )
        if manga_id not in public_map:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        vec_rows: list[MangaContentVectorModel] = []
        pub_keys = list(public_map.keys())
        for start in range(0, len(pub_keys), 200):
            chunk = pub_keys[start : start + 200]
            vec_rows.extend(
                (
                    await session.scalars(
                        select(MangaContentVectorModel).where(
                            MangaContentVectorModel.manga_id.in_(chunk)
                        )
                    )
                ).all()
            )
        vectors = {vr.manga_id: json.loads(vr.feature_vector_json) for vr in vec_rows}
        source_vec = vectors.get(manga_id)
        if not source_vec:
            source_manga = public_map[manga_id]
            src_tags = list(
                (
                    await session.scalars(
                        select(TagModel.slug)
                        .join(MangaTagModel, MangaTagModel.tag_id == TagModel.tag_id)
                        .where(MangaTagModel.manga_id == manga_id)
                    )
                ).all()
            )
            src_creators = list(
                (
                    await session.scalars(
                        select(MangaCreatorModel.creator_id).where(
                            MangaCreatorModel.manga_id == manga_id
                        )
                    )
                ).all()
            )
            source_vec = compute_content_feature_vector(
                tag_slugs=src_tags,
                creator_ids=src_creators,
                demographic=source_manga.publication_demographic,
                title=source_manga.title,
                description=source_manga.description,
            )

        if source_vec:
            scored: list[tuple[float, MangaModel]] = []
            for mid, cand_vec in vectors.items():
                if mid == manga_id or mid not in public_map:
                    continue
                sim = _cosine_sparse(source_vec, cand_vec)
                if sim > 0.05:
                    scored.append((sim, public_map[mid]))
            if scored:
                scored.sort(
                    key=lambda pair: (
                        -pair[0],
                        -float(pair[1].average_rating),
                        str(pair[1].manga_id),
                    )
                )
                top = [m for _, m in scored[:limit]]
                cards = await self._catalog.build_manga_cards(session, top)
                for idx, card in enumerate(cards):
                    card["similarityScore"] = round(scored[idx][0], 4)
                return {
                    "method": "CONTENT_BASED",
                    "modelVersion": "tfidf-v1",
                    "fallbackReason": None,
                    "items": cards,
                }

        cards = await self._popular_fallback(
            session, public_map=public_map, exclude_ids={manga_id}, limit=limit
        )
        return {
            "method": "POPULAR_FALLBACK",
            "modelVersion": "tfidf-v1",
            "fallbackReason": "LOW_CONTENT_SIMILARITY",
            "items": cards,
        }

    async def recommend_item_based(
        self, session: AsyncSession, *, manga_id: UUID, limit: int = 8
    ) -> dict[str, Any]:
        """UC-3.7 Item-Based Collaborative Filtering with Content-Based & Popular fallback."""
        public_map = await self._load_public_mangas(session, include_ids={manga_id})
        if manga_id not in public_map:
            raise ResourceNotFoundError("Manga not found.", error_code="MANGA_NOT_FOUND")

        _user_vecs, item_vecs = await self._build_interaction_matrix(
            session, set(public_map.keys())
        )
        source_item_vec = item_vecs.get(manga_id)

        if source_item_vec:
            scored: list[tuple[float, MangaModel]] = []
            for mid, cand_vec in item_vecs.items():
                if mid == manga_id or mid not in public_map:
                    continue
                sim = _cosine_sparse(source_item_vec, cand_vec)
                if sim > 0.0:
                    scored.append((sim, public_map[mid]))
            if scored:
                scored.sort(
                    key=lambda pair: (-pair[0], -pair[1].total_views, str(pair[1].manga_id))
                )
                top = [m for _, m in scored[:limit]]
                cards = await self._catalog.build_manga_cards(session, top)
                for idx, card in enumerate(cards):
                    card["similarityScore"] = round(scored[idx][0], 4)
                return {
                    "method": "ITEM_BASED",
                    "modelVersion": "item-cf-v1",
                    "fallbackReason": None,
                    "items": cards,
                }

        # Sparse cold-start fallback -> Content-Based -> Popular (CAT-022)
        cb = await self.recommend_content_based(
            session, manga_id=manga_id, limit=limit, _public_map=public_map
        )
        cb["fallbackReason"] = "SPARSE_ITEM_INTERACTIONS"
        return cb

    async def recommend_user_based(
        self, session: AsyncSession, *, principal: SecurityPrincipal, limit: int = 8
    ) -> dict[str, Any]:
        """UC-3.8 Anonymized User-Based Collaborative Filtering (never leaks neighbor IDs)."""
        assert principal.account_id is not None
        public_map = await self._load_public_mangas(session)

        # Exclude COMPLETED / DROPPED / already-interacted manga (CAT-026)
        excluded_statuses = set(
            (
                await session.scalars(
                    select(ReadingStatusRecordModel.manga_id).where(
                        ReadingStatusRecordModel.reader_account_id == principal.account_id,
                        ReadingStatusRecordModel.status.in_(("COMPLETED", "DROPPED")),
                    )
                )
            ).all()
        )
        user_vecs, _item_vecs = await self._build_interaction_matrix(
            session, set(public_map.keys())
        )
        my_vec = user_vecs.get(principal.account_id, {})
        already_read = {UUID(mid) for mid in my_vec}
        exclude_ids = excluded_statuses | already_read

        if my_vec:
            candidate_scores: dict[UUID, float] = {}
            for other_uid, other_vec in user_vecs.items():
                if other_uid == principal.account_id:
                    continue
                sim = _cosine_sparse(my_vec, other_vec)
                if sim <= 0:
                    continue
                for mid_str, weight in other_vec.items():
                    mid = UUID(mid_str)
                    if mid in exclude_ids or mid not in public_map:
                        continue
                    candidate_scores[mid] = candidate_scores.get(mid, 0.0) + (sim * weight)

            if candidate_scores:
                ranked = sorted(
                    candidate_scores.items(),
                    key=lambda kv: (-kv[1], -float(public_map[kv[0]].average_rating)),
                )[:limit]
                cards = await self._catalog.build_manga_cards(
                    session, [public_map[mid] for mid, _ in ranked]
                )
                for idx, card in enumerate(cards):
                    card["recommendationScore"] = round(ranked[idx][1], 4)
                return {
                    "method": "USER_BASED",
                    "modelVersion": "user-cf-anon-v1",
                    "fallbackReason": None,
                    "items": cards,
                }

        cards = await self._popular_fallback(
            session, public_map=public_map, exclude_ids=exclude_ids, limit=limit
        )
        return {
            "method": "POPULAR_FALLBACK",
            "modelVersion": "user-cf-anon-v1",
            "fallbackReason": "NEW_OR_SPARSE_READER_PROFILE",
            "items": cards,
        }

    async def recommend_for_manga(
        self, session: AsyncSession, *, manga_id: UUID, rec_type: str, limit: int = 8
    ) -> dict[str, Any]:
        kind = rec_type.upper()
        if kind == "ITEM_BASED":
            return await self.recommend_item_based(session, manga_id=manga_id, limit=limit)
        if kind == "CONTENT_BASED":
            return await self.recommend_content_based(session, manga_id=manga_id, limit=limit)
        raise ValidationAppError("type must be ITEM_BASED or CONTENT_BASED.")
