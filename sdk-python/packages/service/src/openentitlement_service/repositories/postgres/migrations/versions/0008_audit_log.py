"""One Audit log for every write, read per Product (OPE-43, ADR-0007).

Replaces the per-area audit facts: no Workspace exists yet on the Python service, so nothing is
carried over.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from openentitlement_service.repositories.postgres import rls

revision = "0008_audit_log"
down_revision = "0007_application_users"
branch_labels = None
depends_on = None

_FACTS = ("catalog_changes", "tier_changes", "settings_changes", "organization_changes")


def upgrade() -> None:
    for name in _FACTS:
        op.drop_table(name)
    op.create_table(
        "audit_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("owners_only", sa.Boolean(), nullable=False),
        sa.Column("shared", sa.Boolean(), nullable=False),
        sa.Column("products", postgresql.ARRAY(sa.Uuid()), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_audit_entries_workspace_id_workspaces"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_entries")),
    )
    op.create_index("ix_audit_entries_workspace_id_seq", "audit_entries", ["workspace_id", "seq"])
    for statement in rls.enable("audit_entries", "workspace_id"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("audit_entries")
    for name in _FACTS:
        columns: list[sa.schema.SchemaItem] = [
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("seq", sa.BigInteger(), sa.Identity(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("entry", sa.JSON(), nullable=False),
        ]
        if name == "tier_changes":
            columns.append(sa.Column("product_id", sa.Uuid(), nullable=True))
        op.create_table(name, *columns)
        for statement in rls.enable(name, "workspace_id"):
            op.execute(statement)
