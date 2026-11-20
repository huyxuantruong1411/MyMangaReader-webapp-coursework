"""Module 3: Catalog and Discovery (`UC-3.1..3.6`).

Owns: Public catalogue read models, advanced tag/metadata filtering, autocomplete,
full-text/fuzzy title & creator search, and Creator detail views.
Canonical invariants:
- Central `visibility_status = PUBLIC` predicate enforced at query layer.
- `content_rating = unknown` is NEVER treated as safe.
"""

from enum import StrEnum


class CatalogSortOption(StrEnum):
    UPDATED_DESC = "UPDATED_DESC"
    VIEWS_DESC = "VIEWS_DESC"
    RATING_DESC = "RATING_DESC"
    TITLE_ASC = "TITLE_ASC"


__all__ = ["CatalogSortOption"]
