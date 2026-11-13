"""API keys per Product (OPE-42).

Revision ID: 0008_api_keys
Revises: 0007_application_users
Create Date: 2026-11-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from openentitlement_service.repositories.postgres import rls

revision = "0008_api_keys"
down_revision = "0007_application_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("hint", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"], ["accounts.id"], name=op.f("fk_api_keys_created_by_accounts"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "product_id"],
            ["products.workspace_id", "products.id"],
            name=op.f("fk_api_keys_workspace_id_products"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_api_keys")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_api_keys_token_hash")),
    )
    for statement in rls.enable("api_keys", "workspace_id"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("api_keys")
