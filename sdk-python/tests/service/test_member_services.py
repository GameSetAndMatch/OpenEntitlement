"""Service layer with in-memory repositories: Members, invitations and the Cloud service tier (OPE-44, ADR-0008)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.services.members import InvitedRole, MemberService
from openentitlement_service.services.models import Account, Member, ProductMembership, ProductRole, ServiceTier
from openentitlement_service.services.problems import (
    InvitationForAnotherEmail,
    InvitationInvalid,
    LastOwner,
    NotFound,
    PermissionDenied,
    ProductLimit,
    RevisionConflict,
    ValidationFailed,
)
from openentitlement_service.services.workspaces import Deployment, ProductView, WorkspaceService

pytestmark = pytest.mark.anyio
NOW = datetime(2026, 11, 13, 9, 30, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


async def account(store: InMemoryStore, subject: str, *, admin: bool = False, email: str | None = None) -> Account:
    async with store.transaction() as repos:
        return await repos.accounts.sign_in(
            Account(id=uuid4(), issuer="https://id.test", subject=subject, email=email or f"{subject}@acme.test",
                    platform_admin=admin, created_at=NOW)
        )


async def grant(store: InMemoryStore, workspace_id: UUID, who: Account, roles: dict[UUID, ProductRole]) -> None:
    async with store.transaction(workspace_id) as repos:
        if await repos.members.get(who.id) is None:
            await repos.members.add(Member(workspace_id=workspace_id, account_id=who.id, created_at=NOW))
        for product_id, role in roles.items():
            await repos.members.set_product_role(
                ProductMembership(workspace_id=workspace_id, product_id=product_id, account_id=who.id, role=role)
            )


@dataclass
class Scene:
    store: InMemoryStore
    clock: Clock
    workspaces: WorkspaceService
    members: MemberService
    workspace_id: UUID
    analytics: ProductView
    storage: ProductView
    people: dict[str, Account]

    def open(self, who: str):  # type: ignore[no-untyped-def]
        return self.workspaces.open(self.people[who], self.workspace_id)

    async def listed(self, who: str) -> list[tuple[str, str, list[tuple[str, str]]]]:
        names = {self.analytics.id: "analytics", self.storage.id: "storage"}
        async with self.open(who) as ws:
            listed = await self.members.list_members(ws)
        return [(m.email.split("@")[0], m.role, [(names[r.product_id], r.role.value) for r in m.products]) for m in listed]

    async def invite(self, who: str, email: str, role: InvitedRole, product: ProductView | None = None) -> str:
        async with self.open(who) as ws:
            return (await self.members.invite(ws, email=email, role=role, product_id=product.id if product else None)).token


async def build_scene(deployment: Deployment = Deployment.SELF_HOSTED) -> Scene:
    store, clock = InMemoryStore(), Clock()
    workspaces = WorkspaceService(store, clock=clock, deployment=deployment)
    members = MemberService(store, clock=clock)
    people = {n: await account(store, n) for n in ("owner", "manager", "user", "storage_manager", "newcomer")}
    people["platform_admin"] = await account(store, "root", admin=True)
    created = await workspaces.create_workspace(people["owner"], "Analytics")
    analytics = created.products[0]
    if deployment is Deployment.SAAS:
        async with workspaces.open(people["platform_admin"], created.id) as ws:
            await workspaces.set_service_tier(ws, tier=ServiceTier.ENTERPRISE, version=1)
    async with workspaces.open(people["owner"], created.id) as ws:
        storage = await workspaces.create_product(ws, key="storage", name="Storage")
    await grant(store, created.id, people["manager"], {analytics.id: ProductRole.MANAGER, storage.id: ProductRole.USER})
    await grant(store, created.id, people["user"], {analytics.id: ProductRole.USER})
    await grant(store, created.id, people["storage_manager"], {storage.id: ProductRole.MANAGER})
    return Scene(store, clock, workspaces, members, created.id, analytics, storage, people)


@pytest.fixture
async def scene() -> Scene:
    return await build_scene()


# The Members list.


async def test_an_owner_sees_every_member_with_every_role(scene: Scene) -> None:
    assert await scene.listed("owner") == [
        ("manager", "Manager", [("analytics", "Manager"), ("storage", "User")]),
        ("owner", "Owner", []),
        ("storage_manager", "Manager", [("storage", "Manager")]),
        ("user", "User", [("analytics", "User")]),
    ]


async def test_a_manager_sees_the_owners_and_the_members_of_the_products_they_manage(scene: Scene) -> None:
    assert await scene.listed("manager") == [
        ("manager", "Manager", [("analytics", "Manager")]),
        ("owner", "Owner", []),
        ("user", "User", [("analytics", "User")]),
    ]
    assert await scene.listed("storage_manager") == [
        ("manager", "User", [("storage", "User")]),
        ("owner", "Owner", []),
        ("storage_manager", "Manager", [("storage", "Manager")]),
    ]


async def test_a_user_cannot_list_the_members(scene: Scene) -> None:
    with pytest.raises(PermissionDenied) as refused:
        await scene.listed("user")
    assert refused.value.params["permission"] == "members:manage"


# Invitations.


async def test_a_manager_invites_managers_and_users_to_their_product(scene: Scene) -> None:
    token = await scene.invite("manager", "newcomer@acme.test", InvitedRole.MANAGER, scene.analytics)
    joined = await scene.members.accept(scene.people["newcomer"], token)
    assert (joined.workspace_id, joined.already_member, joined.role) == (scene.workspace_id, False, "Manager")
    assert ("newcomer", "Manager", [("analytics", "Manager")]) in await scene.listed("owner")


@pytest.mark.parametrize(
    ("who", "role", "product", "problem"),
    [
        ("manager", InvitedRole.OWNER, None, PermissionDenied),
        ("manager", InvitedRole.USER, "storage", PermissionDenied),  # a User there
        ("storage_manager", InvitedRole.USER, "analytics", NotFound),  # no Role there
        ("user", InvitedRole.USER, "analytics", PermissionDenied),
    ],
)
async def test_invitations_are_limited_to_what_the_inviter_manages(
    scene: Scene, who: str, role: InvitedRole, product: str | None, problem: type[Exception]
) -> None:
    with pytest.raises(problem):
        await scene.invite(who, "newcomer@acme.test", role, getattr(scene, product) if product else None)


async def test_an_owner_invites_anyone_including_owners(scene: Scene) -> None:
    token = await scene.invite("owner", "newcomer@acme.test", InvitedRole.OWNER)
    assert (await scene.members.accept(scene.people["newcomer"], token)).role == "Owner"
    assert ("newcomer", "Owner", []) in await scene.listed("owner")
    storage_user = await scene.invite("owner", "Someone@Acme.test", InvitedRole.USER, scene.storage)
    assert storage_user.startswith(f"{scene.workspace_id}.")


@pytest.mark.parametrize(
    ("email", "role", "product", "pointer"),
    [
        ("not-an-email", InvitedRole.USER, True, "/email"),
        ("a@b.test", InvitedRole.USER, False, "/productId"),
        ("a@b.test", InvitedRole.OWNER, True, "/productId"),
    ],
)
async def test_an_invitation_needs_an_email_and_a_product_for_product_roles(
    scene: Scene, email: str, role: InvitedRole, product: bool, pointer: str
) -> None:
    with pytest.raises(ValidationFailed) as refused:
        await scene.invite("owner", email, role, scene.analytics if product else None)
    assert refused.value.params["errors"][0]["pointer"] == pointer


async def test_an_invitation_requires_the_invited_email_and_stays_usable_until_then(scene: Scene) -> None:
    token = await scene.invite("owner", "NewComer@acme.test", InvitedRole.USER, scene.analytics)
    with pytest.raises(InvitationForAnotherEmail):
        await scene.members.accept(scene.people["user"], token)
    assert (await scene.members.accept(scene.people["newcomer"], token)).role == "User"


async def test_an_invitation_works_once(scene: Scene) -> None:
    token = await scene.invite("owner", "newcomer@acme.test", InvitedRole.USER, scene.analytics)
    await scene.members.accept(scene.people["newcomer"], token)
    with pytest.raises(InvitationInvalid):
        await scene.members.accept(scene.people["newcomer"], token)


async def test_an_invitation_expires_after_seven_days(scene: Scene) -> None:
    token = await scene.invite("owner", "newcomer@acme.test", InvitedRole.USER, scene.analytics)
    scene.clock.now = NOW + timedelta(days=7)
    with pytest.raises(InvitationInvalid):
        await scene.members.accept(scene.people["newcomer"], token)


@pytest.mark.parametrize("token", ["", "garbage", f"{uuid4()}.secret", f"{uuid4()}."])
async def test_an_unknown_invitation_is_invalid(scene: Scene, token: str) -> None:
    with pytest.raises(InvitationInvalid):
        await scene.members.accept(scene.people["newcomer"], token)


async def test_an_invitation_to_another_product_adds_that_role_and_never_changes_an_existing_one(scene: Scene) -> None:
    added = await scene.invite("owner", "user@acme.test", InvitedRole.MANAGER, scene.storage)
    joined = await scene.members.accept(scene.people["user"], added)
    assert (joined.already_member, joined.role) == (False, "Manager")
    same_product = await scene.invite("owner", "user@acme.test", InvitedRole.MANAGER, scene.analytics)
    joined = await scene.members.accept(scene.people["user"], same_product)
    assert (joined.already_member, joined.role) == (True, "User")
    owner = await scene.invite("owner", "user@acme.test", InvitedRole.OWNER)
    assert (await scene.members.accept(scene.people["user"], owner)).already_member is True
    assert ("user", "Manager", [("analytics", "User"), ("storage", "Manager")]) in await scene.listed("owner")


async def test_an_invitation_to_a_deleted_product_is_invalid(scene: Scene) -> None:
    token = await scene.invite("owner", "newcomer@acme.test", InvitedRole.USER, scene.storage)
    async with scene.open("owner") as ws:
        await scene.workspaces.delete_product(ws, scene.storage.id, version=scene.storage.version)
    with pytest.raises(InvitationInvalid):
        await scene.members.accept(scene.people["newcomer"], token)


# Changing Roles and removing members.


async def test_a_manager_changes_roles_in_their_product_only(scene: Scene) -> None:
    async with scene.open("manager") as ws:
        await scene.members.set_role(ws, scene.people["user"].id, role=InvitedRole.MANAGER, product_id=scene.analytics.id)
    assert ("user", "Manager", [("analytics", "Manager")]) in await scene.listed("owner")
    for product, problem in ((scene.storage, PermissionDenied),):
        with pytest.raises(problem):
            async with scene.open("manager") as ws:
                await scene.members.set_role(ws, scene.people["user"].id, role=InvitedRole.USER, product_id=product.id)
    with pytest.raises(PermissionDenied):
        async with scene.open("manager") as ws:
            await scene.members.set_role(ws, scene.people["user"].id, role=InvitedRole.OWNER)
    with pytest.raises(PermissionDenied):
        async with scene.open("manager") as ws:
            await scene.members.set_role(ws, scene.people["owner"].id, role=InvitedRole.USER, product_id=scene.analytics.id)


async def test_an_owner_appoints_and_demotes_owners_but_one_always_remains(scene: Scene) -> None:
    owner, manager = scene.people["owner"], scene.people["manager"]
    with pytest.raises(LastOwner):
        async with scene.open("owner") as ws:
            await scene.members.set_role(ws, owner.id, role=InvitedRole.MANAGER, product_id=scene.analytics.id)
    with pytest.raises(LastOwner):
        async with scene.open("owner") as ws:
            await scene.members.remove(ws, owner.id)
    async with scene.open("owner") as ws:
        await scene.members.set_role(ws, manager.id, role=InvitedRole.OWNER)
    async with scene.open("manager") as ws:
        await scene.members.set_role(ws, owner.id, role=InvitedRole.USER, product_id=scene.storage.id)
    listed = await scene.listed("manager")
    assert ("manager", "Owner", []) in listed and ("owner", "User", [("storage", "User")]) in listed


async def test_an_owner_needs_a_product_role_when_no_longer_owner(scene: Scene) -> None:
    with pytest.raises(ValidationFailed):
        async with scene.open("owner") as ws:
            await scene.members.set_role(ws, scene.people["owner"].id, role=None, product_id=scene.analytics.id)


async def test_removing_a_product_role_keeps_the_member(scene: Scene) -> None:
    async with scene.open("owner") as ws:
        await scene.members.set_role(ws, scene.people["manager"].id, role=None, product_id=scene.storage.id)
    assert ("manager", "Manager", [("analytics", "Manager")]) in await scene.listed("owner")


async def test_clearing_a_members_last_product_role_removes_them_from_the_workspace(scene: Scene) -> None:
    async with scene.open("manager") as ws:
        await scene.members.set_role(ws, scene.people["user"].id, role=None, product_id=scene.analytics.id)
    assert "user" not in [m[0] for m in await scene.listed("owner")]
    with pytest.raises(NotFound):
        async with scene.workspaces.open(scene.people["user"], scene.workspace_id):
            pass
    assert await scene.workspaces.list_workspaces(scene.people["user"]) == []


async def test_a_manager_removes_members_from_the_products_they_manage(scene: Scene) -> None:
    async with scene.open("storage_manager") as ws:
        await scene.members.remove(ws, scene.people["manager"].id)
    async with scene.open("manager") as ws:
        await scene.members.remove(ws, scene.people["user"].id)
    assert await scene.listed("owner") == [
        ("manager", "Manager", [("analytics", "Manager")]),
        ("owner", "Owner", []),
        ("storage_manager", "Manager", [("storage", "Manager")]),
    ]
    # The User had no other Role, so they left the Workspace.
    with pytest.raises(NotFound):
        async with scene.workspaces.open(scene.people["user"], scene.workspace_id):
            pass


@pytest.mark.parametrize(("who", "target", "problem"), [("manager", "owner", PermissionDenied), ("manager", "storage_manager", NotFound), ("user", "manager", NotFound)])
async def test_a_manager_cannot_remove_owners_or_members_of_other_products(
    scene: Scene, who: str, target: str, problem: type[Exception]
) -> None:
    with pytest.raises(problem):
        async with scene.open(who) as ws:
            await scene.members.remove(ws, scene.people[target].id)


async def test_an_owner_removes_a_member_from_the_workspace(scene: Scene) -> None:
    async with scene.open("owner") as ws:
        await scene.members.remove(ws, scene.people["manager"].id)
        with pytest.raises(NotFound):
            await scene.members.remove(ws, uuid4())
    assert [m[0] for m in await scene.listed("owner")] == ["owner", "storage_manager", "user"]


async def test_settings_changes_record_their_actor_and_product(scene: Scene) -> None:
    await scene.invite("manager", "newcomer@acme.test", InvitedRole.USER, scene.analytics)
    async with scene.open("owner") as ws:
        await scene.members.set_role(ws, scene.people["user"].id, role=InvitedRole.MANAGER, product_id=scene.analytics.id)
        await scene.members.set_role(ws, scene.people["user"].id, role=InvitedRole.OWNER)
        await scene.members.remove(ws, scene.people["storage_manager"].id)
    async with scene.store.transaction(scene.workspace_id) as repos:
        changes = await repos.settings_changes.list()
    assert [(c.actor_email, c.action, c.target_name, c.product_id, c.before, c.after) for c in changes] == [
        ("manager@acme.test", "invitation.created", "newcomer@acme.test", scene.analytics.id, None, "User"),
        ("owner@acme.test", "member.role_changed", "user@acme.test", scene.analytics.id, "User", "Manager"),
        ("owner@acme.test", "member.role_changed", "user@acme.test", None, "Manager", "Owner"),
        ("owner@acme.test", "member.removed", "storage_manager@acme.test", None, "Manager", None),
    ]


# The Cloud service tier.


async def test_a_self_hosted_install_has_no_product_limit_and_no_service_tier(scene: Scene) -> None:
    async with scene.open("owner") as ws:
        await scene.workspaces.create_product(ws, key="third", name="Third")
        hosting = (await scene.workspaces.view(ws)).hosting
    assert (hosting.mode, hosting.product_limit, hosting.subject_entitlements) == ("self_hosted", None, True)
    with pytest.raises(ValidationFailed):
        async with scene.open("platform_admin") as ws:
            await scene.workspaces.set_service_tier(ws, tier=ServiceTier.PRO, version=1)


async def test_cloud_pro_allows_one_product() -> None:
    store, clock = InMemoryStore(), Clock()
    workspaces = WorkspaceService(store, clock=clock, deployment=Deployment.SAAS)
    alice = await account(store, "alice")
    created = await workspaces.create_workspace(alice, "Acme")
    assert (created.hosting.tier, created.hosting.product_limit, created.hosting.subject_entitlements) == ("pro", 1, False)
    with pytest.raises(ProductLimit) as refused:
        async with workspaces.open(alice, created.id) as ws:
            await workspaces.create_product(ws, key="storage", name="Storage")
    assert refused.value.params["limit"] == 1 and refused.value.params["serviceTier"] == "pro"


async def test_only_a_platform_administrator_sets_the_service_tier_and_enterprise_has_no_limit() -> None:
    scene = await build_scene(Deployment.SAAS)
    with pytest.raises(PermissionDenied):
        async with scene.open("owner") as ws:
            await scene.workspaces.set_service_tier(ws, tier=ServiceTier.PRO, version=2)
    async with scene.open("owner") as ws:
        view = await scene.workspaces.view(ws)
        await scene.workspaces.create_product(ws, key="third", name="Third")
    assert (view.hosting.tier, view.hosting.product_limit, view.version) == ("enterprise", None, 2)


async def test_a_downgrade_is_refused_while_several_products_exist_naming_them() -> None:
    scene = await build_scene(Deployment.SAAS)
    with pytest.raises(ProductLimit) as refused:
        async with scene.open("platform_admin") as ws:
            await scene.workspaces.set_service_tier(ws, tier=ServiceTier.PRO, version=2)
    assert [p["name"] for p in refused.value.params["products"]] == ["Analytics", "Storage"]
    assert "Analytics, Storage" in refused.value.detail
    async with scene.open("owner") as ws:
        await scene.workspaces.delete_product(ws, scene.storage.id, version=scene.storage.version)
    with pytest.raises(RevisionConflict):
        async with scene.open("platform_admin") as ws:
            await scene.workspaces.set_service_tier(ws, tier=ServiceTier.PRO, version=1)
    async with scene.open("platform_admin") as ws:
        view = await scene.workspaces.set_service_tier(ws, tier=ServiceTier.PRO, version=2)
    assert (view.hosting.tier, view.version) == ("pro", 3)
