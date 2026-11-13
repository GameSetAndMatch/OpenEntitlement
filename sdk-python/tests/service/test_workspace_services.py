"""Service layer with in-memory repositories: Workspaces, Products and every Role × operation (ADR-0008)."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.services.models import Account, ProductMembership, ProductRole
from openentitlement_service.services.problems import (
    AlreadyTaken,
    LastProduct,
    NotFound,
    PermissionDenied,
    ProductInUse,
    RevisionConflict,
    ValidationFailed,
)
from openentitlement_service.services.workspaces import OpenWorkspace, ProductView, WorkspaceService

pytestmark = pytest.mark.anyio
NOW = datetime(2026, 11, 13, 9, 30, tzinfo=UTC)


async def account(store: InMemoryStore, subject: str, *, admin: bool = False) -> Account:
    async with store.transaction() as repos:
        return await repos.accounts.sign_in(
            Account(id=uuid4(), issuer="https://id.test", subject=subject, email=f"{subject}@acme.test",
                    platform_admin=admin, created_at=NOW)
        )


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore()


@pytest.fixture
def service(store: InMemoryStore) -> WorkspaceService:
    return WorkspaceService(store, clock=lambda: NOW)


# Creating, listing and opening Workspaces.


async def test_creating_a_workspace_makes_its_creator_owner_of_its_first_product(store: InMemoryStore, service: WorkspaceService) -> None:
    alice = await account(store, "alice")
    created = await service.create_workspace(alice, "Acme analytics")
    assert created.name == "Acme analytics" and created.role == "Owner"
    assert [(p.key, p.name, p.role) for p in created.products] == [("acme_analytics", "Acme analytics", "Owner")]
    assert [(w.id, w.name, w.role) for w in await service.list_workspaces(alice)] == [(created.id, "Acme analytics", "Owner")]


@pytest.mark.parametrize(
    ("name", "key"),
    [("Storage", "storage"), ("  Big   Data 2 ", "big_data_2"), ("2048 Games", "product_2048_games"), ("Éclair", "eclair"), ("日本", "product")],
)
async def test_the_first_product_key_comes_from_the_workspace_name(store: InMemoryStore, service: WorkspaceService, name: str, key: str) -> None:
    created = await service.create_workspace(await account(store, "alice"), name)
    assert created.products[0].key == key


@pytest.mark.parametrize("name", ["", "   ", "x" * 201])
async def test_a_workspace_needs_a_name(store: InMemoryStore, service: WorkspaceService, name: str) -> None:
    with pytest.raises(ValidationFailed) as refused:
        await service.create_workspace(await account(store, "alice"), name)
    assert refused.value.params["errors"][0]["pointer"] == "/name"


async def test_a_workspace_is_listed_with_the_members_highest_role(store: InMemoryStore, service: WorkspaceService) -> None:
    alice, bob = await account(store, "alice"), await account(store, "bob")
    acme = await service.create_workspace(alice, "Acme")
    async with service.open(alice, acme.id) as ws:
        storage = await service.create_product(ws, key="storage", name="Storage")
    await grant(store, acme.id, bob, {acme.products[0].id: ProductRole.USER, storage.id: ProductRole.MANAGER})
    assert [(w.name, w.role) for w in await service.list_workspaces(bob)] == [("Acme", "Manager")]


async def test_a_platform_administrator_lists_every_workspace(store: InMemoryStore, service: WorkspaceService) -> None:
    alice, root = await account(store, "alice"), await account(store, "root", admin=True)
    await service.create_workspace(alice, "Globex")
    await service.create_workspace(root, "Acme")
    assert [(w.name, w.role) for w in await service.list_workspaces(root)] == [("Acme", "Owner"), ("Globex", "Platform administrator")]


async def test_a_workspace_is_not_found_for_someone_who_is_not_a_member(store: InMemoryStore, service: WorkspaceService) -> None:
    alice, mallory = await account(store, "alice"), await account(store, "mallory")
    acme = await service.create_workspace(alice, "Acme")
    for workspace_id in (acme.id, uuid4()):
        with pytest.raises(NotFound):
            async with service.open(mallory, workspace_id):
                pass
    assert await service.list_workspaces(mallory) == []


# Every Role × operation. The Workspace has two Products, Analytics and Storage.


@dataclass
class Scene:
    service: WorkspaceService
    workspace_id: UUID
    analytics: ProductView
    storage: ProductView
    people: dict[str, Account]


async def grant(store: InMemoryStore, workspace_id: UUID, who: Account, roles: dict[UUID, ProductRole]) -> None:
    from openentitlement_service.services.models import Member

    async with store.transaction(workspace_id) as repos:
        if await repos.members.get(who.id) is None:
            await repos.members.add(Member(workspace_id=workspace_id, account_id=who.id, created_at=NOW))
        for product_id, role in roles.items():
            await repos.members.set_product_role(
                ProductMembership(workspace_id=workspace_id, product_id=product_id, account_id=who.id, role=role)
            )


@pytest.fixture
async def scene(store: InMemoryStore, service: WorkspaceService) -> Scene:
    people = {name: await account(store, name) for name in ("owner", "manager", "user", "storage_manager", "member_without_role", "outsider")}
    people["platform_admin"] = await account(store, "root", admin=True)
    created = await service.create_workspace(people["owner"], "Acme")
    async with service.open(people["owner"], created.id) as ws:
        analytics = await service.rename_product(ws, created.products[0].id, name="Analytics", version=1)
        storage = await service.create_product(ws, key="storage", name="Storage")
    await grant(store, created.id, people["manager"], {analytics.id: ProductRole.MANAGER, storage.id: ProductRole.USER})
    await grant(store, created.id, people["user"], {analytics.id: ProductRole.USER})
    await grant(store, created.id, people["storage_manager"], {storage.id: ProductRole.MANAGER})
    await grant(store, created.id, people["member_without_role"], {})
    return Scene(service, created.id, analytics, storage, people)


ROLES = ["owner", "platform_admin", "manager", "user", "storage_manager", "member_without_role"]


@pytest.mark.parametrize(
    ("who", "role", "products"),
    [
        ("owner", "Owner", {"acme": "Owner", "storage": "Owner"}),
        ("platform_admin", "Platform administrator", {"acme": "Platform administrator", "storage": "Platform administrator"}),
        ("manager", "Manager", {"acme": "Manager", "storage": "User"}),
        ("user", "User", {"acme": "User"}),
        ("storage_manager", "Manager", {"storage": "Manager"}),
        ("member_without_role", "Member", {}),
    ],
)
async def test_each_role_sees_only_the_products_where_it_has_a_role(scene: Scene, who: str, role: str, products: dict[str, str]) -> None:
    async with scene.service.open(scene.people[who], scene.workspace_id) as ws:
        view = await scene.service.view(ws)
    assert view.role == role
    assert {p.key: p.role for p in view.products} == products


async def test_outsiders_cannot_open_the_workspace(scene: Scene) -> None:
    with pytest.raises(NotFound):
        async with scene.service.open(scene.people["outsider"], scene.workspace_id):
            pass


Operation = Callable[[WorkspaceService, OpenWorkspace, Scene], Awaitable[object]]

OPERATIONS: dict[str, Operation] = {
    "read Analytics": lambda s, ws, sc: s.get_product(ws, sc.analytics.id),
    "create a Product": lambda s, ws, sc: s.create_product(ws, key="billing", name="Billing"),
    "rename Analytics": lambda s, ws, sc: s.rename_product(ws, sc.analytics.id, name="Insights", version=sc.analytics.version),
    "archive Analytics": lambda s, ws, sc: s.archive_product(ws, sc.analytics.id, version=sc.analytics.version),
    "restore Analytics": lambda s, ws, sc: s.restore_product(ws, sc.analytics.id, version=sc.analytics.version),
    "delete Analytics": lambda s, ws, sc: s.delete_product(ws, sc.analytics.id, version=sc.analytics.version),
}

#: What each Role may do. Anything else is refused: NotFound when the Product is invisible to it,
#: PermissionDenied otherwise.
ALLOWED = {
    "owner": set(OPERATIONS),
    "platform_admin": set(OPERATIONS),
    "manager": {"read Analytics"},
    "user": {"read Analytics"},
    "storage_manager": set(),
    "member_without_role": set(),
}
SEES_ANALYTICS = {"owner", "platform_admin", "manager", "user"}


@pytest.mark.parametrize("operation", list(OPERATIONS))
@pytest.mark.parametrize("who", ROLES)
async def test_every_role_and_operation(scene: Scene, who: str, operation: str) -> None:
    act = OPERATIONS[operation]
    if operation in ALLOWED[who]:
        async with scene.service.open(scene.people[who], scene.workspace_id) as ws:
            await act(scene.service, ws, scene)
        return
    names_analytics = operation != "create a Product"
    expected: type[Exception] = NotFound if names_analytics and who not in SEES_ANALYTICS else PermissionDenied
    with pytest.raises(expected):
        async with scene.service.open(scene.people[who], scene.workspace_id) as ws:
            await act(scene.service, ws, scene)


# Product rules.


async def test_a_renamed_product_keeps_its_id_and_key(scene: Scene) -> None:
    async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
        renamed = await scene.service.rename_product(ws, scene.analytics.id, name="Insights", version=scene.analytics.version)
    assert (renamed.id, renamed.key, renamed.name, renamed.version) == (scene.analytics.id, "acme", "Insights", scene.analytics.version + 1)


async def test_an_old_version_is_a_revision_conflict(scene: Scene) -> None:
    async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
        await scene.service.rename_product(ws, scene.analytics.id, name="Insights", version=scene.analytics.version)
    with pytest.raises(RevisionConflict) as conflict:
        async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
            await scene.service.archive_product(ws, scene.analytics.id, version=scene.analytics.version)
    assert conflict.value.params == {"kind": "Product", "id": str(scene.analytics.id)}


async def test_archiving_and_restoring_a_product(scene: Scene) -> None:
    owner = scene.people["owner"]
    async with scene.service.open(owner, scene.workspace_id) as ws:
        archived = await scene.service.archive_product(ws, scene.storage.id, version=scene.storage.version)
    assert archived.archived_at == NOW
    async with scene.service.open(scene.people["storage_manager"], scene.workspace_id) as ws:
        assert [p.key for p in (await scene.service.view(ws)).products] == ["storage"], "an archived Product stays visible"
    async with scene.service.open(owner, scene.workspace_id) as ws:
        restored = await scene.service.restore_product(ws, scene.storage.id, version=archived.version)
    assert restored.archived_at is None


async def test_a_product_key_is_unique_and_well_formed(scene: Scene) -> None:
    async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
        with pytest.raises(AlreadyTaken):
            await scene.service.create_product(ws, key="storage", name="Storage again")
    for key in ("Storage", "1st", "with-dash", ""):
        async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
            with pytest.raises(ValidationFailed) as refused:
                await scene.service.create_product(ws, key=key, name="Fine")
        assert refused.value.params["errors"][0]["pointer"] == "/key"


async def test_a_product_that_customers_use_cannot_be_deleted(store: InMemoryStore, scene: Scene) -> None:
    store.mark_product_used(scene.storage.id)
    with pytest.raises(ProductInUse):
        async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
            await scene.service.delete_product(ws, scene.storage.id, version=scene.storage.version)


async def test_deleting_a_product_removes_it_and_its_roles(scene: Scene) -> None:
    async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
        await scene.service.delete_product(ws, scene.storage.id, version=scene.storage.version)
    async with scene.service.open(scene.people["storage_manager"], scene.workspace_id) as ws:
        assert (await scene.service.view(ws)).products == ()
    with pytest.raises(NotFound):
        async with scene.service.open(scene.people["owner"], scene.workspace_id) as ws:
            await scene.service.get_product(ws, scene.storage.id)


async def test_the_last_product_cannot_be_deleted(store: InMemoryStore, service: WorkspaceService) -> None:
    alice = await account(store, "alice")
    created = await service.create_workspace(alice, "Acme")
    with pytest.raises(LastProduct):
        async with service.open(alice, created.id) as ws:
            await service.delete_product(ws, created.products[0].id, version=1)
