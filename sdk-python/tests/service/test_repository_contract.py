"""Repository contract: the same behavior from the in-memory and the Postgres implementations."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from openentitlement_service.services.models import (
    Account,
    Member,
    Product,
    ProductMembership,
    ProductRole,
    Session,
    SignInFlow,
    Workspace,
    WorkspaceMembership,
)
from openentitlement_service.services.repositories import AlreadyExists, StaleVersion, Store

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


# Accounts, sessions and sign-in flows belong to no Workspace.


def account(subject: str = "alice", email: str = "alice@acme.test", *, admin: bool = False) -> Account:
    return Account(id=uuid4(), issuer="https://id.acme.test", subject=subject, email=email, platform_admin=admin, created_at=NOW)


async def test_signing_in_twice_keeps_one_account_and_updates_its_email(store: Store) -> None:
    async with store.transaction() as repos:
        first = await repos.accounts.sign_in(account(email="alice@acme.test"))
    async with store.transaction() as repos:
        again = await repos.accounts.sign_in(account(email="alice@globex.test"))
    assert again.id == first.id
    assert again.email == "alice@globex.test"
    async with store.transaction() as repos:
        assert await repos.accounts.get(first.id) == again


async def test_platform_administration_is_never_removed_by_signing_in(store: Store) -> None:
    async with store.transaction() as repos:
        await repos.accounts.sign_in(account(admin=True))
        assert (await repos.accounts.sign_in(account(admin=False))).platform_admin


async def test_the_same_subject_at_another_issuer_is_another_account(store: Store) -> None:
    async with store.transaction() as repos:
        here = await repos.accounts.sign_in(account())
        elsewhere = await repos.accounts.sign_in(account().model_copy(update={"issuer": "https://other.test"}))
    assert here.id != elsewhere.id


async def test_a_session_is_found_until_it_expires_or_is_deleted(store: Store) -> None:
    async with store.transaction() as repos:
        owner = await repos.accounts.sign_in(account())
        session = Session(token_hash="h1", account_id=owner.id, csrf="c1", expires_at=NOW + timedelta(hours=12))
        await repos.sessions.add(session)
    async with store.transaction() as repos:
        assert await repos.sessions.get("h1", now=NOW) == session
        assert await repos.sessions.get("h1", now=NOW + timedelta(hours=12)) is None
        assert await repos.sessions.get("other", now=NOW) is None
        await repos.sessions.delete("h1")
    async with store.transaction() as repos:
        assert await repos.sessions.get("h1", now=NOW) is None


def flow(flow_hash: str, expires_at: datetime) -> SignInFlow:
    return SignInFlow(flow_hash=flow_hash, state="s", nonce="n", verifier="v", expires_at=expires_at)


async def test_a_sign_in_flow_is_taken_once_and_never_after_it_expires(store: Store) -> None:
    async with store.transaction() as repos:
        await repos.sign_in_flows.add(flow("f1", NOW + timedelta(minutes=10)), now=NOW)
        await repos.sign_in_flows.add(flow("f2", NOW + timedelta(minutes=10)), now=NOW)
    async with store.transaction() as repos:
        assert await repos.sign_in_flows.take("f1", now=NOW) == flow("f1", NOW + timedelta(minutes=10))
        assert await repos.sign_in_flows.take("f1", now=NOW) is None
        assert await repos.sign_in_flows.take("f2", now=NOW + timedelta(minutes=10)) is None


# Members, Product roles and the directory.


async def given_account(store: Store, subject: str, *, admin: bool = False) -> Account:
    async with store.transaction() as repos:
        return await repos.accounts.sign_in(account(subject, f"{subject}@acme.test", admin=admin))


async def given_member(store: Store, ws: Workspace, who: Account, *, owner: bool = False) -> None:
    async with store.transaction(ws.id) as repos:
        await repos.members.add(Member(workspace_id=ws.id, account_id=who.id, owner=owner, created_at=NOW))


async def test_a_member_has_one_role_per_product(store: Store) -> None:
    ws, alice = await given_workspace(store), await given_account(store, "alice")
    analytics, storage = product(ws.id, "analytics"), product(ws.id, "storage")
    await given_member(store, ws, alice)
    async with store.transaction(ws.id) as repos:
        await repos.products.add(analytics)
        await repos.products.add(storage)
        await repos.members.set_product_role(ProductMembership(workspace_id=ws.id, product_id=analytics.id, account_id=alice.id, role=ProductRole.USER))
        await repos.members.set_product_role(ProductMembership(workspace_id=ws.id, product_id=analytics.id, account_id=alice.id, role=ProductRole.MANAGER))
        await repos.members.set_product_role(ProductMembership(workspace_id=ws.id, product_id=storage.id, account_id=alice.id, role=ProductRole.USER))
    async with store.transaction(ws.id) as repos:
        assert await repos.members.get(alice.id) == Member(workspace_id=ws.id, account_id=alice.id, owner=False, created_at=NOW)
        roles = {(m.product_id, m.role) for m in await repos.members.product_roles(alice.id)}
        assert roles == {(analytics.id, ProductRole.MANAGER), (storage.id, ProductRole.USER)}


async def test_an_account_is_a_member_once(store: Store) -> None:
    ws, alice = await given_workspace(store), await given_account(store, "alice")
    await given_member(store, ws, alice)
    with pytest.raises(AlreadyExists):
        await given_member(store, ws, alice, owner=True)


async def test_a_role_needs_a_member_and_a_product_of_the_workspace(store: Store) -> None:
    acme, globex = await given_workspace(store, "ACME"), await given_workspace(store, "Globex")
    alice = await given_account(store, "alice")
    theirs = product(globex.id, "analytics")
    async with store.transaction(globex.id) as repos:
        await repos.products.add(theirs)
    await given_member(store, acme, alice)
    with pytest.raises(LookupError):
        async with store.transaction(acme.id) as repos:
            role = ProductMembership(workspace_id=acme.id, product_id=theirs.id, account_id=alice.id, role=ProductRole.USER)
            await repos.members.set_product_role(role)


async def test_members_of_another_workspace_are_invisible(store: Store) -> None:
    acme, globex = await given_workspace(store, "ACME"), await given_workspace(store, "Globex")
    alice = await given_account(store, "alice")
    await given_member(store, acme, alice, owner=True)
    async with store.transaction(globex.id) as repos:
        assert await repos.members.get(alice.id) is None


async def test_the_directory_lists_only_the_accounts_workspaces_with_its_roles(store: Store) -> None:
    acme, globex, initech = [await given_workspace(store, n) for n in ("ACME", "Globex", "Initech")]
    alice, bob = await given_account(store, "alice"), await given_account(store, "bob")
    await given_member(store, globex, alice, owner=True)
    await given_member(store, acme, alice)
    await given_member(store, initech, bob, owner=True)
    analytics, storage = product(acme.id, "analytics"), product(acme.id, "storage")
    async with store.transaction(acme.id) as repos:
        await repos.products.add(analytics)
        await repos.products.add(storage)
        for p, role in ((analytics, ProductRole.USER), (storage, ProductRole.MANAGER)):
            await repos.members.set_product_role(ProductMembership(workspace_id=acme.id, product_id=p.id, account_id=alice.id, role=role))
    async with store.transaction(account_id=alice.id) as repos:
        assert list(await repos.directory.memberships()) == [
            WorkspaceMembership(workspace=acme, owner=False, roles=(ProductRole.MANAGER, ProductRole.USER)),
            WorkspaceMembership(workspace=globex, owner=True, roles=()),
        ]
        assert list(await repos.directory.every_workspace()) == []
    async with store.transaction() as repos:
        assert list(await repos.directory.memberships()) == []


async def test_a_platform_administrator_lists_every_workspace(store: Store) -> None:
    globex, acme = await given_workspace(store, "Globex"), await given_workspace(store, "ACME")
    admin = await given_account(store, "root", admin=True)
    async with store.transaction(account_id=admin.id) as repos:
        assert list(await repos.directory.every_workspace()) == [acme, globex]
        assert list(await repos.directory.memberships()) == []


# Products change by version; their ID and key never change.


async def test_a_product_is_renamed_and_archived_by_version(store: Store) -> None:
    ws = await given_workspace(store)
    analytics = product(ws.id, "analytics")
    async with store.transaction(ws.id) as repos:
        await repos.products.add(analytics)
    renamed = analytics.model_copy(update={"name": "Insights", "archived_at": NOW, "version": 2, "key": "ignored"})
    async with store.transaction(ws.id) as repos:
        await repos.products.update(renamed, expected_version=1)
    async with store.transaction(ws.id) as repos:
        assert await repos.products.get(analytics.id) == renamed.model_copy(update={"key": "analytics"})
    with pytest.raises(StaleVersion):
        async with store.transaction(ws.id) as repos:
            await repos.products.update(renamed.model_copy(update={"version": 3}), expected_version=1)


async def test_deleting_a_product_removes_its_roles(store: Store) -> None:
    ws, alice = await given_workspace(store), await given_account(store, "alice")
    analytics = product(ws.id, "analytics")
    await given_member(store, ws, alice)
    async with store.transaction(ws.id) as repos:
        await repos.products.add(analytics)
        await repos.members.set_product_role(ProductMembership(workspace_id=ws.id, product_id=analytics.id, account_id=alice.id, role=ProductRole.USER))
    with pytest.raises(StaleVersion):
        async with store.transaction(ws.id) as repos:
            await repos.products.delete(analytics.id, expected_version=2)
    async with store.transaction(ws.id) as repos:
        await repos.products.delete(analytics.id, expected_version=1)
    async with store.transaction(ws.id) as repos:
        assert await repos.products.get(analytics.id) is None
        assert await repos.products.in_use(analytics.id) is False
        assert list(await repos.members.product_roles(alice.id)) == []


async def test_another_workspaces_product_cannot_be_read_or_changed(store: Store) -> None:
    acme, globex = await given_workspace(store, "ACME"), await given_workspace(store, "Globex")
    analytics = product(acme.id, "analytics")
    async with store.transaction(acme.id) as repos:
        await repos.products.add(analytics)
    async with store.transaction(globex.id) as repos:
        assert await repos.products.get(analytics.id) is None
        with pytest.raises(StaleVersion):
            await repos.products.delete(analytics.id, expected_version=1)
