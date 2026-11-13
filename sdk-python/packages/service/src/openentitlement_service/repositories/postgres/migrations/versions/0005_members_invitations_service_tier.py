"""Invitations, settings audit facts and the Cloud service tier (OPE-44).

Revision ID: 0005_members_invitations
Revises: 0004_tiers
Create Date: 2026-11-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from openentitlement_service.repositories.postgres import rls

revision = "0005_members_invitations"
down_revision = "0004_tiers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspaces", sa.Column("service_tier", sa.Text(), server_default="pro", nullable=False))
    op.create_check_constraint(op.f("ck_workspaces_service_tier"), "workspaces", "service_tier in ('pro', 'enterprise')")
    op.create_table(
        "invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("owner", sa.Boolean(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("role", sa.Text(), nullable=True),
        sa.Column("invited_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(owner and product_id is null and role is null)"
            " or (not owner and product_id is not null and role in ('Manager', 'User'))",
            name=op.f("ck_invitations_role"),
        ),
        sa.ForeignKeyConstraint(
            ["invited_by"], ["accounts.id"], name=op.f("fk_invitations_invited_by_accounts"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_invitations_workspace_id_workspaces"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "product_id"],
            ["products.workspace_id", "products.id"],
            name=op.f("fk_invitations_workspace_id_products"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invitations")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_invitations_token_hash")),
    )
    op.create_table(
        "settings_changes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_settings_changes_workspace_id_workspaces"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_settings_changes")),
    )
    for statement in rls.enable("invitations", "workspace_id") + rls.enable("settings_changes", "workspace_id"):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("settings_changes")
    op.drop_table("invitations")
    op.drop_constraint(op.f("ck_workspaces_service_tier"), "workspaces", type_="check")
    op.drop_column("workspaces", "service_tier")
