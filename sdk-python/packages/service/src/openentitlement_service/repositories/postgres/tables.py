"""Every table, defined once with SQLAlchemy Core (no ORM). Alembic migrates from these definitions.

A Workspace table carries ``workspace_id`` and is protected by row-level security: a
transaction sees and writes only the rows of the Workspace it is bound to. Each record carries
its own ``version`` for optimistic concurrency (ADR-0009).
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    JSON,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    Table,
    Text,
    ForeignKeyConstraint,
    UniqueConstraint,
    Uuid,
)

metadata = MetaData(
    naming_convention={
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_N_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
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
    Column("archived_at", DateTime(timezone=True)),
    Column("version", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("workspace_id", "key"),
    # Lets a Product's Roles reference it together with its Workspace.
    UniqueConstraint("workspace_id", "id"),
)

# Accounts, sessions and sign-in flows belong to no Workspace: they have no row-level security.
accounts = Table(
    "accounts",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("issuer", Text, nullable=False),
    Column("subject", Text, nullable=False),
    Column("email", Text, nullable=False),
    Column("platform_admin", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("issuer", "subject"),
)

sessions = Table(
    "sessions",
    metadata,
    Column("token_hash", Text, primary_key=True),
    Column("account_id", Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("csrf", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)

sign_in_flows = Table(
    "sign_in_flows",
    metadata,
    Column("flow_hash", Text, primary_key=True),
    Column("state", Text, nullable=False),
    Column("nonce", Text, nullable=False),
    Column("verifier", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)

# A member's Workspace-wide membership; ``owner`` makes them Owner of every Product (ADR-0008).
members = Table(
    "members",
    metadata,
    Column("workspace_id", Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
    Column("account_id", Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True, index=True),
    Column("owner", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

# A member's Role in one Product.
product_roles = Table(
    "product_roles",
    metadata,
    Column("workspace_id", Uuid, nullable=False),
    Column("product_id", Uuid, primary_key=True),
    Column("account_id", Uuid, primary_key=True, index=True),
    Column("role", Text, nullable=False),
    ForeignKeyConstraint(["workspace_id", "product_id"], ["products.workspace_id", "products.id"], ondelete="CASCADE"),
    ForeignKeyConstraint(
        ["workspace_id", "account_id"], ["members.workspace_id", "members.account_id"], ondelete="CASCADE"
    ),
    CheckConstraint("role in ('Manager', 'User')", name="role"),
)

# One table per Catalog record kind. The canonical Pydantic payload is stored as JSON;
# identity, Product scope and concurrency are ordinary relational columns.
def catalog_table(name: str) -> Table:
    return Table(
        name, metadata,
        Column("workspace_id", Uuid, nullable=False),
        Column("product_id", Uuid, primary_key=True),
        Column("key", Text, primary_key=True),
        Column("version", Integer, nullable=False),
        Column("entry", JSON, nullable=False),
        ForeignKeyConstraint(["workspace_id", "product_id"], ["products.workspace_id", "products.id"], ondelete="CASCADE"),
    )

catalog_variant_values = catalog_table("catalog_variant_values")

catalog_groups = catalog_table("catalog_groups")
catalog_tags = catalog_table("catalog_tags")
catalog_privileges = catalog_table("catalog_privileges")

# Immutable write-side audit facts; OPE-43 supplies the permission-filtered read side.
catalog_changes = Table(
    "catalog_changes", metadata,
    Column("id", Uuid, primary_key=True),
    Column("workspace_id", Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    Column("entry", JSON, nullable=False),
)
