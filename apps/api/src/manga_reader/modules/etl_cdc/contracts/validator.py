"""Strict ingress validator for `manga-reader-package:2.0` (`05_PACKAGE_V2_ETL_CDC.md` §3).

Performs:
1. Raw byte size cap + raw transport SHA-256 computation before JSON parsing
2. Strict JSON decoding (rejects NaN/Infinity and malformed UTF-8)
3. Pinned contract_name/contract_version rejection (`ContractVersionUnsupportedError`)
4. JSON Schema Draft 2020-12 validation (`additionalProperties: false`, format checks)
5. Cross-object semantic invariants (pool_manga_id match, contiguous 1..N pages,
   page_count consistency, safe MediaObjectRef bucket/object_key, safe link URLs)
6. Immutable typed DTO construction preserving `is_metadata_only` semantics (ADR-012)
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from typing import Any

from manga_reader.common.errors import (
    ContractValidationError,
    PayloadTooLargeError,
    ValidationAppError,
)
from manga_reader.common.identities import MediaObjectRef
from manga_reader.common.security import validate_external_url
from manga_reader.modules.etl_cdc.contracts.dto import (
    MangaReaderPackageV2Dto,
    ReaderMediaRefDto,
)
from manga_reader.modules.etl_cdc.contracts.schema_loader import (
    CONTRACT_NAME,
    get_draft202012_validator,
    resolve_schema_path,
)


@dataclass(frozen=True, slots=True)
class ValidatedPackageEnvelope:
    """Immutable validated package result carrying raw transport checksum & typed DTO."""

    payload_sha256: str
    raw_size_bytes: int
    package: MangaReaderPackageV2Dto
    is_metadata_only: bool


def _reject_non_finite_constant(constant: str) -> Any:
    raise ValueError(f"Non-finite JSON numeric constant is forbidden: {constant}")


def _validate_media_dto(media: ReaderMediaRefDto, path: str, issues: list[dict[str, str]]) -> None:
    try:
        MediaObjectRef(bucket=media.bucket, object_key=media.object_key)
    except ValueError as exc:
        issues.append({"code": "UNSAFE_MEDIA_REFERENCE", "path": path, "message": str(exc)})


class PackageV2Validator:
    """Draft 2020-12 + semantic validator for `manga-reader-package:2.0`."""

    def __init__(self, *, max_package_bytes: int = 52_428_800) -> None:
        self._max_package_bytes = max_package_bytes
        self._schema_validator = get_draft202012_validator()

    def validate_bytes(self, raw_bytes: bytes) -> ValidatedPackageEnvelope:
        """Validate raw UTF-8 JSON package bytes before opening a DB transaction."""
        size = len(raw_bytes)
        if size > self._max_package_bytes:
            raise PayloadTooLargeError(
                f"Package size ({size} bytes) exceeds limit ({self._max_package_bytes} bytes).",
                details={"size_bytes": size, "max_bytes": self._max_package_bytes},
            )
        payload_sha256 = hashlib.sha256(raw_bytes).hexdigest()
        try:
            decoded_text = raw_bytes.decode("utf-8")
            parsed = json.loads(decoded_text, parse_constant=_reject_non_finite_constant)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise ContractValidationError(
                "Malformed UTF-8 JSON payload.",
                details={"reason": str(exc)},
            ) from exc

        dto = self.validate_dict(parsed)
        return ValidatedPackageEnvelope(
            payload_sha256=payload_sha256,
            raw_size_bytes=size,
            package=dto,
            is_metadata_only=dto.is_metadata_only,
        )

    def validate_dict(self, payload: Any) -> MangaReaderPackageV2Dto:
        """Validate parsed Python object against schema v2.0 and domain semantics."""
        if not isinstance(payload, dict):
            raise ContractValidationError("Package root must be a JSON object.")

        # 1. Fail-closed contract name & version pinning before full schema pass
        raw_name = payload.get("contract_name", CONTRACT_NAME)
        raw_version = payload.get("contract_version", "2.0")
        resolve_schema_path(str(raw_name), str(raw_version))

        # 2. Exact JSON Schema Draft 2020-12 validation
        schema_errors = sorted(
            self._schema_validator.iter_errors(payload),
            key=lambda e: list(e.absolute_path),
        )
        if schema_errors:
            schema_issues = [
                {
                    "code": "SCHEMA_VIOLATION",
                    "path": "/" + "/".join(str(p) for p in err.absolute_path),
                    "message": err.message,
                }
                for err in schema_errors
            ]
            raise ContractValidationError(
                f"Package failed JSON Schema Draft 2020-12 validation "
                f"({len(schema_issues)} error(s)).",
                details={"issues": schema_issues},
            )

        # 3. Parse into strict immutable DTOs
        dto = MangaReaderPackageV2Dto.model_validate(payload)

        # 4. Cross-object semantic integrity checks
        issues: list[dict[str, str]] = []
        if dto.manga.primary_cover is not None:
            _validate_media_dto(dto.manga.primary_cover, "/manga/primary_cover", issues)
        for idx, cover in enumerate(dto.manga.cover_arts):
            _validate_media_dto(cover.media, f"/manga/cover_arts/{idx}/media", issues)
        for idx, link in enumerate(dto.manga.links):
            try:
                validate_external_url(link.url)
            except ValidationAppError as exc:
                issues.append(
                    {
                        "code": "UNSAFE_LINK_SCHEME",
                        "path": f"/manga/links/{idx}/url",
                        "message": exc.message,
                    }
                )

        if dto.chapters is not None:
            seen_chapter_ids: set[str] = set()
            for c_idx, chapter in enumerate(dto.chapters):
                if not math.isfinite(chapter.chapter_numeric):
                    issues.append(
                        {
                            "code": "INVALID_CHAPTER_NUMERIC",
                            "path": f"/chapters/{c_idx}/chapter_numeric",
                            "message": "chapter_numeric must be finite.",
                        }
                    )
                if chapter.pool_manga_id != dto.manga.pool_manga_id:
                    issues.append(
                        {
                            "code": "CHAPTER_MANGA_MISMATCH",
                            "path": f"/chapters/{c_idx}/pool_manga_id",
                            "message": (
                                f"Chapter '{chapter.pool_chapter_id}' belongs to "
                                f"'{chapter.pool_manga_id}', expected '{dto.manga.pool_manga_id}'."
                            ),
                        }
                    )
                if chapter.pool_chapter_id in seen_chapter_ids:
                    issues.append(
                        {
                            "code": "DUPLICATE_CHAPTER_ID",
                            "path": f"/chapters/{c_idx}/pool_chapter_id",
                            "message": f"Duplicate pool_chapter_id '{chapter.pool_chapter_id}'.",
                        }
                    )
                seen_chapter_ids.add(chapter.pool_chapter_id)

                if chapter.page_count != len(chapter.pages):
                    issues.append(
                        {
                            "code": "PAGE_COUNT_MISMATCH",
                            "path": f"/chapters/{c_idx}/page_count",
                            "message": (
                                f"Chapter '{chapter.pool_chapter_id}' page_count="
                                f"{chapter.page_count} != len(pages)={len(chapter.pages)}."
                            ),
                        }
                    )

                expected_numbers = list(range(1, len(chapter.pages) + 1))
                actual_numbers = sorted(page.page_number for page in chapter.pages)
                if actual_numbers != expected_numbers:
                    issues.append(
                        {
                            "code": "NONCONTIGUOUS_PAGE_NUMBERS",
                            "path": f"/chapters/{c_idx}/pages",
                            "message": (
                                f"Chapter '{chapter.pool_chapter_id}' page_number sequence must "
                                f"be contiguous 1..{len(chapter.pages)}."
                            ),
                        }
                    )

                seen_page_uids: set[str] = set()
                for p_idx, page in enumerate(chapter.pages):
                    if page.page_uid in seen_page_uids:
                        issues.append(
                            {
                                "code": "DUPLICATE_PAGE_UID",
                                "path": f"/chapters/{c_idx}/pages/{p_idx}/page_uid",
                                "message": f"Duplicate page_uid '{page.page_uid}'.",
                            }
                        )
                    seen_page_uids.add(page.page_uid)
                    _validate_media_dto(
                        page.media,
                        f"/chapters/{c_idx}/pages/{p_idx}/media",
                        issues,
                    )

        if issues:
            raise ContractValidationError(
                f"Package failed semantic validation ({len(issues)} issue(s)).",
                details={"issues": issues},
            )

        return dto
