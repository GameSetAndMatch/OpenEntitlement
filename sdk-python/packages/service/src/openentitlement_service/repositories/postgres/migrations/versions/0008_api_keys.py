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
    # RFC-0005: retained Grants can exist without an assignment. Keep the Product and
    # Organization boundaries as composite foreign keys rather than the assignment FK.
    op.drop_constraint("fk_application_users_product_id_organization_products", "application_users", type_="foreignkey")
    op.create_foreign_key("fk_application_users_workspace_id_products", "application_users", "products",
                          ["workspace_id", "product_id"], ["workspace_id", "id"], ondelete="CASCADE")
    op.create_foreign_key("fk_application_users_workspace_id_organizations", "application_users", "organizations",
                          ["workspace_id", "organization_id"], ["workspace_id", "key"], ondelete="CASCADE")
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
    # Retained facts must be exported or removed before reverting this amendment.
    op.drop_constraint("fk_application_users_workspace_id_products", "application_users", type_="foreignkey")
    op.drop_constraint("fk_application_users_workspace_id_organizations", "application_users", type_="foreignkey")
    op.create_foreign_key("fk_application_users_product_id_organization_products", "application_users", "organization_products",
                          ["product_id", "organization_id"], ["product_id", "organization_id"], ondelete="CASCADE")
