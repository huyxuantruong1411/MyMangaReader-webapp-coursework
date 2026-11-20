"""Module 4: ETL and CDC (UC-2.3, `manga-reader-package:2.0`)."""

from manga_reader.modules.etl_cdc.application import ExternalSourceProvider, ReadyPackageSummary
from manga_reader.modules.etl_cdc.contracts import (
    CONTRACT_NAME,
    CONTRACT_V2_SCHEMA_ID,
    MangaReaderPackageV2Dto,
    MappedMangaImportPlan,
    PackageV2Validator,
    load_contract_v2_schema,
    map_package_to_import_plan,
)

__all__ = [
    "CONTRACT_NAME",
    "CONTRACT_V2_SCHEMA_ID",
    "ExternalSourceProvider",
    "MangaReaderPackageV2Dto",
    "MappedMangaImportPlan",
    "PackageV2Validator",
    "ReadyPackageSummary",
    "load_contract_v2_schema",
    "map_package_to_import_plan",
]
