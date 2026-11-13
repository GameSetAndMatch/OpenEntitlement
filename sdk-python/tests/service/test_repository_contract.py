"""Repository contract: the same behavior from the in-memory and the Postgres implementations."""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from openentitlement_service.services.models import Product, Workspace
from openentitlement_service.services.repositories import AlreadyExists, Store

pytestmark = pytest.mark.anyio
NOW = datetime(2026, 11, 12, 9, 30, tzinfo=UTC)


def workspace(name: str = "ACME") -> Workspace:
    return Workspace(id=uuid4(), name=name, created_at=NOW)


def product(workspace_id: UUID, key: str, name: str | None = None) -> Product:
    return Product(id=uuid4(), workspace_id=workspace_id, key=key, name=name or key.title(), created_at=NOW)


async def given_workspace(store: Store, name: str = "ACME") -> Workspace:
    ws = workspace(name)
    async with store.transaction(ws.id) as repos:
        await repos.workspaces.add(ws)
    return ws


async def test_a_committed_workspace_is_read_back(store: Store) -> None:
    ws = await given_workspace(store)
    async with store.transaction(ws.id) as repos:
        assert await repos.workspaces.get() == ws


async def test_products_are_listed_by_key_within_their_workspace(store: Store) -> None:
    ws = await given_workspace(store)
    storage, analytics = product(ws.id, "storage"), product(ws.id, "analytics")
    async with store.transaction(ws.id) as repos:
        await repos.products.add(storage)
        await repos.products.add(analytics)
    async with store.transaction(ws.id) as repos:
        assert list(await repos.products.list()) == [analytics, storage]


async def test_a_workspace_never_sees_another_workspaces_rows(store: Store) -> None:
    acme, globex = await given_workspace(store, "ACME"), await given_workspace(store, "Globex")
    async with store.transaction(acme.id) as repos:
        await repos.products.add(product(acme.id, "analytics"))
    async with store.transaction(globex.id) as repos:
        assert await repos.workspaces.get() == globex
        assert list(await repos.products.list()) == []


async def test_a_transaction_cannot_write_another_workspaces_rows(store: Store) -> None:
    acme, globex = await given_workspace(store, "ACME"), await given_workspace(store, "Globex")
    with pytest.raises(PermissionError):
        async with store.transaction(globex.id) as repos:
            await repos.products.add(product(acme.id, "analytics"))
    async with store.transaction(acme.id) as repos:
        assert list(await repos.products.list()) == []


async def test_a_failed_transaction_leaves_nothing_behind(store: Store) -> None:
    ws = await given_workspace(store)
    with pytest.raises(RuntimeError):
        async with store.transaction(ws.id) as repos:
            await repos.products.add(product(ws.id, "analytics"))
            raise RuntimeError("the operation failed after writing")
    async with store.transaction(ws.id) as repos:
        assert list(await repos.products.list()) == []


async def test_a_product_key_is_unique_within_its_workspace(store: Store) -> None:
    acme, globex = await given_workspace(store, "ACME"), await given_workspace(store, "Globex")
    first = product(acme.id, "analytics")
    async with store.transaction(acme.id) as repos:
        await repos.products.add(first)
    with pytest.raises(AlreadyExists):
        async with store.transaction(acme.id) as repos:
            await repos.products.add(product(acme.id, "analytics", "Analytics again"))
    async with store.transaction(globex.id) as repos:
        await repos.products.add(product(globex.id, "analytics"))
    async with store.transaction(acme.id) as repos:
        assert list(await repos.products.list()) == [first]
