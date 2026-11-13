"""Application users' Personal terms and Grants per Product (OPE-60)."""

from alembic import op
import sqlalchemy as sa
from openentitlement_service.repositories.postgres import rls

revision = "0007_application_users"
down_revision = "0006_organizations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_users",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Text(), nullable=False),
        sa.Column("subject_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["product_id", "organization_id"],
            ["organization_products.product_id", "organization_products.organization_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("product_id", "organization_id", "subject_id"),
    )
    for statement in rls.enable("application_users", "workspace_id"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("application_users")
