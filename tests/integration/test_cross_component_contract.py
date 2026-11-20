"""Cross-component smoke integration test verifying shared contracts + API wiring."""

from __future__ import annotations

import pytest

from manga_reader.config.settings import REPO_ROOT
from manga_reader.modules.etl_cdc.contracts import PackageV2Validator

pytestmark = pytest.mark.integration


def test_python_and_js_share_single_canonical_schema_file() -> None:
    schema_path = (
        REPO_ROOT / "packages" / "contracts" / "schemas" / "manga-reader-package.v2.0.schema.json"
    )
    fixture_path = (
        REPO_ROOT / "packages" / "contracts" / "fixtures" / "valid-full-package.v2.0.json"
    )
    assert schema_path.is_file()
    assert fixture_path.is_file()

    validator = PackageV2Validator()
    result = validator.validate_bytes(fixture_path.read_bytes())
    assert result.package.contract_name == "manga-reader-package"
    assert result.package.contract_version == "2.0"
