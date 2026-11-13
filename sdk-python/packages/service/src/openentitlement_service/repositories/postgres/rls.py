"""Row-level security statements shared by the migrations."""
from __future__ import annotations

SERVICE_ROLE = "openentitlement_service"
WORKSPACE_SETTING = "openentitlement.workspace_id"


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
