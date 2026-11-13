"""In-memory repositories: the pattern for fast service-layer tests.

A transaction works on a copy of the committed state and publishes it on success, so a
failed transaction leaves nothing behind, as on Postgres. Rows are keyed by Workspace and a
transaction sees only the Workspace it is bound to, mirroring row-level security.
"""
from __future__ import annotations

import asyncio
import copy
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from ...services.catalog import CatalogRecord, CatalogChange, VariantValues
from ...services.models import (
    Account,
    Member,
    Product,
    ProductMembership,
    Session,
    SignInFlow,
    Workspace,
    WorkspaceMembership,
)
from ...services.repositories import AlreadyExists, Repositories, StaleVersion, ensure_bound_workspace


@dataclass
class _Rows:
    variant_values: dict[tuple[UUID, UUID, str], VariantValues] = field(default_factory=dict)
    catalog_changes: list[CatalogChange] = field(default_factory=list)
    catalog: dict[tuple[UUID, UUID, str, str], CatalogRecord] = field(default_factory=dict)
    workspaces: dict[UUID, Workspace] = field(default_factory=dict)
    products: dict[UUID, dict[UUID, Product]] = field(default_factory=dict)
    members: dict[UUID, dict[UUID, Member]] = field(default_factory=dict)
    #: Workspace → (Product, Account) → Role.
    product_roles: dict[UUID, dict[tuple[UUID, UUID], ProductMembership]] = field(default_factory=dict)
    accounts: dict[UUID, Account] = field(default_factory=dict)
    sessions: dict[str, Session] = field(default_factory=dict)
    sign_in_flows: dict[str, SignInFlow] = field(default_factory=dict)
    #: Products an Organization uses. Organizations arrive with OPE-41; tests may mark a Product used.
    used_products: set[UUID] = field(default_factory=set)


class InMemoryWorkspacesRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self._rows, self._workspace_id = rows, workspace_id

    async def add(self, workspace: Workspace) -> None:
        ensure_bound_workspace(self._workspace_id, workspace.id)
        if workspace.id in self._rows.workspaces:
            raise AlreadyExists(f"workspace {workspace.id}")
        self._rows.workspaces[workspace.id] = workspace

    async def get(self) -> Workspace | None:
        return self._rows.workspaces.get(self._workspace_id) if self._workspace_id else None


class InMemoryProductsRepository:
    async def lock_deletion(self) -> None:
        # InMemoryStore already serializes entire transactions.
        pass

    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self._rows, self._workspace_id = rows, workspace_id

    def _own(self) -> dict[UUID, Product]:
        return self._rows.products.get(self._workspace_id, {}) if self._workspace_id else {}

    async def add(self, product: Product) -> None:
        ensure_bound_workspace(self._workspace_id, product.workspace_id)
        if any(p.id == product.id or p.key == product.key for p in self._own().values()):
            raise AlreadyExists(f"product {product.key!r}")
        self._rows.products.setdefault(product.workspace_id, {})[product.id] = product

    async def list(self) -> Sequence[Product]:
        return sorted(self._own().values(), key=lambda p: p.key)

    async def get(self, product_id: UUID) -> Product | None:
        return self._own().get(product_id)

    def _current(self, product_id: UUID, expected_version: int) -> Product:
        current = self._own().get(product_id)
        if current is None or current.version != expected_version:
            raise StaleVersion(f"product {product_id}")
        return current

    async def update(self, product: Product, *, expected_version: int) -> None:
        ensure_bound_workspace(self._workspace_id, product.workspace_id)
        current = self._current(product.id, expected_version)
        changed = {"name": product.name, "archived_at": product.archived_at, "version": product.version}
        self._own()[product.id] = current.model_copy(update=changed)

    async def delete(self, product_id: UUID, *, expected_version: int) -> None:
        self._current(product_id, expected_version)
        del self._own()[product_id]
        for catalog_key in [k for k in self._rows.catalog if k[:2] == (self._workspace_id, product_id)]:
            del self._rows.catalog[catalog_key]
        for variant_key in [k for k in self._rows.variant_values if k[:2] == (self._workspace_id, product_id)]:
            del self._rows.variant_values[variant_key]
        roles = self._rows.product_roles.get(self._workspace_id, {}) if self._workspace_id else {}
        for key in [k for k in roles if k[0] == product_id]:
            del roles[key]

    async def in_use(self, product_id: UUID) -> bool:
        return product_id in self._own() and product_id in self._rows.used_products


class InMemoryMembersRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self._rows, self._workspace_id = rows, workspace_id

    async def add(self, member: Member) -> None:
        ensure_bound_workspace(self._workspace_id, member.workspace_id)
        members = self._rows.members.setdefault(member.workspace_id, {})
        if member.account_id in members:
            raise AlreadyExists(f"member {member.account_id}")
        members[member.account_id] = member

    async def get(self, account_id: UUID) -> Member | None:
        return self._rows.members.get(self._workspace_id, {}).get(account_id) if self._workspace_id else None

    async def set_product_role(self, membership: ProductMembership) -> None:
        ensure_bound_workspace(self._workspace_id, membership.workspace_id)
        if membership.product_id not in self._rows.products.get(membership.workspace_id, {}):
            raise LookupError(f"product {membership.product_id}")
        if membership.account_id not in self._rows.members.get(membership.workspace_id, {}):
            raise LookupError(f"member {membership.account_id}")
        roles = self._rows.product_roles.setdefault(membership.workspace_id, {})
        roles[(membership.product_id, membership.account_id)] = membership

    async def product_roles(self, account_id: UUID) -> Sequence[ProductMembership]:
        roles = self._rows.product_roles.get(self._workspace_id, {}) if self._workspace_id else {}
        return sorted((m for m in roles.values() if m.account_id == account_id), key=lambda m: str(m.product_id))


class InMemoryAccountsRepository:
    def __init__(self, rows: _Rows) -> None:
        self._rows = rows

    async def sign_in(self, account: Account) -> Account:
        existing = next(
            (a for a in self._rows.accounts.values() if (a.issuer, a.subject) == (account.issuer, account.subject)),
            None,
        )
        if existing is None:
            self._rows.accounts[account.id] = account
            return account
        updated = existing.model_copy(
            update={"email": account.email, "platform_admin": existing.platform_admin or account.platform_admin}
        )
        self._rows.accounts[existing.id] = updated
        return updated

    async def get(self, account_id: UUID) -> Account | None:
        return self._rows.accounts.get(account_id)


class InMemorySessionsRepository:
    def __init__(self, rows: _Rows) -> None:
        self._rows = rows

    async def add(self, session: Session) -> None:
        if session.token_hash in self._rows.sessions:
            raise AlreadyExists("session")
        self._rows.sessions[session.token_hash] = session

    async def get(self, token_hash: str, *, now: datetime) -> Session | None:
        session = self._rows.sessions.get(token_hash)
        return session if session and session.expires_at > now else None

    async def delete(self, token_hash: str) -> None:
        self._rows.sessions.pop(token_hash, None)


class InMemorySignInFlowsRepository:
    def __init__(self, rows: _Rows) -> None:
        self._rows = rows

    async def add(self, flow: SignInFlow, *, now: datetime) -> None:
        for key in [k for k, f in self._rows.sign_in_flows.items() if f.expires_at <= now]:
            del self._rows.sign_in_flows[key]
        if flow.flow_hash in self._rows.sign_in_flows:
            raise AlreadyExists("sign-in flow")
        self._rows.sign_in_flows[flow.flow_hash] = flow

    async def take(self, flow_hash: str, *, now: datetime) -> SignInFlow | None:
        flow = self._rows.sign_in_flows.pop(flow_hash, None)
        return flow if flow and flow.expires_at > now else None


class InMemoryDirectoryRepository:
    def __init__(self, rows: _Rows, account_id: UUID | None) -> None:
        self._rows, self._account_id = rows, account_id

    async def memberships(self) -> Sequence[WorkspaceMembership]:
        found = []
        for workspace_id, members in self._rows.members.items():
            member = members.get(self._account_id) if self._account_id else None
            if member is None:
                continue
            roles = self._rows.product_roles.get(workspace_id, {}).values()
            found.append(
                WorkspaceMembership(
                    workspace=self._rows.workspaces[workspace_id],
                    owner=member.owner,
                    roles=tuple(sorted({m.role for m in roles if m.account_id == self._account_id})),
                )
            )
        return sorted(found, key=lambda m: (m.workspace.name, str(m.workspace.id)))

    async def every_workspace(self) -> Sequence[Workspace]:
        account = self._rows.accounts.get(self._account_id) if self._account_id else None
        if account is None or not account.platform_admin:
            return []
        return sorted(self._rows.workspaces.values(), key=lambda w: (w.name, str(w.id)))


class InMemoryCatalogRepository:
    async def variants(self, product_id: UUID) -> Sequence[VariantValues]:
        return sorted((v for v in self.rows.variant_values.values() if v.workspace_id == self.workspace_id and v.product_id == product_id and product_id in self.rows.products.get(v.workspace_id, {})), key=lambda v: v.id)

    async def save_variant(self, variant: VariantValues, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, variant.workspace_id)
        if variant.product_id not in self.rows.products.get(variant.workspace_id, {}):
            raise LookupError('unknown Product')
        key = (variant.workspace_id, variant.product_id, variant.id)
        current = self.rows.variant_values.get(key)
        if (current.version if current else 0) != expected_version:
            raise StaleVersion(variant.id)
        self.rows.variant_values[key] = variant

    async def audit(self, change: CatalogChange) -> None:
        ensure_bound_workspace(self.workspace_id, change.workspace_id)
        self.rows.catalog_changes.append(change)

    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self.rows, self.workspace_id = rows, workspace_id

    async def lock(self, product_id: UUID) -> None:
        pass  # The store serializes transactions.

    async def list(self, product_id: UUID) -> Sequence[CatalogRecord]:
        return sorted((r for r in self.rows.catalog.values() if r.workspace_id == self.workspace_id and r.product_id == product_id and product_id in self.rows.products.get(r.workspace_id, {})), key=lambda r: (r.kind, r.key))

    async def save(self, record: CatalogRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, record.workspace_id)
        if record.product_id not in self.rows.products.get(record.workspace_id, {}):
            raise LookupError('unknown Product')
        key = (record.workspace_id, record.product_id, record.kind, record.key)
        current = self.rows.catalog.get(key)
        if (current.version if current else 0) != expected_version:
            raise StaleVersion(record.key)
        self.rows.catalog[key] = record


class InMemoryStore:
    def __init__(self) -> None:
        self._committed = _Rows()
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def transaction(
        self, workspace_id: UUID | None = None, *, account_id: UUID | None = None
    ) -> AsyncIterator[Repositories]:
        async with self._lock:
            working = copy.deepcopy(self._committed)
            yield Repositories(
                workspaces=InMemoryWorkspacesRepository(working, workspace_id),
                products=InMemoryProductsRepository(working, workspace_id),
                members=InMemoryMembersRepository(working, workspace_id),
                accounts=InMemoryAccountsRepository(working),
                sessions=InMemorySessionsRepository(working),
                sign_in_flows=InMemorySignInFlowsRepository(working),
                catalog=InMemoryCatalogRepository(working, workspace_id),
                directory=InMemoryDirectoryRepository(working, account_id),
            )
            self._committed = working

    def mark_product_used(self, product_id: UUID) -> None:
        """Stand in for an Organization using the Product until Organizations exist (OPE-41)."""
        self._committed.used_products.add(product_id)

    async def ping(self) -> None:
        return None
