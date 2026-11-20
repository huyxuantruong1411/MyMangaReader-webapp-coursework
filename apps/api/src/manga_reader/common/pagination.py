"""Pagination, filtering, and allowlist-safe sorting conventions."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from manga_reader.common.errors import ValidationAppError


class SortDirection(StrEnum):
    ASC = "ASC"
    DESC = "DESC"


@dataclass(frozen=True, slots=True)
class PaginationParams:
    """Validated pagination parameters bounded by configured limits (ADR-015)."""

    page: int
    page_size: int

    @classmethod
    def create(
        cls,
        *,
        page: int = 1,
        page_size: int | None = None,
        default_page_size: int = 24,
        max_page_size: int = 100,
    ) -> PaginationParams:
        resolved_size = default_page_size if page_size is None else page_size
        if page < 1:
            raise ValidationAppError(
                "Page number must be >= 1.",
                error_code="INVALID_PAGE",
                details={"field": "page"},
            )
        if resolved_size < 1 or resolved_size > max_page_size:
            raise ValidationAppError(
                f"pageSize must be between 1 and {max_page_size}.",
                error_code="INVALID_PAGE",
                details={"field": "pageSize", "max": max_page_size},
            )
        return cls(page=page, page_size=resolved_size)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


@dataclass(frozen=True, slots=True)
class SortSpec:
    """Allowlist-validated sort specification; never interpolated as raw SQL."""

    field: str
    direction: SortDirection = SortDirection.DESC

    @classmethod
    def from_allowlist(
        cls,
        raw_field: str,
        *,
        allowed_fields: frozenset[str],
        direction: SortDirection = SortDirection.DESC,
    ) -> SortSpec:
        if raw_field not in allowed_fields:
            raise ValidationAppError(
                f"Unsupported sort field '{raw_field}'.",
                error_code="INVALID_FILTER",
                details={"field": "sort", "allowed": sorted(allowed_fields)},
            )
        return cls(field=raw_field, direction=direction)
