"""Join the Audit log (OPE-43) and API keys (OPE-42) into one migration path.

Both ``0008_audit_log`` and ``0008_api_keys`` follow ``0007_application_users`` and change
disjoint tables, so this revision changes nothing: it only makes them one head.
"""

revision = "0009_merge_audit_api_keys"
down_revision = ("0008_audit_log", "0008_api_keys")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
