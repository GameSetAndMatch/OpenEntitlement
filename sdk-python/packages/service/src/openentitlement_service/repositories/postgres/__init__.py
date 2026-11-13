"""Postgres repositories: SQLAlchemy Core on the asyncpg driver, migrated by Alembic.

Every transaction switches to the ``openentitlement_service`` role, which never bypasses
row-level security, and binds the Workspace in ``openentitlement.workspace_id``. Postgres then
filters every query, including raw SQL, to that Workspace. A transaction may also bind an Account
in ``openentitlement.account_id``, which only adds read access to that Account's memberships and
their Workspaces (the Workspace switcher). Accounts, sessions and sign-in flows belong to no
Workspace and have no row-level security.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import ColumnElement, Text, and_, cast, func, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from sqlalchemy.sql.dml import Insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from ...services.catalog import CatalogRecord, CatalogChange, VariantValues
from ...services.organizations import AssignmentRecord, OrganizationChange, OrganizationRecord
from ...services.tiers import StatusPolicyRecord, TierChange, TierRecord
from ...services.models import (
    Account,
    Invitation,
    Member,
    Product,
    ProductMembership,
    Session,
    SettingsChange,
    SignInFlow,
    Workspace,
    WorkspaceMembership,
)
from ...services.problems import ServiceUnavailable
from ...services.repositories import AlreadyExists, Repositories, StaleVersion, ensure_bound_workspace
from .migrate import migrate
from .rls import ACCOUNT_SETTING, SERVICE_ROLE, WORKSPACE_SETTING
from .tables import catalog_variant_values, catalog_changes, catalog_groups, catalog_tags, catalog_privileges
from .tables import status_policies, tier_changes, tiers
from .tables import organization_changes, organization_products, organizations
from .tables import accounts, members, product_roles, products, sessions, sign_in_flows, workspaces
from .tables import invitations, settings_changes


UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"

__all__ = ["PostgresStore", "create_engine", "migrate", "asyncpg_url", "SERVICE_ROLE", "WORKSPACE_SETTING"]


def asyncpg_url(url: str) -> str:
    """Accept ``postgresql://`` and ``postgres://`` URLs and select the asyncpg driver."""
    parsed = make_url(url.replace("postgres://", "postgresql://", 1) if url.startswith("postgres://") else url)
    return parsed.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)


def create_engine(url: str, *, transaction_pooler: bool = False, **options: Any) -> AsyncEngine:
    """An async engine on asyncpg.

    Behind a transaction-mode pooler (for example PgBouncer), a connection may change between
    statements, so prepared statements cannot be cached or named per connection.
    """
    connect_args: dict[str, object] = {}
    if transaction_pooler:
        connect_args = {
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__oe_{uuid4().hex}__",
        }
    return create_async_engine(asyncpg_url(url), connect_args=connect_args, **options)


async def _insert(connection: AsyncConnection, statement: Insert) -> None:
    try:
        await connection.execute(statement)
    except IntegrityError as exc:
        if getattr(exc.orig, "sqlstate", None) == UNIQUE_VIOLATION:
            raise AlreadyExists(str(statement.table)) from exc
        raise


class PostgresWorkspacesRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self._workspace_id = connection, workspace_id

    async def add(self, workspace: Workspace) -> None:
        ensure_bound_workspace(self._workspace_id, workspace.id)
        await _insert(self.connection, workspaces.insert().values(**workspace.model_dump(by_alias=False)))

    async def get(self) -> Workspace | None:
        query = select(workspaces).where(workspaces.c.id == self._workspace_id)
        row = (await self.connection.execute(query)).mappings().first()
        return Workspace.model_validate(dict(row)) if row else None

    async def lock(self) -> None:
        await self.connection.execute(
            select(workspaces.c.id).where(workspaces.c.id == self._workspace_id).with_for_update()
        )

    async def update(self, workspace: Workspace, *, expected_version: int) -> None:
        ensure_bound_workspace(self._workspace_id, workspace.id)
        statement = (
            workspaces.update()
            .where(workspaces.c.id == workspace.id, workspaces.c.version == expected_version)
            .values(service_tier=workspace.service_tier.value, version=workspace.version)
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(f"workspace {workspace.id}")


class PostgresProductsRepository:
    async def lock_deletion(self) -> None:
        # Lock only lifecycle deletions; edits to different Products remain independent.
        await self.connection.execute(
            select(workspaces.c.id).where(workspaces.c.id == self._workspace_id).with_for_update()
        )

    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self._workspace_id = connection, workspace_id

    async def add(self, product: Product) -> None:
        ensure_bound_workspace(self._workspace_id, product.workspace_id)
        await _insert(self.connection, products.insert().values(**product.model_dump(by_alias=False)))

    async def list(self) -> Sequence[Product]:
        query = select(products).where(products.c.workspace_id == self._workspace_id).order_by(products.c.key)
        return [Product.model_validate(dict(row)) for row in (await self.connection.execute(query)).mappings()]

    async def get(self, product_id: UUID) -> Product | None:
        query = select(products).where(products.c.workspace_id == self._workspace_id, products.c.id == product_id)
        row = (await self.connection.execute(query)).mappings().first()
        return Product.model_validate(dict(row)) if row else None

    def _current(self, product_id: UUID, expected_version: int) -> ColumnElement[bool]:
        return and_(
            products.c.workspace_id == self._workspace_id,
            products.c.id == product_id,
            products.c.version == expected_version,
        )

    async def update(self, product: Product, *, expected_version: int) -> None:
        ensure_bound_workspace(self._workspace_id, product.workspace_id)
        statement = (
            products.update()
            .where(self._current(product.id, expected_version))
            .values(name=product.name, archived_at=product.archived_at, version=product.version)
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(f"product {product.id}")

    async def delete(self, product_id: UUID, *, expected_version: int) -> None:
        statement = products.delete().where(self._current(product_id, expected_version))
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(f"product {product_id}")

    async def in_use(self, product_id: UUID) -> bool:
        query = select(organization_products.c.organization_id).where(
            organization_products.c.workspace_id == self._workspace_id, organization_products.c.product_id == product_id
        )
        return (await self.connection.execute(query.limit(1))).first() is not None


class PostgresMembersRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self._workspace_id = connection, workspace_id

    async def add(self, member: Member) -> None:
        ensure_bound_workspace(self._workspace_id, member.workspace_id)
        await _insert(self.connection, members.insert().values(**member.model_dump(by_alias=False)))

    async def get(self, account_id: UUID) -> Member | None:
        query = select(members).where(members.c.workspace_id == self._workspace_id, members.c.account_id == account_id)
        row = (await self.connection.execute(query)).mappings().first()
        return Member.model_validate(dict(row)) if row else None

    async def set_product_role(self, membership: ProductMembership) -> None:
        ensure_bound_workspace(self._workspace_id, membership.workspace_id)
        values = membership.model_dump(by_alias=False) | {"role": membership.role.value}
        statement = pg_insert(product_roles).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[product_roles.c.product_id, product_roles.c.account_id],
            set_={"role": statement.excluded.role},
        )
        try:
            await self.connection.execute(statement)
        except IntegrityError as exc:
            if getattr(exc.orig, "sqlstate", None) == FOREIGN_KEY_VIOLATION:
                raise LookupError("unknown Product or member") from exc
            raise

    async def product_roles(self, account_id: UUID) -> Sequence[ProductMembership]:
        query = (
            select(product_roles)
            .where(product_roles.c.workspace_id == self._workspace_id, product_roles.c.account_id == account_id)
            .order_by(cast(product_roles.c.product_id, Text))
        )
        return [ProductMembership.model_validate(dict(row)) for row in (await self.connection.execute(query)).mappings()]

    async def list(self) -> Sequence[Member]:
        query = select(members).where(members.c.workspace_id == self._workspace_id).order_by(cast(members.c.account_id, Text))
        return [Member.model_validate(dict(row)) for row in (await self.connection.execute(query)).mappings()]

    async def all_product_roles(self) -> Sequence[ProductMembership]:
        query = (
            select(product_roles)
            .where(product_roles.c.workspace_id == self._workspace_id)
            .order_by(cast(product_roles.c.product_id, Text), cast(product_roles.c.account_id, Text))
        )
        return [ProductMembership.model_validate(dict(row)) for row in (await self.connection.execute(query)).mappings()]

    async def set_owner(self, account_id: UUID, owner: bool) -> None:
        statement = (
            members.update()
            .where(members.c.workspace_id == self._workspace_id, members.c.account_id == account_id)
            .values(owner=owner)
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise LookupError(f"member {account_id}")

    async def remove_product_role(self, product_id: UUID, account_id: UUID) -> None:
        await self.connection.execute(
            product_roles.delete().where(
                product_roles.c.workspace_id == self._workspace_id,
                product_roles.c.product_id == product_id,
                product_roles.c.account_id == account_id,
            )
        )

    async def remove(self, account_id: UUID) -> None:
        # Product Roles go with the membership (ON DELETE CASCADE).
        await self.connection.execute(
            members.delete().where(members.c.workspace_id == self._workspace_id, members.c.account_id == account_id)
        )


class PostgresInvitationsRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self._workspace_id = connection, workspace_id

    async def add(self, invitation: Invitation, *, now: datetime) -> None:
        ensure_bound_workspace(self._workspace_id, invitation.workspace_id)
        await self.connection.execute(
            invitations.delete().where(invitations.c.workspace_id == self._workspace_id, invitations.c.expires_at <= now)
        )
        values = invitation.model_dump(by_alias=False) | {"role": invitation.role.value if invitation.role else None}
        await _insert(self.connection, invitations.insert().values(**values))

    async def take(self, token_hash: str, *, now: datetime) -> Invitation | None:
        statement = (
            invitations.delete()
            .where(invitations.c.workspace_id == self._workspace_id, invitations.c.token_hash == token_hash)
            .returning(*invitations.c)
        )
        row = (await self.connection.execute(statement)).mappings().first()
        if row is None or row["expires_at"] <= now:
            return None
        return Invitation.model_validate(dict(row))


class PostgresSettingsChangesRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self._workspace_id = connection, workspace_id

    async def add(self, change: SettingsChange) -> None:
        ensure_bound_workspace(self._workspace_id, change.workspace_id)
        await self.connection.execute(
            settings_changes.insert().values(
                id=change.id, workspace_id=change.workspace_id, at=change.at, entry=change.model_dump(mode="json")
            )
        )

    async def list(self) -> Sequence[SettingsChange]:
        query = (
            select(settings_changes.c.entry)
            .where(settings_changes.c.workspace_id == self._workspace_id)
            .order_by(settings_changes.c.seq)
        )
        return [SettingsChange.model_validate(row) for row in (await self.connection.execute(query)).scalars()]


class PostgresAccountsRepository:
    def __init__(self, connection: AsyncConnection) -> None:
        self.connection = connection

    async def sign_in(self, account: Account) -> Account:
        insert = pg_insert(accounts).values(**account.model_dump(by_alias=False))
        statement = insert.on_conflict_do_update(
            index_elements=[accounts.c.issuer, accounts.c.subject],
            set_={
                "email": insert.excluded.email,
                "platform_admin": accounts.c.platform_admin.op("or")(insert.excluded.platform_admin),
            },
        ).returning(*accounts.c)
        row = (await self.connection.execute(statement)).mappings().one()
        return Account.model_validate(dict(row))

    async def get(self, account_id: UUID) -> Account | None:
        row = (await self.connection.execute(select(accounts).where(accounts.c.id == account_id))).mappings().first()
        return Account.model_validate(dict(row)) if row else None


class PostgresSessionsRepository:
    def __init__(self, connection: AsyncConnection) -> None:
        self.connection = connection

    async def add(self, session: Session) -> None:
        await _insert(self.connection, sessions.insert().values(**session.model_dump(by_alias=False)))

    async def get(self, token_hash: str, *, now: datetime) -> Session | None:
        query = select(sessions).where(sessions.c.token_hash == token_hash, sessions.c.expires_at > now)
        row = (await self.connection.execute(query)).mappings().first()
        return Session.model_validate(dict(row)) if row else None

    async def delete(self, token_hash: str) -> None:
        await self.connection.execute(sessions.delete().where(sessions.c.token_hash == token_hash))


class PostgresSignInFlowsRepository:
    def __init__(self, connection: AsyncConnection) -> None:
        self.connection = connection

    async def add(self, flow: SignInFlow, *, now: datetime) -> None:
        await self.connection.execute(sign_in_flows.delete().where(sign_in_flows.c.expires_at <= now))
        await _insert(self.connection, sign_in_flows.insert().values(**flow.model_dump(by_alias=False)))

    async def take(self, flow_hash: str, *, now: datetime) -> SignInFlow | None:
        statement = sign_in_flows.delete().where(sign_in_flows.c.flow_hash == flow_hash).returning(*sign_in_flows.c)
        row = (await self.connection.execute(statement)).mappings().first()
        if row is None or row["expires_at"] <= now:
            return None
        return SignInFlow.model_validate(dict(row))


class PostgresDirectoryRepository:
    """Reads across Workspaces, limited by row-level security to the transaction's Account."""

    def __init__(self, connection: AsyncConnection, account_id: UUID | None) -> None:
        self.connection, self._account_id = connection, account_id

    async def memberships(self) -> Sequence[WorkspaceMembership]:
        if self._account_id is None:
            return []
        roles = (
            select(func.array_agg(aggregate_order_by(product_roles.c.role.distinct(), product_roles.c.role)))
            .where(product_roles.c.workspace_id == members.c.workspace_id, product_roles.c.account_id == members.c.account_id)
            .scalar_subquery()
        )
        query = (
            select(workspaces, members.c.owner, roles.label("roles"))
            .join(members, members.c.workspace_id == workspaces.c.id)
            .where(members.c.account_id == self._account_id)
            .order_by(workspaces.c.name, cast(workspaces.c.id, Text))
        )
        found = []
        for row in (await self.connection.execute(query)).mappings():
            workspace = Workspace.model_validate({c.name: row[c.name] for c in workspaces.c})
            found.append(WorkspaceMembership(workspace=workspace, owner=row["owner"], roles=tuple(row["roles"] or ())))
        return found

    async def every_workspace(self) -> Sequence[Workspace]:
        if self._account_id is None:
            return []
        admin = select(accounts.c.platform_admin).where(accounts.c.id == self._account_id).scalar_subquery()
        query = select(workspaces).where(func.coalesce(admin, False)).order_by(workspaces.c.name, cast(workspaces.c.id, Text))
        return [Workspace.model_validate(dict(row)) for row in (await self.connection.execute(query)).mappings()]


class PostgresCatalogRepository:
    async def variants(self, product_id: UUID) -> Sequence[VariantValues]:
        table = catalog_variant_values
        rows = (await self.connection.execute(select(table.c.entry).where(table.c.workspace_id == self.workspace_id, table.c.product_id == product_id).order_by(table.c.key))).scalars()
        return [VariantValues.model_validate(row) for row in rows]

    async def save_variant(self, variant: VariantValues, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, variant.workspace_id)
        table = catalog_variant_values
        values = dict(workspace_id=variant.workspace_id, product_id=variant.product_id, key=variant.id, version=variant.version, entry=variant.model_dump(mode='json'))
        if expected_version == 0:
            await _insert(self.connection, table.insert().values(**values))
        else:
            statement = table.update().where(table.c.workspace_id == self.workspace_id, table.c.product_id == variant.product_id, table.c.key == variant.id, table.c.version == expected_version).values(version=variant.version, entry=values['entry'])
            if (await self.connection.execute(statement)).rowcount != 1:
                raise StaleVersion(variant.id)

    async def delete_variant(self, product_id: UUID, variant_id: str, *, expected_version: int) -> None:
        table = catalog_variant_values
        statement = table.delete().where(
            table.c.workspace_id == self.workspace_id,
            table.c.product_id == product_id,
            table.c.key == variant_id,
            table.c.version == expected_version,
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(variant_id)

    async def audit(self, change: CatalogChange) -> None:
        ensure_bound_workspace(self.workspace_id, change.workspace_id)
        await self.connection.execute(catalog_changes.insert().values(id=change.id, workspace_id=change.workspace_id, entry=change.model_dump(mode="json")))

    async def changes(self, product_id: UUID) -> Sequence[CatalogChange]:
        rows = (await self.connection.execute(select(catalog_changes.c.entry).where(catalog_changes.c.workspace_id == self.workspace_id))).scalars()
        found = [CatalogChange.model_validate(row) for row in rows]
        return sorted((c for c in found if c.product_id == product_id), key=lambda c: c.at)

    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self.workspace_id = connection, workspace_id

    async def lock(self, product_id: UUID) -> None:
        await self.connection.execute(select(products.c.id).where(products.c.workspace_id == self.workspace_id, products.c.id == product_id).with_for_update())

    async def list(self, product_id: UUID) -> Sequence[CatalogRecord]:
        result: list[CatalogRecord] = []
        for kind, table in (("groups", catalog_groups), ("tags", catalog_tags), ("privileges", catalog_privileges)):
            rows = (await self.connection.execute(select(table).where(table.c.workspace_id == self.workspace_id, table.c.product_id == product_id).order_by(table.c.key))).mappings()
            result.extend(CatalogRecord.model_validate(dict(row) | {"kind": kind}) for row in rows)
        return result

    async def save(self, record: CatalogRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, record.workspace_id)
        table = {"groups": catalog_groups, "tags": catalog_tags, "privileges": catalog_privileges}[record.kind]
        values = record.model_dump(mode="python", by_alias=False, exclude={"kind", "entry"}) | {"entry": record.entry.model_dump(mode="json")}
        if expected_version == 0:
            await _insert(self.connection, table.insert().values(**values))
        else:
            statement = table.update().where(table.c.workspace_id == self.workspace_id, table.c.product_id == record.product_id, table.c.key == record.key, table.c.version == expected_version).values(version=record.version, entry=values["entry"])
            if (await self.connection.execute(statement)).rowcount != 1:
                raise StaleVersion(record.key)


class PostgresTiersRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self.workspace_id = connection, workspace_id

    async def list(self, product_id: UUID) -> Sequence[TierRecord]:
        query = (
            select(tiers.c.entry)
            .where(tiers.c.workspace_id == self.workspace_id, tiers.c.product_id == product_id)
            .order_by(tiers.c.key)
        )
        return [TierRecord.model_validate(row) for row in (await self.connection.execute(query)).scalars()]

    async def save(self, tier: TierRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, tier.workspace_id)
        entry = tier.model_dump(mode="json")
        if expected_version == 0:
            values = dict(workspace_id=tier.workspace_id, product_id=tier.product_id, key=tier.id, version=tier.version, entry=entry)
            await _insert(self.connection, tiers.insert().values(**values))
            return
        statement = (
            tiers.update()
            .where(
                tiers.c.workspace_id == self.workspace_id,
                tiers.c.product_id == tier.product_id,
                tiers.c.key == tier.id,
                tiers.c.version == expected_version,
            )
            .values(version=tier.version, entry=entry)
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(tier.id)

    async def delete(self, product_id: UUID, tier_id: str, *, expected_version: int) -> None:
        statement = tiers.delete().where(
            tiers.c.workspace_id == self.workspace_id,
            tiers.c.product_id == product_id,
            tiers.c.key == tier_id,
            tiers.c.version == expected_version,
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(tier_id)

    async def in_use(self, product_id: UUID, tier_id: str) -> bool:
        table = organization_products
        query = select(table.c.organization_id).where(
            table.c.workspace_id == self.workspace_id, table.c.product_id == product_id, table.c.tier_id == tier_id
        )
        return (await self.connection.execute(query.limit(1))).first() is not None

    async def policy(self, product_id: UUID) -> StatusPolicyRecord | None:
        query = select(status_policies.c.entry).where(
            status_policies.c.workspace_id == self.workspace_id, status_policies.c.product_id == product_id
        )
        row = (await self.connection.execute(query)).scalars().first()
        return StatusPolicyRecord.model_validate(row) if row else None

    async def save_policy(self, policy: StatusPolicyRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, policy.workspace_id)
        entry = policy.model_dump(mode="json")
        if expected_version == 0:
            values = dict(workspace_id=policy.workspace_id, product_id=policy.product_id, version=policy.version, entry=entry)
            await _insert(self.connection, status_policies.insert().values(**values))
            return
        statement = (
            status_policies.update()
            .where(
                status_policies.c.workspace_id == self.workspace_id,
                status_policies.c.product_id == policy.product_id,
                status_policies.c.version == expected_version,
            )
            .values(version=policy.version, entry=entry)
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(str(policy.product_id))

    async def audit(self, change: TierChange) -> None:
        ensure_bound_workspace(self.workspace_id, change.workspace_id)
        values = dict(
            id=change.id, workspace_id=change.workspace_id, product_id=change.product_id, at=change.at, entry=change.model_dump(mode="json")
        )
        await self.connection.execute(tier_changes.insert().values(**values))

    async def changes(self, product_id: UUID) -> Sequence[TierChange]:
        query = (
            select(tier_changes.c.entry)
            .where(tier_changes.c.workspace_id == self.workspace_id, tier_changes.c.product_id == product_id)
            .order_by(tier_changes.c.seq)
        )
        return [TierChange.model_validate(row) for row in (await self.connection.execute(query)).scalars()]


class PostgresOrganizationsRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID | None) -> None:
        self.connection, self.workspace_id = connection, workspace_id

    async def list(self) -> Sequence[OrganizationRecord]:
        query = select(organizations.c.entry).where(organizations.c.workspace_id == self.workspace_id).order_by(organizations.c.key)
        return [OrganizationRecord.model_validate(row) for row in (await self.connection.execute(query)).scalars()]

    async def get(self, organization_id: str) -> OrganizationRecord | None:
        query = select(organizations.c.entry).where(
            organizations.c.workspace_id == self.workspace_id, organizations.c.key == organization_id
        )
        row = (await self.connection.execute(query)).scalars().first()
        return OrganizationRecord.model_validate(row) if row else None

    async def add(self, organization: OrganizationRecord) -> None:
        ensure_bound_workspace(self.workspace_id, organization.workspace_id)
        values = dict(
            workspace_id=organization.workspace_id,
            key=organization.id,
            version=organization.version,
            entry=organization.model_dump(mode="json"),
        )
        await _insert(self.connection, organizations.insert().values(**values))

    async def update(self, organization: OrganizationRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, organization.workspace_id)
        statement = (
            organizations.update()
            .where(
                organizations.c.workspace_id == self.workspace_id,
                organizations.c.key == organization.id,
                organizations.c.version == expected_version,
            )
            .values(version=organization.version, entry=organization.model_dump(mode="json"))
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(organization.id)

    async def assignments(self, product_id: UUID | None = None) -> Sequence[AssignmentRecord]:
        table = organization_products
        query = select(table.c.entry).where(table.c.workspace_id == self.workspace_id)
        if product_id is not None:
            query = query.where(table.c.product_id == product_id)
        query = query.order_by(cast(table.c.product_id, Text), table.c.organization_id)
        return [AssignmentRecord.model_validate(row) for row in (await self.connection.execute(query)).scalars()]

    async def save_assignment(self, assignment: AssignmentRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, assignment.workspace_id)
        table = organization_products
        values = dict(
            variant_id=assignment.variant_id,
            tier_id=assignment.tier_id,
            version=assignment.version,
            entry=assignment.model_dump(mode="json"),
        )
        if expected_version == 0:
            keys = dict(
                workspace_id=assignment.workspace_id,
                product_id=assignment.product_id,
                organization_id=assignment.organization_id,
            )
            await _insert(self.connection, table.insert().values(**keys, **values))
            return
        statement = (
            table.update()
            .where(
                table.c.workspace_id == self.workspace_id,
                table.c.product_id == assignment.product_id,
                table.c.organization_id == assignment.organization_id,
                table.c.version == expected_version,
            )
            .values(**values)
        )
        if (await self.connection.execute(statement)).rowcount != 1:
            raise StaleVersion(assignment.organization_id)

    async def audit(self, change: OrganizationChange) -> None:
        ensure_bound_workspace(self.workspace_id, change.workspace_id)
        values = dict(id=change.id, workspace_id=change.workspace_id, at=change.at, entry=change.model_dump(mode="json"))
        await self.connection.execute(organization_changes.insert().values(**values))

    async def changes(self) -> Sequence[OrganizationChange]:
        query = (
            select(organization_changes.c.entry)
            .where(organization_changes.c.workspace_id == self.workspace_id)
            .order_by(organization_changes.c.seq)
        )
        return [OrganizationChange.model_validate(row) for row in (await self.connection.execute(query)).scalars()]


@dataclass(frozen=True)
class PostgresRepositories(Repositories):
    """The repositories of one transaction, plus that transaction's connection."""

    connection: AsyncConnection


class PostgresStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    @asynccontextmanager
    async def transaction(
        self, workspace_id: UUID | None = None, *, account_id: UUID | None = None
    ) -> AsyncIterator[Repositories]:
        async with self.engine.begin() as connection:
            await connection.execute(text(f"set local role {SERVICE_ROLE}"))
            await connection.execute(
                text("select set_config(:w, :workspace, true), set_config(:a, :account, true)"),
                {
                    "w": WORKSPACE_SETTING,
                    "workspace": str(workspace_id or ""),
                    "a": ACCOUNT_SETTING,
                    "account": str(account_id or ""),
                },
            )
            yield PostgresRepositories(
                workspaces=PostgresWorkspacesRepository(connection, workspace_id),
                products=PostgresProductsRepository(connection, workspace_id),
                members=PostgresMembersRepository(connection, workspace_id),
                accounts=PostgresAccountsRepository(connection),
                sessions=PostgresSessionsRepository(connection),
                sign_in_flows=PostgresSignInFlowsRepository(connection),
                catalog=PostgresCatalogRepository(connection, workspace_id),
                tiers=PostgresTiersRepository(connection, workspace_id),
                organizations=PostgresOrganizationsRepository(connection, workspace_id),
                directory=PostgresDirectoryRepository(connection, account_id),
                invitations=PostgresInvitationsRepository(connection, workspace_id),
                settings_changes=PostgresSettingsChangesRepository(connection, workspace_id),
                connection=connection,
            )

    async def role_bypasses_row_level_security(self) -> bool:
        """Whether the connecting role is a superuser or has BYPASSRLS, and could leave the service role."""
        async with self.engine.connect() as connection:
            query = text("select rolsuper or rolbypassrls from pg_roles where rolname = current_user")
            return bool((await connection.execute(query)).scalar())

    async def ping(self) -> None:
        try:
            async with self.engine.connect() as connection:
                await connection.execute(text("select 1"))
        except (OperationalError, DBAPIError, OSError) as exc:
            raise ServiceUnavailable() from exc
