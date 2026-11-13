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
from typing import Protocol
from uuid import UUID

from .models import (
    Account,
    Member,
    Product,
    ProductMembership,
    Session,
    SignInFlow,
    Workspace,
    WorkspaceMembership,
)


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


class ProductsRepository(Protocol):
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
        """Whether an Organization uses the Product, which then cannot be deleted (ADR-0008)."""
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
    directory: DirectoryRepository


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
