"""Every table, defined once with SQLAlchemy Core (no ORM). Alembic migrates from these definitions.

A Workspace table carries ``workspace_id`` and is protected by row-level security: a
transaction sees and writes only the rows of the Workspace it is bound to. Each record carries
its own ``version`` for optimistic concurrency (ADR-0009).
"""
from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
)

metadata = MetaData(
    naming_convention={
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    }
)

workspaces = Table(
    "workspaces",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("name", Text, nullable=False),
    Column("version", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

products = Table(
    "products",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    Column("key", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("version", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("workspace_id", "key"),
)
