"""Per-Product Catalog records with per-record versions."""

from alembic import op
import sqlalchemy as sa
from openentitlement_service.repositories.postgres import rls

revision = "0003"
down_revision = "0002_sign_in_members_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("catalog_groups", "catalog_tags", "catalog_privileges", "catalog_variant_values"):
        op.create_table(
            name,
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
        for statement in rls.enable(name, "workspace_id"):
            op.execute(statement)

    op.create_table(
        "catalog_changes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
    )
    for statement in rls.enable("catalog_changes", "workspace_id"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("catalog_changes")
    for name in ("catalog_variant_values", "catalog_privileges", "catalog_tags", "catalog_groups"):
        op.drop_table(name)
