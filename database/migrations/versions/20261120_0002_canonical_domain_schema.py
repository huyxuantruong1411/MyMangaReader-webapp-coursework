"""Create canonical Lab10 + ADR M-001..M-011 domain schema (47 tables).

Revision ID: 0002_canonical_domain_schema
Revises: 0001_foundation_bootstrap
Create Date: 2026-11-20 12:15:00+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import context, op
from sqlalchemy.schema import CreateIndex, CreateTable, DropTable

from manga_reader.infrastructure import orm as _orm  # noqa: F401
from manga_reader.infrastructure.database import Base

revision: str = "0002_canonical_domain_schema"
down_revision: str | None = "0001_foundation_bootstrap"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if context.is_offline_mode():
        for table in Base.metadata.sorted_tables:
            op.execute(CreateTable(table))
            for index in sorted(table.indexes, key=lambda idx: idx.name or ""):
                op.execute(CreateIndex(index))
    else:
        bind = op.get_bind()
        Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    if context.is_offline_mode():
        for table in reversed(Base.metadata.sorted_tables):
            op.execute(DropTable(table))
    else:
        bind = op.get_bind()
        Base.metadata.drop_all(bind=bind, checkfirst=True)
