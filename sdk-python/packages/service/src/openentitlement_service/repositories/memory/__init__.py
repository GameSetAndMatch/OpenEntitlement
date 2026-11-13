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
from uuid import UUID

from ...services.models import Product, Workspace
from ...services.repositories import Repositories, ensure_bound_workspace


@dataclass
class _Rows:
    workspaces: dict[UUID, Workspace] = field(default_factory=dict)
    products: dict[UUID, dict[UUID, Product]] = field(default_factory=dict)


class InMemoryWorkspacesRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID) -> None:
        self._rows, self._workspace_id = rows, workspace_id

    async def add(self, workspace: Workspace) -> None:
        ensure_bound_workspace(self._workspace_id, workspace.id)
        self._rows.workspaces[workspace.id] = workspace

    async def get(self) -> Workspace | None:
        return self._rows.workspaces.get(self._workspace_id)


class InMemoryProductsRepository:
    def __init__(self, rows: _Rows, workspace_id: UUID) -> None:
        self._rows, self._workspace_id = rows, workspace_id

    async def add(self, product: Product) -> None:
        ensure_bound_workspace(self._workspace_id, product.workspace_id)
        self._rows.products.setdefault(self._workspace_id, {})[product.id] = product

    async def list(self) -> Sequence[Product]:
        return sorted(self._rows.products.get(self._workspace_id, {}).values(), key=lambda p: p.key)


class InMemoryStore:
    def __init__(self) -> None:
        self._committed = _Rows()
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def transaction(self, workspace_id: UUID) -> AsyncIterator[Repositories]:
        async with self._lock:
            working = copy.deepcopy(self._committed)
            yield Repositories(
                workspaces=InMemoryWorkspacesRepository(working, workspace_id),
                products=InMemoryProductsRepository(working, workspace_id),
            )
            self._committed = working

    async def ping(self) -> None:
        return None
