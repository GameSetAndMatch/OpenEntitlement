"""Organizations, their Tier variant per Product and Organization audit facts (OPE-41)."""

from alembic import op
import sqlalchemy as sa
from openentitlement_service.repositories.postgres import rls

revision = "0005_organizations"
down_revision = "0004_tiers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("workspace_id", "key"),
    )
    op.create_table(
        "organization_products",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("variant_id", sa.Text(), nullable=False),
        sa.Column("tier_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "product_id"], ["products.workspace_id", "products.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "organization_id"], ["organizations.workspace_id", "organizations.key"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["product_id", "variant_id"], ["catalog_variant_values.product_id", "catalog_variant_values.key"]
        ),
        sa.PrimaryKeyConstraint("product_id", "organization_id"),
    )
    op.create_table(
        "organization_changes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
    )
    for name in ("organizations", "organization_products", "organization_changes"):
        for statement in rls.enable(name, "workspace_id"):
            op.execute(statement)


def downgrade() -> None:
    for name in ("organization_changes", "organization_products", "organizations"):
        op.drop_table(name)
