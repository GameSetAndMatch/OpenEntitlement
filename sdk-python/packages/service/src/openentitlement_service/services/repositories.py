"""Repository protocols the service layer needs (ADR-0009).

Implementations live in ``openentitlement_service.repositories``. Every repository is bound
to one Workspace by the transaction it was opened in: it can neither read nor write another
Workspace's rows.
"""
from __future__ import annotations

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from .models import Product, Workspace


class WorkspacesRepository(Protocol):
    async def add(self, workspace: Workspace) -> None: ...

    async def get(self) -> Workspace | None:
        """The Workspace this transaction is bound to, if it exists."""
        ...


class ProductsRepository(Protocol):
    async def add(self, product: Product) -> None: ...

    async def list(self) -> Sequence[Product]: ...


@dataclass(frozen=True)
class Repositories:
    """The repositories of one transaction, all bound to the same Workspace."""

    workspaces: WorkspacesRepository
    products: ProductsRepository


class Store(Protocol):
    """Opens transactions. Each one is bound to a single Workspace and commits on success."""

    def transaction(self, workspace_id: UUID) -> AbstractAsyncContextManager[Repositories]: ...

    async def ping(self) -> None:
        """Raise ``ServiceUnavailable`` when storage cannot be reached."""
        ...
