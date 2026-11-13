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
from ...services.organizations import ApplicationUserRecord, AssignmentRecord, OrganizationChange, OrganizationRecord
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
from ...services.repositories import AlreadyExists, Repositories, StaleVersion, ensure_bound_workspace


@dataclass
class _Rows:
    variant_values: dict[tuple[UUID, UUID, str], VariantValues] = field(default_factory=dict)
    tiers: dict[tuple[UUID, UUID, str], TierRecord] = field(default_factory=dict)
    status_policies: dict[tuple[UUID, UUID], StatusPolicyRecord] = field(default_factory=dict)
    tier_changes: list[TierChange] = field(default_factory=list)
    organizations: dict[tuple[UUID, str], OrganizationRecord] = field(default_factory=dict)
    #: (Workspace, Product, Organization) → the Organization's Tier variant in that Product.
    assignments: dict[tuple[UUID, UUID, str], AssignmentRecord] = field(default_factory=dict)
    organization_changes: list[OrganizationChange] = field(default_factory=list)
    #: (Workspace, Product, Organization, Subject ID) → the application user's record in that Product.
    users: dict[tuple[UUID, UUID, str, str], ApplicationUserRecord] = field(default_factory=dict)
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
    #: Workspace → token hash → Invitation.
    invitations: dict[UUID, dict[str, Invitation]] = field(default_factory=dict)
    settings_changes: list[SettingsChange] = field(default_factory=list)


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

    async def lock(self) -> None:
        pass  # The store serializes transactions.

    async def update(self, workspace: Workspace, *, expected_version: int) -> None:
        ensure_bound_workspace(self._workspace_id, workspace.id)
        current = self._rows.workspaces.get(workspace.id)
        if current is None or current.version != expected_version:
            raise StaleVersion(f"workspace {workspace.id}")
        update = {"service_tier": workspace.service_tier, "version": workspace.version}
        self._rows.workspaces[workspace.id] = current.model_copy(update=update)


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
        invitations = self._rows.invitations.get(self._workspace_id, {}) if self._workspace_id else {}
        for token_hash in [k for k, i in invitations.items() if i.product_id == product_id]:
            del invitations[token_hash]

    async def in_use(self, product_id: UUID) -> bool:
        return any(k[:2] == (self._workspace_id, product_id) for k in self._rows.assignments)


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
        return [m for m in await self.all_product_roles() if m.account_id == account_id]

    def _members(self) -> dict[UUID, Member]:
        return self._rows.members.get(self._workspace_id, {}) if self._workspace_id else {}

    def _roles(self) -> dict[tuple[UUID, UUID], ProductMembership]:
        return self._rows.product_roles.get(self._workspace_id, {}) if self._workspace_id else {}

    async def list(self) -> Sequence[Member]:
        return sorted(self._members().values(), key=lambda m: str(m.account_id))

    async def all_product_roles(self) -> Sequence[ProductMembership]:
        return sorted(self._roles().values(), key=lambda m: (str(m.product_id), str(m.account_id)))

    async def set_owner(self, account_id: UUID, owner: bool) -> None:
        members = self._members()
        if account_id not in members:
            raise LookupError(f"member {account_id}")
        members[account_id] = members[account_id].model_copy(update={"owner": owner})

    async def remove_product_role(self, product_id: UUID, account_id: UUID) -> None:
        self._roles().pop((product_id, account_id), None)

    async def remove(self, account_id: UUID) -> None:
        self._members().pop(account_id, None)
        roles = self._roles()
        for key in [k for k in roles if k[1] == account_id]:
            del roles[key]


class InMemoryInvitationsRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self._rows, self._workspace_id = rows, workspace_id

    def _own(self) -> dict[str, Invitation]:
        return self._rows.invitations.setdefault(self._workspace_id, {}) if self._workspace_id else {}

    async def add(self, invitation: Invitation, *, now: datetime) -> None:
        ensure_bound_workspace(self._workspace_id, invitation.workspace_id)
        own = self._own()
        for key in [k for k, i in own.items() if i.expires_at <= now]:
            del own[key]
        if invitation.token_hash in own:
            raise AlreadyExists("invitation")
        own[invitation.token_hash] = invitation

    async def take(self, token_hash: str, *, now: datetime) -> Invitation | None:
        invitation = self._own().pop(token_hash, None)
        return invitation if invitation and invitation.expires_at > now else None


class InMemorySettingsChangesRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self._rows, self._workspace_id = rows, workspace_id

    async def add(self, change: SettingsChange) -> None:
        ensure_bound_workspace(self._workspace_id, change.workspace_id)
        self._rows.settings_changes.append(change)

    async def list(self) -> Sequence[SettingsChange]:
        return [c for c in self._rows.settings_changes if c.workspace_id == self._workspace_id]


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

    async def delete_variant(self, product_id: UUID, variant_id: str, *, expected_version: int) -> None:
        if self.workspace_id is None:
            raise StaleVersion(variant_id)
        key = (self.workspace_id, product_id, variant_id)
        current = self.rows.variant_values.get(key)
        if current is None or current.version != expected_version:
            raise StaleVersion(variant_id)
        del self.rows.variant_values[key]

    async def audit(self, change: CatalogChange) -> None:
        ensure_bound_workspace(self.workspace_id, change.workspace_id)
        self.rows.catalog_changes.append(change)

    async def changes(self, product_id: UUID) -> Sequence[CatalogChange]:
        return [c for c in self.rows.catalog_changes if (c.workspace_id, c.product_id) == (self.workspace_id, product_id)]

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


class InMemoryTiersRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self.rows, self.workspace_id = rows, workspace_id

    def _visible(self, product_id: UUID) -> bool:
        return self.workspace_id is not None and product_id in self.rows.products.get(self.workspace_id, {})

    async def list(self, product_id: UUID) -> Sequence[TierRecord]:
        if not self._visible(product_id):
            return []
        return sorted((t for (w, p, _), t in self.rows.tiers.items() if (w, p) == (self.workspace_id, product_id)), key=lambda t: t.id)

    async def save(self, tier: TierRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, tier.workspace_id)
        if not self._visible(tier.product_id):
            raise LookupError("unknown Product")
        key = (tier.workspace_id, tier.product_id, tier.id)
        current = self.rows.tiers.get(key)
        if current is None and expected_version == 0:
            self.rows.tiers[key] = tier
        elif current is not None and current.version == expected_version:
            self.rows.tiers[key] = tier
        elif current is not None and expected_version == 0:
            raise AlreadyExists(tier.id)
        else:
            raise StaleVersion(tier.id)

    async def delete(self, product_id: UUID, tier_id: str, *, expected_version: int) -> None:
        if self.workspace_id is None:
            raise StaleVersion(tier_id)
        key = (self.workspace_id, product_id, tier_id)
        current = self.rows.tiers.get(key)
        if current is None or current.version != expected_version:
            raise StaleVersion(tier_id)
        del self.rows.tiers[key]

    async def in_use(self, product_id: UUID, tier_id: str) -> bool:
        return any(
            a.tier_id == tier_id
            for (w, p, _), a in self.rows.assignments.items()
            if (w, p) == (self.workspace_id, product_id)
        )

    async def policy(self, product_id: UUID) -> StatusPolicyRecord | None:
        if self.workspace_id is None or not self._visible(product_id):
            return None
        return self.rows.status_policies.get((self.workspace_id, product_id))

    async def save_policy(self, policy: StatusPolicyRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, policy.workspace_id)
        key = (policy.workspace_id, policy.product_id)
        current = self.rows.status_policies.get(key)
        if (current.version if current else 0) != expected_version:
            raise StaleVersion(str(policy.product_id))
        self.rows.status_policies[key] = policy

    async def audit(self, change: TierChange) -> None:
        ensure_bound_workspace(self.workspace_id, change.workspace_id)
        self.rows.tier_changes.append(change)

    async def changes(self, product_id: UUID) -> Sequence[TierChange]:
        return [c for c in self.rows.tier_changes if (c.workspace_id, c.product_id) == (self.workspace_id, product_id)]


class InMemoryOrganizationsRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID | None) -> None:
        self.rows, self.workspace_id = rows, workspace_id

    async def list(self) -> Sequence[OrganizationRecord]:
        return sorted((o for (w, _), o in self.rows.organizations.items() if w == self.workspace_id), key=lambda o: o.id)

    async def get(self, organization_id: str) -> OrganizationRecord | None:
        if self.workspace_id is None:
            return None
        return self.rows.organizations.get((self.workspace_id, organization_id))

    async def add(self, organization: OrganizationRecord) -> None:
        ensure_bound_workspace(self.workspace_id, organization.workspace_id)
        key = (organization.workspace_id, organization.id)
        if key in self.rows.organizations:
            raise AlreadyExists(organization.id)
        self.rows.organizations[key] = organization

    async def update(self, organization: OrganizationRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, organization.workspace_id)
        key = (organization.workspace_id, organization.id)
        current = self.rows.organizations.get(key)
        if current is None or current.version != expected_version:
            raise StaleVersion(organization.id)
        self.rows.organizations[key] = organization

    async def assignments(self, product_id: UUID | None = None) -> Sequence[AssignmentRecord]:
        found = (
            a
            for (w, p, _), a in self.rows.assignments.items()
            if w == self.workspace_id and (product_id is None or p == product_id)
        )
        return sorted(found, key=lambda a: (str(a.product_id), a.organization_id))

    async def save_assignment(self, assignment: AssignmentRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, assignment.workspace_id)
        if assignment.product_id not in self.rows.products.get(assignment.workspace_id, {}):
            raise LookupError("unknown Product")
        if (assignment.workspace_id, assignment.organization_id) not in self.rows.organizations:
            raise LookupError("unknown Organization")
        key = (assignment.workspace_id, assignment.product_id, assignment.organization_id)
        current = self.rows.assignments.get(key)
        if current is not None and expected_version == 0:
            raise AlreadyExists(assignment.organization_id)
        if (current.version if current else 0) != expected_version:
            raise StaleVersion(assignment.organization_id)
        self.rows.assignments[key] = assignment

    async def users(self, product_id: UUID | None = None) -> Sequence[ApplicationUserRecord]:
        found = (
            u
            for (w, p, _, _), u in self.rows.users.items()
            if w == self.workspace_id and (product_id is None or p == product_id)
        )
        return sorted(found, key=lambda u: (str(u.product_id), u.organization_id, u.subject_id))

    async def save_user(self, user: ApplicationUserRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, user.workspace_id)
        if (user.workspace_id, user.product_id, user.organization_id) not in self.rows.assignments:
            raise LookupError("the Organization has no Tier variant in this Product")
        key = (user.workspace_id, user.product_id, user.organization_id, user.subject_id)
        current = self.rows.users.get(key)
        if current is not None and expected_version == 0:
            raise AlreadyExists(user.subject_id)
        if (current.version if current else 0) != expected_version:
            raise StaleVersion(user.subject_id)
        self.rows.users[key] = user

    async def delete_user(self, user: ApplicationUserRecord, *, expected_version: int) -> None:
        ensure_bound_workspace(self.workspace_id, user.workspace_id)
        key = (user.workspace_id, user.product_id, user.organization_id, user.subject_id)
        current = self.rows.users.get(key)
        if current is None or current.version != expected_version:
            raise StaleVersion(user.subject_id)
        del self.rows.users[key]

    async def audit(self, change: OrganizationChange) -> None:
        ensure_bound_workspace(self.workspace_id, change.workspace_id)
        self.rows.organization_changes.append(change)

    async def changes(self) -> Sequence[OrganizationChange]:
        return [c for c in self.rows.organization_changes if c.workspace_id == self.workspace_id]


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
                tiers=InMemoryTiersRepository(working, workspace_id),
                organizations=InMemoryOrganizationsRepository(working, workspace_id),
                directory=InMemoryDirectoryRepository(working, account_id),
                invitations=InMemoryInvitationsRepository(working, workspace_id),
                settings_changes=InMemorySettingsChangesRepository(working, workspace_id),
            )
            self._committed = working

    async def ping(self) -> None:
        return None
