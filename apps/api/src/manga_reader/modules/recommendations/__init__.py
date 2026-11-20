"""Module 11: Recommendation Engine (`UC-3.7`, `UC-3.8`, `UC-3.9`).

Owns: `manga_content_vectors` and offline similarity computations for three
distinct recommendation methods: ITEM_BASED, USER_BASED (anonymized), and
CONTENT_BASED, each enforcing `PUBLIC` visibility and deterministic fallbacks.
"""

from enum import StrEnum


class RecommendationMethod(StrEnum):
    ITEM_BASED = "ITEM_BASED"
    USER_BASED = "USER_BASED"
    CONTENT_BASED = "CONTENT_BASED"
    POPULAR_FALLBACK = "POPULAR_FALLBACK"


__all__ = ["RecommendationMethod"]
