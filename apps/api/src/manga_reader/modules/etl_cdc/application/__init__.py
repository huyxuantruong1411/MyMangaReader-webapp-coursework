"""ETL and CDC application interfaces."""

from manga_reader.modules.etl_cdc.application.pipeline import (
    ExternalSourceProvider,
    ReadyPackageSummary,
)

__all__ = ["ExternalSourceProvider", "ReadyPackageSummary"]
