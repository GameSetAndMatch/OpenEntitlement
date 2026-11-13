"""Application users' Personal terms and Grants in one Product (OPE-60, ADR-0005), on both stores."""
from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from openentitlement.privileges import IntegerPrivilege, Unlimited
from test_organization_service import START, Scene, _pointers

from openentitlement_service.services.catalog import CatalogService
from openentitlement_service.services.models import Account, ServiceTier
from openentitlement_service.services.organizations import ApplicationUserInput, OrganizationService
from openentitlement_service.services.problems import (
    NotFound,
    PermissionDenied,
    RevisionConflict,
    UserEntitlementsUnavailable,
    ValidationFailed,
)
from openentitlement_service.services.tiers import PolicyAction, StatusPolicy, TierService
from openentitlement_service.services.workspaces import Deployment, WorkspaceService

pytestmark = pytest.mark.anyio


class Users:
    """Saves and reads application users of Acme in Analytics."""

    def __init__(self, scene: Scene) -> None:
        self.scene = scene

    async def save(self, who="owner", *, subject="idp|alice", name="Alice", terms=None, grants=None, version=0, reason=None, org="acme", product=None):
        async with self.scene.open(who) as ws:
            return await self.scene.organizations.save_user(
                ws, org, product or self.scene.analytics, subject,
                ApplicationUserInput(name=name, terms=terms or {}, grants=grants or {}), version=version, reason=reason,
            )

    async def remove(self, who="owner", *, subject="idp|alice", version, reason=None):
        async with self.scene.open(who) as ws:
            return await self.scene.organizations.remove_user(ws, "acme", self.scene.analytics, subject, version=version, reason=reason)

    async def get(self, who="owner", subject="idp|alice"):
        assigned = (await self.scene.view(who)).organizations[0].products[0]
        return next((u for u in assigned.users if u.subject_id == subject), None)


def _sources(user):
    return {v.privilege: (v.value, v.source, v.source_name) for v in user.values}


@pytest.fixture
async def users(store) -> Users:
    scene = await Scene(store).setup()
    await scene.create(terms={"seats": 80}, reason="Signed contract")
    return Users(scene)


async def test_personal_terms_and_grants_are_resolved_by_the_sdk(users: Users) -> None:
    await users.save(grants={"seats": 5}, reason="Goodwill")
    alice = await users.get()
    assert (alice.subject_id, alice.name, alice.variant_id, alice.state, alice.version) == ("idp|alice", "Alice", "pro_standard", "active", 1)
    # A Grant adds to the resolved value: here, the Organization terms.
    assert _sources(alice) == {
        "seats": (85, "grant", "Organization terms 80 + Grant 5"),
        "sso": (True, "variant", "Pro standard"),
        "region": ("us", "default", "Catalog default"),
    }
    # Personal terms replace the Organization's value; the Grant still adds to it.
    await users.save(terms={"seats": 40, "sso": False}, grants={"seats": 5}, version=1, reason="Pilot")
    alice = await users.get()
    assert _sources(alice)["seats"] == (45, "grant", "Personal terms 40 + Grant 5")
    assert _sources(alice)["sso"] == (False, "personalTerms", "Personal terms")
    # The Organization itself is unchanged.
    acme = (await users.scene.view()).organizations[0].products[0]
    assert {v.privilege: v.value for v in acme.values}["seats"] == 80
    # An unlimited value stays unlimited and keeps its source.
    await users.save(terms={"seats": Unlimited(unlimited=True)}, grants={"seats": 5}, version=2, reason="Unlimited pilot")
    assert _sources(await users.get())["seats"] == (Unlimited(unlimited=True), "personalTerms", "Personal terms")


async def test_users_are_per_organization_and_product(users: Users) -> None:
    scene = users.scene
    await scene.create(id="globex", name="Globex", variant="basic_standard")
    await users.save(subject="idp|bob", name="Bob", org="globex")
    await users.save(subject="idp|bob", name="Bob at Acme")
    view = (await scene.view()).organizations
    assert [(o.id, [u.name for u in o.products[0].users]) for o in view] == [("acme", ["Bob at Acme"]), ("globex", ["Bob"])]
    # An Organization needs a Tier variant in the Product first.
    with pytest.raises(ValidationFailed) as problem:
        await users.save(product=scene.storage)
    assert _pointers(problem) == ["/"]
    with pytest.raises(NotFound):
        await users.save(org="initech")
    # Only the Product's Manager or an Owner saves them; its Users see them.
    await users.save("manager", subject="idp|carol", name="Carol")
    for who in ("user", "storage_manager"):
        with pytest.raises((PermissionDenied, NotFound)):
            await users.save(who, subject="idp|dave", name="Dave")
    assert [u.subject_id for u in (await scene.view("user")).organizations[0].products[0].users] == ["idp|bob", "idp|carol"]


async def test_a_reason_is_required_whenever_personal_terms_or_grants_change(users: Users) -> None:
    with pytest.raises(ValidationFailed) as problem:
        await users.save(grants={"seats": 5})
    assert _pointers(problem) == ["/reason"]
    with pytest.raises(ValidationFailed):
        await users.save(terms={"seats": 40}, reason="  ")
    await users.save()  # no exceptions yet: no reason
    await users.save(name="Alice Smith", version=1)  # a new name alone: no reason
    await users.save(name="Alice Smith", grants={"seats": 5}, version=2, reason="Goodwill")
    with pytest.raises(ValidationFailed) as problem:
        await users.save(name="Alice Smith", grants={"seats": 6}, version=3)
    assert _pointers(problem) == ["/reason"]
    with pytest.raises(ValidationFailed) as problem:
        await users.remove(version=3)
    assert _pointers(problem) == ["/reason"]
    await users.remove(version=3, reason="Left the company")
    assert await users.get() is None
    async with users.scene.open("owner") as ws:
        entries = [e for _, e in reversed(await ws.repos.audit.list(managed=None, limit=100))]
    changes = [c for c in entries if c.target_kind == "Application user"]
    assert [(c.target_id, c.action, c.aspect, c.reason) for c in changes] == [
        ("acme/idp|alice", "created", None, None),
        ("acme/idp|alice", "changed", None, None),
        ("acme/idp|alice", "changed", "terms", "Goodwill"),
        ("acme/idp|alice", "removed", None, "Left the company"),
    ]
    assert changes[2].product_id == users.scene.analytics
    assert [(c.field, c.title, c.before, c.after) for c in changes[2].changes] == [("grants.seats", "Seats", None, 5)]


async def test_only_the_products_manager_or_an_owner_removes_users_and_is_the_audit_actor(users: Users) -> None:
    await users.save(grants={"seats": 5}, reason="Goodwill")
    # Another Product's Manager and the Product's Users cannot remove the record (ADR-0010 Q13).
    for who in ("user", "storage_manager", "member"):
        with pytest.raises((PermissionDenied, NotFound)):
            await users.remove(who, version=1, reason="Pilot over")
    assert (await users.get()) is not None
    await users.remove("manager", version=1, reason="Pilot over")
    assert await users.get() is None
    async with users.scene.open("owner") as ws:
        _, removed = (await ws.repos.audit.list(managed=None, limit=1))[0]
    assert (removed.target_kind, removed.action, removed.actor_id, removed.actor_email, removed.reason) == (
        "Application user", "removed", users.scene.people["manager"].id, users.scene.people["manager"].email, "Pilot over"
    )
    assert removed.product_id == users.scene.analytics


async def test_subject_ids_are_what_the_application_sends(users: Users) -> None:
    for subject in ("", " idp|alice", "idp|alice ", "idp\nalice", "x" * 201):
        with pytest.raises(ValidationFailed) as problem:
            await users.save(subject=subject)
        assert _pointers(problem) == ["/subjectId"], repr(subject)
    with pytest.raises(ValidationFailed) as problem:
        await users.save(name="  ")
    assert _pointers(problem) == ["/name"]
    await users.save(subject="tenant/42|alice@example.com")
    assert (await users.get(subject="tenant/42|alice@example.com")).name == "Alice"


async def test_grants_are_positive_whole_numbers_on_integer_privileges(users: Users) -> None:
    scene = users.scene
    async with scene.open("owner") as ws:
        await CatalogService().save(ws, scene.analytics, IntegerPrivilege(key="exports", title="Exports", default=1, visibility="read_only"), version=0)
    with pytest.raises(ValidationFailed) as problem:
        await users.save(grants={"seats": 0, "sso": 1, "region": 2, "unknown": 1, "exports": 3}, reason="x")
    assert _pointers(problem) == ["/grants/exports", "/grants/region", "/grants/seats", "/grants/sso", "/grants/unknown"]
    # Read-only Privileges take no Personal terms either; values follow the Catalog rules.
    with pytest.raises(ValidationFailed) as problem:
        await users.save(terms={"region": "eu", "seats": 5000, "unknown": 1}, reason="x")
    assert _pointers(problem) == ["/terms/region", "/terms/seats", "/terms/unknown"]


async def test_personal_terms_belong_to_the_variant_and_grants_stay(users: Users) -> None:
    scene = users.scene
    await users.save(terms={"seats": 40}, grants={"seats": 5}, reason="Pilot")
    await scene.assign(variant="basic_standard", version=1, reason="Downgrade")
    alice = await users.get()
    # Inactive, not deleted: the terms stay on the record, bound to the previous variant.
    assert (alice.state, alice.variant_id, alice.terms) == ("stale", "pro_standard", {"seats": 40})
    assert _sources(alice)["seats"] == (10, "grant", "Basic standard 5 + Grant 5")
    # Saving again binds the terms sent to the current variant; that is a change of Personal terms.
    with pytest.raises(ValidationFailed) as problem:
        await users.save(terms={"seats": 40}, grants={"seats": 5}, version=1)
    assert _pointers(problem) == ["/reason"]
    await users.save(terms={"seats": 40}, grants={"seats": 5}, version=1, reason="Keep the pilot")
    alice = await users.get()
    assert (alice.state, alice.variant_id) == ("active", "basic_standard")
    assert _sources(alice)["seats"] == (45, "grant", "Personal terms 40 + Grant 5")


async def test_grace_and_fallback_suspend_personal_terms_and_grants(users: Users) -> None:
    scene = users.scene
    await users.save(terms={"seats": 40}, grants={"seats": 5}, reason="Pilot")
    await scene.assign(terms={"seats": 80}, status="past_due", version=1)
    alice = await users.get()
    assert alice.state == "suspended"
    assert _sources(alice)["seats"] == (20, "gracePeriod", "Grace period")
    async with scene.open("owner") as ws:
        await TierService().set_policy(
            ws, scene.analytics,
            StatusPolicy(past_due=PolicyAction(action="fallback", variant_id="pro_standard"), ended=PolicyAction(action="readOnly")),
            version=0,
        )
    scene.clock.now += timedelta(days=8)
    alice = await users.get()
    assert alice.state == "suspended" and _sources(alice)["seats"] == (50, "variant", "Pro standard")
    # Back to active: the exceptions apply again.
    await scene.assign(terms={"seats": 80}, version=2)
    assert _sources(await users.get())["seats"] == (45, "grant", "Personal terms 40 + Grant 5")


async def test_versions_guard_concurrent_edits(users: Users) -> None:
    await users.save()
    with pytest.raises(RevisionConflict):
        await users.save()
    with pytest.raises(RevisionConflict):
        await users.save(name="Alicia", version=5)
    with pytest.raises(RevisionConflict):
        await users.remove(version=2, reason="x")
    with pytest.raises(NotFound):
        await users.remove(subject="idp|nobody", version=1, reason="x")


async def test_a_catalog_change_cannot_invalidate_personal_terms_or_grants(users: Users) -> None:
    scene = users.scene
    await users.save(terms={"seats": 400}, grants={"seats": 5}, reason="Pilot")
    catalog = CatalogService()
    with pytest.raises(ValidationFailed) as problem:
        async with scene.open("owner") as ws:
            await catalog.save(ws, scene.analytics, IntegerPrivilege(key="seats", title="Seats", maximum=100, unlimited=True), version=1)
    assert "Alice" in problem.value.params["errors"][0]["detail"]


async def test_cloud_enterprise_gates_user_level_entitlements(store) -> None:
    scene = await Scene(store).setup()
    await scene.create()
    cloud = WorkspaceService(store, clock=scene.clock, deployment=Deployment.SAAS)
    scene.organizations = OrganizationService(deployment=Deployment.SAAS)
    users = Users(scene)
    with pytest.raises(UserEntitlementsUnavailable):
        await users.save()
    async with store.transaction() as repos:
        admin = await repos.accounts.sign_in(
            Account(id=uuid4(), issuer="https://id.test", subject="root", email="root@acme.test", platform_admin=True, created_at=START)
        )
    async with cloud.open(admin, scene.ws) as ws:
        await cloud.set_service_tier(ws, tier=ServiceTier.ENTERPRISE, version=1)
    await users.save(grants={"seats": 5}, reason="Goodwill")
    assert _sources(await users.get())["seats"][0] == 55
    # Cloud Pro allows one Product: Storage, which no Organization has, goes first.
    async with cloud.open(admin, scene.ws) as ws:
        storage = await cloud.get_product(ws, scene.storage)
        await cloud.delete_product(ws, scene.storage, version=storage.version)
        await cloud.set_service_tier(ws, tier=ServiceTier.PRO, version=2)
    # A downgrade keeps the record, without user-level values, and refuses changes; removing still works.
    alice = await users.get()
    assert (alice.grants, alice.values) == ({"seats": 5}, ())
    with pytest.raises(UserEntitlementsUnavailable):
        await users.save(name="Alicia", grants={"seats": 5}, version=1)
    await users.remove(version=1, reason="Downgraded")
