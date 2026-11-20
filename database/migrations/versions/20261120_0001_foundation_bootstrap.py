"""Foundation bootstrap revision validating Alembic migration infrastructure.

Does NOT prematurely mutate existing Lab10 / QL_DocTruyen business tables before
Phase 1 schema reconciliation decisions (M-001..M-011) are executed.

Revision ID: 0001_foundation_bootstrap
Revises:
Create Date: 2026-11-20 00:00:00+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_foundation_bootstrap"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create non-intrusive schema metadata marker table for operational verification."""
    op.create_table(
        "schema_foundation_metadata",
        sa.Column("metadata_key", sa.String(length=100), nullable=False),
        sa.Column("metadata_value", sa.String(length=500), nullable=False),
        sa.Column("recorded_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("metadata_key", name="PK_schema_foundation_metadata"),
    )


def downgrade() -> None:
    op.drop_table("schema_foundation_metadata")
