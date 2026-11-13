"""Row-level security statements shared by the migrations."""
from __future__ import annotations

SERVICE_ROLE = "openentitlement_service"
WORKSPACE_SETTING = "openentitlement.workspace_id"
#: The Account a transaction lists Workspaces for (the Workspace switcher), if any.
ACCOUNT_SETTING = "openentitlement.account_id"

BOUND_ACCOUNT = f"nullif(current_setting('{ACCOUNT_SETTING}', true), '')::uuid"


def create_service_role() -> list[str]:
    """The role every request transaction switches to. It never bypasses row-level security."""
    return [
        f"""
        do $$ begin
          if not exists (select from pg_roles where rolname = '{SERVICE_ROLE}') then
            create role {SERVICE_ROLE} nologin nobypassrls;
          end if;
        end $$
        """,
        f"grant {SERVICE_ROLE} to current_user",
        f"grant usage on schema public to {SERVICE_ROLE}",
        f"alter default privileges grant select, insert, update, delete on tables to {SERVICE_ROLE}",
    ]


def enable(table: str, column: str) -> list[str]:
    """Restrict ``table`` to the rows whose ``column`` is the transaction's Workspace."""
    bound = f"nullif(current_setting('{WORKSPACE_SETTING}', true), '')::uuid"
    return [
        f"grant select, insert, update, delete on {table} to {SERVICE_ROLE}",
        f"alter table {table} enable row level security",
        f"alter table {table} force row level security",
        f"create policy workspace_isolation on {table} using ({column} = {bound}) with check ({column} = {bound})",
    ]


def readable_by_account(table: str) -> list[str]:
    """Also let the transaction's Account read its own rows of ``table`` in every Workspace (read only)."""
    return [f"create policy account_directory on {table} for select using (account_id = {BOUND_ACCOUNT})"]


def workspaces_readable_by_members_and_platform_administrators() -> list[str]:
    """Let the transaction's Account read the Workspaces it is a member of, or all of them as a Platform administrator.

    Read only: writes stay bound to the transaction's Workspace.
    """
    return [
        f"""create policy member_directory on workspaces for select using (
              exists (select from members m where m.workspace_id = workspaces.id and m.account_id = {BOUND_ACCOUNT}))""",
        f"""create policy platform_directory on workspaces for select using (
              exists (select from accounts a where a.id = {BOUND_ACCOUNT} and a.platform_admin))""",
    ]
