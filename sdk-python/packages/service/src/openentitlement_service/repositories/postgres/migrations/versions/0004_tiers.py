"""Tiers and the status policy per Product, with Tier audit facts (OPE-40)."""

from alembic import op
import sqlalchemy as sa
from openentitlement_service.repositories.postgres import rls

revision = "0004_tiers"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tiers",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "product_id"], ["products.workspace_id", "products.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("product_id", "key"),
    )
    op.create_table(
        "status_policies",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "product_id"], ["products.workspace_id", "products.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("product_id"),
    )
    op.create_table(
        "tier_changes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
    )
    for name in ("tiers", "status_policies", "tier_changes"):
        for statement in rls.enable(name, "workspace_id"):
            op.execute(statement)


def downgrade() -> None:
    for name in ("tier_changes", "status_policies", "tiers"):
        op.drop_table(name)
