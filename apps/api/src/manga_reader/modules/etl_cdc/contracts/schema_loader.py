"""Loader and version registry for `manga-reader-package` JSON Schema contracts."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from manga_reader.common.errors import ContractVersionUnsupportedError
from manga_reader.config.settings import REPO_ROOT

CONTRACT_NAME = "manga-reader-package"
SUPPORTED_CONTRACT_VERSIONS: frozenset[str] = frozenset({"2.0"})
CONTRACT_V2_SCHEMA_ID = "urn:manga-datalake:contract:manga-reader-package:2.0"

SCHEMAS_DIR = REPO_ROOT / "packages" / "contracts" / "schemas"
CONTRACT_V2_SCHEMA_PATH = SCHEMAS_DIR / "manga-reader-package.v2.0.schema.json"


def resolve_schema_path(contract_name: str, contract_version: str) -> Path:
    """Resolve pinned JSON Schema file for a supported contract name/version."""
    if contract_name != CONTRACT_NAME or contract_version not in SUPPORTED_CONTRACT_VERSIONS:
        raise ContractVersionUnsupportedError(
            f"Unsupported contract '{contract_name}:{contract_version}'. "
            f"Supported versions: {sorted(SUPPORTED_CONTRACT_VERSIONS)}.",
            details={
                "contract_name": contract_name,
                "contract_version": contract_version,
                "supported_versions": sorted(SUPPORTED_CONTRACT_VERSIONS),
            },
        )
    return CONTRACT_V2_SCHEMA_PATH


@lru_cache(maxsize=4)
def load_contract_v2_schema() -> dict[str, Any]:
    """Load and verify the pinned JSON Schema Draft 2020-12 file from disk."""
    raw = json.loads(CONTRACT_V2_SCHEMA_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("JSON Schema root must be an object.")
    if raw.get("$id") != CONTRACT_V2_SCHEMA_ID:
        raise ValueError(f"Unexpected schema $id: {raw.get('$id')!r}")
    Draft202012Validator.check_schema(raw)
    return raw


@lru_cache(maxsize=4)
def get_draft202012_validator() -> Draft202012Validator:
    """Compile and cache the Draft 2020-12 validator with format checking enabled."""
    schema = load_contract_v2_schema()
    return Draft202012Validator(schema=schema, format_checker=FormatChecker())
