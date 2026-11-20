"""Unit & contract tests for `manga-reader-package:2.0` validation and identity mapping."""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pytest

from manga_reader.common.errors import (
    ContractValidationError,
    ContractVersionUnsupportedError,
    PayloadTooLargeError,
)
from manga_reader.common.identities import MangaId, PoolMangaId
from manga_reader.config.settings import REPO_ROOT
from manga_reader.modules.etl_cdc.contracts import (
    CONTRACT_V2_SCHEMA_ID,
    ContentRating,
    EphemeralIdentityResolver,
    PackageV2Validator,
    load_contract_v2_schema,
    map_package_to_import_plan,
)

pytestmark = [pytest.mark.unit, pytest.mark.contract]

FIXTURES_DIR = REPO_ROOT / "packages" / "contracts" / "fixtures"


def _read_fixture(filename: str) -> bytes:
    path: Path = FIXTURES_DIR / filename
    return path.read_bytes()


def test_json_schema_v2_loads_and_matches_pinned_id() -> None:
    schema = load_contract_v2_schema()
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["$id"] == CONTRACT_V2_SCHEMA_ID


def test_valid_full_package_validates_and_maps_identities() -> None:
    validator = PackageV2Validator()
    raw = _read_fixture("valid-full-package.v2.0.json")
    envelope = validator.validate_bytes(raw)

    assert len(envelope.payload_sha256) == 64
    assert envelope.is_metadata_only is False
    assert envelope.package.manga.pool_manga_id == "pm_01j9examplemanga000001"

    # External -> Internal mapping preserves separation and deduplicates dual-role creator (ADR-017)
    existing_internal_id = MangaId(uuid4())
    resolver = EphemeralIdentityResolver(
        existing_mangas={PoolMangaId("pm_01j9examplemanga000001"): existing_internal_id}
    )
    plan = map_package_to_import_plan(envelope.package, resolver=resolver)

    assert plan.manga_id == existing_internal_id
    assert plan.is_new_manga is False
    assert str(plan.manga_id) != str(plan.pool_manga_id)
    assert len(plan.creators) == 1
    assert len(plan.creator_credits) == 2
    assert plan.creators[0].biographies_by_locale["ja"].startswith("ファンタジー")
    assert plan.tags[0].names_by_locale["vi"] == "Hành động"
    assert plan.chapters is not None
    assert [ch.chapter_number for ch in plan.chapters] == ["Prologue", "1"]


def test_metadata_only_package_preserves_none_chapters_and_unknown_not_safe() -> None:
    validator = PackageV2Validator()
    envelope = validator.validate_bytes(_read_fixture("valid-metadata-only-package.v2.0.json"))

    assert envelope.is_metadata_only is True
    assert envelope.package.chapters is None
    assert envelope.package.manga.content_rating == ContentRating.UNKNOWN
    assert envelope.package.manga.content_rating.is_safe is False

    plan = map_package_to_import_plan(envelope.package, resolver=EphemeralIdentityResolver())
    assert plan.is_new_manga is True
    assert plan.chapters is None  # ADR-012: must NOT delete existing chapters


def test_rejects_unsupported_contract_version() -> None:
    validator = PackageV2Validator()
    with pytest.raises(ContractVersionUnsupportedError) as exc_info:
        validator.validate_bytes(_read_fixture("invalid-unsupported-version.json"))
    assert exc_info.value.error_code == "CONTRACT_VERSION_UNSUPPORTED"


def test_rejects_extra_nested_property_under_closed_contract() -> None:
    validator = PackageV2Validator()
    with pytest.raises(ContractValidationError) as exc_info:
        validator.validate_bytes(_read_fixture("invalid-extra-nested-property.json"))
    assert exc_info.value.error_code == "CONTRACT_VALIDATION_FAILED"


def test_rejects_noncontiguous_pages() -> None:
    validator = PackageV2Validator()
    with pytest.raises(ContractValidationError) as exc_info:
        validator.validate_bytes(_read_fixture("invalid-noncontiguous-pages.json"))
    issues = exc_info.value.details.get("issues", [])
    assert any(issue["code"] == "NONCONTIGUOUS_PAGE_NUMBERS" for issue in issues)


def test_rejects_chapter_pool_manga_mismatch_and_oversized_payload() -> None:
    validator = PackageV2Validator(max_package_bytes=1024)
    raw = _read_fixture("valid-full-package.v2.0.json")
    with pytest.raises(PayloadTooLargeError):
        validator.validate_bytes(raw)

    full_validator = PackageV2Validator()
    tampered = json.loads(raw.decode("utf-8"))
    tampered["chapters"][0]["pool_manga_id"] = "pm_some_other_manga"
    with pytest.raises(ContractValidationError) as exc_info:
        full_validator.validate_dict(tampered)
    issues = exc_info.value.details.get("issues", [])
    assert any(issue["code"] == "CHAPTER_MANGA_MISMATCH" for issue in issues)
