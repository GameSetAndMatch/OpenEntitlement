"""Repository protocols the service layer needs (ADR-0009).

Implementations live in ``openentitlement_service.repositories``. Every Workspace repository is
bound to one Workspace by the transaction it was opened in: it can neither read nor write another
Workspace's rows. Accounts, sessions and sign-in flows belong to no Workspace. The directory lists
the Workspaces of the Account a transaction is bound to.
"""
from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, TYPE_CHECKING
from uuid import UUID

from .models import (
    Account,
    Invitation,
    Member,
    Product,
    ProductMembership,
    Session,
    SignInFlow,
    Workspace,
    WorkspaceMembership,
)


if TYPE_CHECKING:
    from .api_keys import ApiKey
    from .audit import AuditEntry
    from .catalog import CatalogRecord, VariantValues
    from .organizations import ApplicationUserRecord, AssignmentRecord, OrganizationRecord
    from .tiers import StatusPolicyRecord, TierRecord


class CatalogRepository(Protocol):
    async def variants(self, product_id: UUID) -> Sequence[VariantValues]: ...

    async def save_variant(self, variant: VariantValues, *, expected_version: int) -> None: ...

    async def delete_variant(self, product_id: UUID, variant_id: str, *, expected_version: int) -> None:
        """Delete the variant, raising ``StaleVersion`` unless it is still at ``expected_version``."""
        ...

    async def lock(self, product_id: UUID) -> None:
        """Serialize the Product's Catalog and Tier writes until the transaction ends (the Product row lock)."""
        ...

    async def list(self, product_id: UUID) -> Sequence[CatalogRecord]: ...

    async def save(self, record: CatalogRecord, *, expected_version: int) -> None: ...


class TiersRepository(Protocol):
    """A Product's Tiers and status policy. Their variants live in ``CatalogRepository``."""

    async def list(self, product_id: UUID) -> Sequence[TierRecord]: ...

    async def save(self, tier: TierRecord, *, expected_version: int) -> None:
        """Insert (``expected_version`` 0) or replace the Tier, raising ``StaleVersion`` on another version."""
        ...

    async def delete(self, product_id: UUID, tier_id: str, *, expected_version: int) -> None: ...

    async def in_use(self, product_id: UUID, tier_id: str) -> bool:
        """Whether an Organization has one of the Tier's variants, which then cannot be deleted (ADR-0008)."""
        ...

    async def policy(self, product_id: UUID) -> StatusPolicyRecord | None: ...

    async def save_policy(self, policy: StatusPolicyRecord, *, expected_version: int) -> None: ...



class OrganizationsRepository(Protocol):
    """The Workspace's Organizations and their Tier variant in each Product (``AssignmentRecord``)."""

    async def list(self) -> Sequence[OrganizationRecord]: ...

    async def get(self, organization_id: str) -> OrganizationRecord | None: ...

    async def add(self, organization: OrganizationRecord) -> None:
        """Raise ``AlreadyExists`` when the Workspace already has an Organization with this ID."""
        ...

    async def update(self, organization: OrganizationRecord, *, expected_version: int) -> None:
        """Replace the Organization, raising ``StaleVersion`` unless it is still at ``expected_version``."""
        ...

    async def assignments(self, product_id: UUID | None = None) -> Sequence[AssignmentRecord]:
        """The Organizations' Tier variants, in one Product or in every Product."""
        ...

    async def assignment(self, product_id: UUID, organization_id: str) -> AssignmentRecord | None:
        """The Organization's Tier variant in the Product, if it has one."""
        ...

    async def user(self, product_id: UUID, organization_id: str, subject_id: str) -> ApplicationUserRecord | None:
        """One application user's record in the Product, if it has one."""
        ...

    async def save_assignment(self, assignment: AssignmentRecord, *, expected_version: int) -> None:
        """Insert (``expected_version`` 0) or replace, raising ``StaleVersion`` on another version.

        One per Organization per Product: a second insert raises ``AlreadyExists``.
        """
        ...

    async def users(self, product_id: UUID | None = None) -> Sequence[ApplicationUserRecord]:
        """Application users' Personal terms and Grants, in one Product or in every Product."""
        ...

    async def save_user(self, user: ApplicationUserRecord, *, expected_version: int) -> None:
        """Insert (``expected_version`` 0) or replace an application user's record in its Product.

        One per Organization, Subject ID and Product: a second insert raises ``AlreadyExists``;
        a replacement raises ``StaleVersion`` unless the record is still at ``expected_version``.
        """
        ...

    async def delete_user(self, user: ApplicationUserRecord, *, expected_version: int) -> None:
        """Delete the record, raising ``StaleVersion`` unless it is still at ``expected_version``."""
        ...


def ensure_bound_workspace(bound: UUID | None, record_workspace: UUID) -> None:
    """Refuse a record of another Workspace.

    A programming error, not a client error: callers build records for the Workspace they are
    bound to. It therefore surfaces as ``internal-error``. Row-level security is the second net.
    """
    if record_workspace != bound:
        raise PermissionError("a transaction can only write its own Workspace")


class AlreadyExists(Exception):
    """A record with the same unique key already exists, for example a Product key in its Workspace.

    The transaction that raised it is aborted. Operations translate it into a typed problem.
    """


class StaleVersion(Exception):
    """The record changed since the caller read it: its version is no longer the expected one."""


class WorkspacesRepository(Protocol):
    async def add(self, workspace: Workspace) -> None: ...

    async def get(self) -> Workspace | None:
        """The Workspace this transaction is bound to, if it exists."""
        ...

    async def lock(self) -> None:
        """Serialize changes to the Workspace's members, Owners, Product count and Cloud service tier.

        Held until the transaction ends. Acquire before checking an invariant such as "at least one
        Owner" or "Cloud Pro has one Product", so concurrent changes cannot both pass the check.
        """
        ...

    async def update(self, workspace: Workspace, *, expected_version: int) -> None:
        """Replace the Workspace's ``service_tier`` and ``version``, raising ``StaleVersion`` unless it is still at ``expected_version``."""
        ...


class ProductsRepository(Protocol):
    async def lock_deletion(self) -> None:
        """Serialize Product deletions in this Workspace until the transaction ends.

        Acquire before checking the remaining count, so concurrent deletes keep one Product.
        """
        ...

    async def add(self, product: Product) -> None:
        """Raise ``AlreadyExists`` when the Workspace already has a Product with this key."""
        ...

    async def list(self) -> Sequence[Product]:
        """Every Product of the Workspace, archived ones included, by key."""
        ...

    async def get(self, product_id: UUID) -> Product | None: ...

    async def update(self, product: Product, *, expected_version: int) -> None:
        """Replace the Product, raising ``StaleVersion`` unless it is still at ``expected_version``.

        Only ``name``, ``archived_at`` and ``version`` change; ``id`` and ``key`` never do.
        """
        ...

    async def delete(self, product_id: UUID, *, expected_version: int) -> None:
        """Delete the Product and its Roles, raising ``StaleVersion`` as ``update`` does."""
        ...

    async def in_use(self, product_id: UUID) -> bool:
        """Whether an Organization has a Tier variant of the Product, which then cannot be deleted (ADR-0008)."""
        ...


class MembersRepository(Protocol):
    async def add(self, member: Member) -> None:
        """Raise ``AlreadyExists`` when the Account is already a member."""
        ...

    async def get(self, account_id: UUID) -> Member | None: ...

    async def set_product_role(self, membership: ProductMembership) -> None:
        """Give the member this Role in the Product, replacing any Role they had there."""
        ...

    async def product_roles(self, account_id: UUID) -> Sequence[ProductMembership]: ...

    async def list(self) -> Sequence[Member]:
        """Every member of the Workspace, by Account ID."""
        ...

    async def all_product_roles(self) -> Sequence[ProductMembership]:
        """Every member's Roles in every Product of the Workspace."""
        ...

    async def set_owner(self, account_id: UUID, owner: bool) -> None:
        """Make the member an Owner, or no longer one. Their Product Roles are kept."""
        ...

    async def remove_product_role(self, product_id: UUID, account_id: UUID) -> None:
        """Remove the member's Role in the Product, if they have one."""
        ...

    async def remove(self, account_id: UUID) -> None:
        """Remove the member and all their Product Roles from the Workspace."""
        ...


class ApiKeysRepository(Protocol):
    """The Workspace's API keys (OPE-42). A key goes with its Product."""

    async def list(self, product_id: UUID) -> Sequence[ApiKey]: ...

    async def add(self, key: ApiKey) -> None: ...

    async def get(self, key_id: UUID) -> ApiKey | None: ...

    async def find(self, token_hash: str) -> ApiKey | None:
        """The key whose secret has this SHA-256 hash, if it exists (and was not revoked)."""
        ...

    async def delete(self, key_id: UUID) -> None: ...


class InvitationsRepository(Protocol):
    async def add(self, invitation: Invitation, *, now: datetime) -> None:
        """Save the invitation and forget the Workspace's invitations that expired before ``now``."""
        ...

    async def take(self, token_hash: str, *, now: datetime) -> Invitation | None:
        """Remove and return the invitation, unless it does not exist or expired. An invitation is used once."""
        ...


class AuditRepository(Protocol):
    """The Workspace's Audit log (ADR-0007). Entries are only ever added."""

    async def add(self, entry: AuditEntry) -> None: ...

    async def list(
        self, *, managed: frozenset[UUID] | None, limit: int, before: int | None = None
    ) -> Sequence[tuple[int, AuditEntry]]:
        """Up to ``limit`` entries, newest first, each with its position in write order.

        Only those a Manager of ``managed`` may read (``AuditEntry.visible_to``), or every entry when
        ``managed`` is ``None``; and only those written before position ``before``, when given.
        """
        ...


class AccountsRepository(Protocol):
    async def sign_in(self, account: Account) -> Account:
        """The Account of ``account``'s issuer and subject, created the first time.

        An existing Account keeps its ID and creation time; its email is updated, and it stays a
        Platform administrator once it is one.
        """
        ...

    async def get(self, account_id: UUID) -> Account | None: ...


class SessionsRepository(Protocol):
    async def add(self, session: Session) -> None: ...

    async def get(self, token_hash: str, *, now: datetime) -> Session | None:
        """The session, unless it does not exist or expired before ``now``."""
        ...

    async def delete(self, token_hash: str) -> None: ...


class SignInFlowsRepository(Protocol):
    async def add(self, flow: SignInFlow, *, now: datetime) -> None:
        """Save the flow and forget flows that expired before ``now``."""
        ...

    async def take(self, flow_hash: str, *, now: datetime) -> SignInFlow | None:
        """Remove and return the flow, unless it does not exist or expired. A flow is used once."""
        ...


class DirectoryRepository(Protocol):
    async def memberships(self) -> Sequence[WorkspaceMembership]:
        """The Workspaces where the transaction's Account is a member, by name."""
        ...

    async def every_workspace(self) -> Sequence[Workspace]:
        """Every Workspace by name, when the transaction's Account is a Platform administrator; else none."""
        ...


@dataclass(frozen=True)
class Repositories:
    """The repositories of one transaction.

    Workspace repositories are bound to the transaction's Workspace; the directory to its Account.
    """

    workspaces: WorkspacesRepository
    products: ProductsRepository
    members: MembersRepository
    accounts: AccountsRepository
    sessions: SessionsRepository
    sign_in_flows: SignInFlowsRepository
    catalog: CatalogRepository
    tiers: TiersRepository
    organizations: OrganizationsRepository
    directory: DirectoryRepository
    invitations: InvitationsRepository
    audit: AuditRepository
    api_keys: ApiKeysRepository


class Store(Protocol):
    """Opens transactions, which commit on success and roll back on failure."""

    def transaction(
        self, workspace_id: UUID | None = None, *, account_id: UUID | None = None
    ) -> AbstractAsyncContextManager[Repositories]:
        """A transaction bound to one Workspace (or none) and, for the directory, one Account (or none)."""
        ...

    async def ping(self) -> None:
        """Raise ``ServiceUnavailable`` when storage cannot be reached."""
        ...
