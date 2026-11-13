"""Organizations, their Tier variant per Product and Organization terms (OPE-41), on both stores."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from openentitlement.privileges import BooleanPrivilege, IntegerPrivilege, StringEnumPrivilege, Unlimited, Visibility

from openentitlement_service.services.catalog import CatalogService
from openentitlement_service.services.models import Account, Member, ProductMembership, ProductRole
from openentitlement_service.services.organizations import AssignmentInput, OrganizationService
from openentitlement_service.services.problems import (
    AlreadyTaken,
    NotFound,
    PermissionDenied,
    ProductInUse,
    RevisionConflict,
    TierInUse,
    ValidationFailed,
)
from openentitlement_service.services.tiers import NewTier, PolicyAction, StatusPolicy, TierService, VariantInput
from openentitlement_service.services.workspaces import WorkspaceService

pytestmark = pytest.mark.anyio
START = datetime(2026, 11, 13, 9, 0, tzinfo=UTC)
SEATS = IntegerPrivilege(key="seats", title="Seats", maximum=1000, unlimited=True)
SSO = BooleanPrivilege(key="sso", title="SSO", default=False)
REGION = StringEnumPrivilege(key="region", title="Region", enum=("us", "eu"), default="us", visibility=Visibility.READ_ONLY)


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now


class Scene:
    """A Workspace with Analytics (Basic, Pro with trial and grace) and Storage, and people in Roles."""

    def __init__(self, store) -> None:
        self.store, self.clock = store, Clock()
        self.service = WorkspaceService(store, clock=self.clock)
        self.organizations = OrganizationService()

    async def setup(self) -> Scene:
        async with self.store.transaction() as repos:
            self.people = {
                name: await repos.accounts.sign_in(
                    Account(id=uuid4(), issuer="https://id.test", subject=name, email=f"{name}@acme.test", created_at=START)
                )
                for name in ("owner", "manager", "user", "storage_manager", "member")
            }
        created = await self.service.create_workspace(self.people["owner"], "Analytics")
        self.ws, self.analytics = created.id, created.products[0].id
        tiers, catalog = TierService(), CatalogService()
        async with self.open("owner") as ws:
            self.storage = (await self.service.create_product(ws, key="storage", name="Storage")).id
            for privilege in (SEATS, SSO, REGION):
                await catalog.save(ws, self.analytics, privilege, version=0)
            await tiers.create(ws, self.analytics, NewTier(id="basic", name="Basic"), VariantInput(id="basic_standard", name="Basic standard", values={"seats": 5}))
            await tiers.create(ws, self.analytics, NewTier(id="pro", name="Pro"), VariantInput(id="pro_standard", name="Pro standard", values={"seats": 50, "sso": True}))
            await tiers.save_variant(ws, self.analytics, "pro", VariantInput(id="pro_trial", name="Pro trial", kind="trial", values={"seats": 10}), version=0)
            await tiers.save_variant(ws, self.analytics, "pro", VariantInput(id="pro_grace", name="Pro grace period", kind="grace", values={"seats": 20}), version=0)
            await tiers.update(ws, self.analytics, "pro", name="Pro", rank=1, grace_period_days=7, version=1)
            await catalog.save(ws, self.storage, IntegerPrivilege(key="gigabytes", title="Gigabytes", default=1), version=0)
            await tiers.create(ws, self.storage, NewTier(id="small", name="Small"), VariantInput(id="small_standard", name="Small standard"))
        roles = {
            "manager": {self.analytics: ProductRole.MANAGER},
            "user": {self.analytics: ProductRole.USER},
            "storage_manager": {self.storage: ProductRole.MANAGER},
            "member": {},
        }
        async with self.store.transaction(self.ws) as repos:
            for name, granted in roles.items():
                await repos.members.add(Member(workspace_id=self.ws, account_id=self.people[name].id, created_at=START))
                for product, role in granted.items():
                    await repos.members.set_product_role(
                        ProductMembership(workspace_id=self.ws, product_id=product, account_id=self.people[name].id, role=role)
                    )
        return self

    def open(self, who: str):
        return self.service.open(self.people[who], self.ws)

    async def create(self, who="owner", *, id="acme", name="Acme", product=None, variant="pro_standard", terms=None, reason=None, status="active"):
        product = product or self.analytics
        async with self.open(who) as ws:
            return await self.organizations.create(
                ws, id=id, name=name, product_id=product,
                assignment=AssignmentInput(variant_id=variant, terms=terms or {}, status=status), reason=reason,
            )

    async def assign(self, who="owner", *, org="acme", product=None, variant="pro_standard", terms=None, status="active", version, reason=None):
        async with self.open(who) as ws:
            return await self.organizations.assign(
                ws, org, product or self.analytics,
                AssignmentInput(variant_id=variant, terms=terms or {}, status=status), version=version, reason=reason,
            )

    async def view(self, who="owner"):
        async with self.open(who) as ws:
            return await self.organizations.view(ws)


@pytest.fixture
async def scene(store) -> Scene:
    return await Scene(store).setup()


def _values(assignment):
    return {v.privilege: (v.value, v.source_name) for v in assignment.values}


def _pointers(problem):
    return [e["pointer"] for e in problem.value.params["errors"]]


async def test_every_member_sees_the_names_and_only_their_products(scene: Scene) -> None:
    await scene.create()
    async with scene.open("storage_manager") as ws:
        await scene.organizations.assign(ws, "acme", scene.storage, AssignmentInput(variant_id="small_standard"), version=0)
    full = (await scene.view("owner")).organizations[0]
    assert (full.id, full.name) == ("acme", "Acme")
    assert {p.product_id for p in full.products} == {scene.analytics, scene.storage}
    for who, products in (("manager", {scene.analytics}), ("user", {scene.analytics}), ("storage_manager", {scene.storage}), ("member", set())):
        seen = (await scene.view(who)).organizations
        assert [o.name for o in seen] == ["Acme"], who
        assert {p.product_id for p in seen[0].products} == products, who


async def test_any_product_manager_creates_organizations(scene: Scene) -> None:
    async with scene.open("storage_manager") as ws:
        view = await scene.organizations.create(ws, id="globex", name="Globex")
    assert [(o.id, o.products) for o in view.organizations] == [("globex", ())]
    for who in ("user", "member"):
        with pytest.raises(PermissionDenied):
            async with scene.open(who) as ws:
                await scene.organizations.create(ws, id="initech", name="Initech")
    # A Manager of Storage cannot give Analytics' variants, even to an Organization they create.
    with pytest.raises(NotFound):
        await scene.create("storage_manager", id="initech")
    with pytest.raises(AlreadyTaken):
        async with scene.open("manager") as ws:
            await scene.organizations.create(ws, id="globex", name="Globex again")
    with pytest.raises(ValidationFailed) as problem:
        async with scene.open("manager") as ws:
            await scene.organizations.create(ws, id="Not valid", name="  ")
    assert _pointers(problem) == ["/id"]


async def test_values_are_resolved_by_the_sdk_with_glossary_sources(scene: Scene) -> None:
    view = await scene.create(terms={"seats": Unlimited(unlimited=True)}, reason="Signed contract")
    acme = view.organizations[0].products[0]
    assert (acme.variant_id, acme.effective_variant_id, acme.status, acme.version) == ("pro_standard", "pro_standard", "active", 1)
    assert _values(acme) == {
        "seats": (Unlimited(unlimited=True), "Organization terms"),
        "sso": (True, "Pro standard"),
        "region": ("us", "Catalog default"),
    }
    assert {v.privilege: v.source for v in acme.values} == {"seats": "organizationTerms", "sso": "variant", "region": "default"}


async def test_a_reason_is_required_exactly_when_organization_terms_change(scene: Scene) -> None:
    with pytest.raises(ValidationFailed) as problem:
        await scene.create(terms={"seats": 80})
    assert _pointers(problem) == ["/reason"]
    with pytest.raises(ValidationFailed):
        await scene.create(terms={"seats": 80}, reason="   ")
    await scene.create()  # no terms: no reason
    # Same terms in another order, or a status change alone: no reason.
    await scene.assign(terms={}, status="ended", version=1)
    view = await scene.assign(terms={"seats": 80, "sso": False}, version=2, reason="Renewal")
    view = await scene.assign(terms={"sso": False, "seats": 80}, version=3)
    assert view.organizations[0].products[0].version == 4
    with pytest.raises(ValidationFailed) as problem:
        await scene.assign(terms={"seats": 81, "sso": False}, version=4)
    assert _pointers(problem) == ["/reason"]
    async with scene.open("owner") as ws:
        changes = await ws.repos.organizations.changes()
    assert [(c.target, c.action, c.reason) for c in changes] == [
        ("organization", "created", None),
        ("assignment", "created", None),
        ("assignment", "changed", None),
        ("assignment", "changed", "Renewal"),
        ("assignment", "changed", None),
    ]
    assert changes[3].actor_email == "owner@acme.test" and changes[3].product_id == scene.analytics


async def test_organization_terms_belong_to_the_variant(scene: Scene) -> None:
    await scene.create(terms={"seats": 80}, reason="Contract")
    # A new variant starts from the terms sent with it: the old ones are cleared, which is a terms change.
    with pytest.raises(ValidationFailed) as problem:
        await scene.assign(variant="basic_standard", version=1)
    assert _pointers(problem) == ["/reason"]
    view = await scene.assign(variant="basic_standard", version=1, reason="Downgrade")
    acme = view.organizations[0].products[0]
    assert acme.terms == {} and _values(acme)["seats"] == (5, "Basic standard")
    # Changing the variant back does not restore them.
    view = await scene.assign(variant="pro_standard", version=2)
    assert view.organizations[0].products[0].terms == {}


async def test_terms_use_only_the_products_privileges_and_their_rules(scene: Scene) -> None:
    with pytest.raises(ValidationFailed) as problem:
        await scene.create(terms={"seats": 5000, "gigabytes": 1, "region": "eu", "sso": "yes"}, reason="x")
    assert _pointers(problem) == ["/assignment/terms/gigabytes", "/assignment/terms/region", "/assignment/terms/seats", "/assignment/terms/sso"]
    for variant in ("pro_grace", "storage_small", "missing"):
        with pytest.raises(ValidationFailed) as problem:
            await scene.create(variant=variant)
        assert _pointers(problem) == ["/assignment/variantId"]


async def test_one_variant_per_organization_per_product_with_versions(scene: Scene) -> None:
    await scene.create()
    with pytest.raises(RevisionConflict):
        await scene.assign(variant="basic_standard", version=0)
    with pytest.raises(RevisionConflict):
        await scene.assign(variant="basic_standard", version=7)
    with pytest.raises(PermissionDenied):
        await scene.assign("user", version=1)
    with pytest.raises(NotFound):
        await scene.assign("storage_manager", version=1)
    with pytest.raises(NotFound):
        await scene.assign(org="nobody", version=0)
    async with scene.open("manager") as ws:
        view = await scene.organizations.rename(ws, "acme", name="Acme Corp", version=1)
    assert view.organizations[0].name == "Acme Corp"
    with pytest.raises(RevisionConflict):
        async with scene.open("owner") as ws:
            await scene.organizations.rename(ws, "acme", name="Acme", version=1)


async def test_an_archived_tier_is_never_given_to_an_organization_that_does_not_have_it(scene: Scene) -> None:
    await scene.create()
    async with scene.open("owner") as ws:
        await TierService().archive(ws, scene.analytics, "pro", version=2)
    # The Organization keeps its variant: its status and terms still change.
    view = await scene.assign(terms={"seats": 70}, status="past_due", version=1, reason="Contract")
    assert view.organizations[0].products[0].variant_id == "pro_standard"
    # A variant of the archived Tier cannot be newly given, not even a sibling variant.
    with pytest.raises(ValidationFailed) as problem:
        await scene.assign(variant="pro_trial", version=2, reason="Trial")
    assert _pointers(problem) == ["/variantId"]
    with pytest.raises(ValidationFailed) as problem:
        await scene.create(id="globex", name="Globex")
    assert _pointers(problem) == ["/assignment/variantId"]
    await scene.create(id="globex", name="Globex", variant="basic_standard")


async def test_an_archived_product_is_not_given_to_another_organization(scene: Scene) -> None:
    await scene.create()
    async with scene.open("owner") as ws:
        product = await scene.service.get_product(ws, scene.analytics)
        await scene.service.archive_product(ws, scene.analytics, version=product.version)
    await scene.assign(variant="basic_standard", version=1)
    with pytest.raises(ValidationFailed) as problem:
        await scene.create(id="globex", name="Globex", variant="basic_standard")
    assert _pointers(problem) == ["/assignment"]


async def test_a_used_tier_or_product_cannot_be_deleted(scene: Scene) -> None:
    await scene.create()
    tiers = TierService()
    with pytest.raises(TierInUse):
        async with scene.open("owner") as ws:
            await tiers.delete(ws, scene.analytics, "pro", version=2)
    async with scene.open("owner") as ws:
        await tiers.delete(ws, scene.analytics, "basic", version=1)
    async with scene.open("owner") as ws:
        await scene.organizations.assign(ws, "acme", scene.storage, AssignmentInput(variant_id="small_standard"), version=0)
    with pytest.raises(ProductInUse):
        async with scene.open("owner") as ws:
            await scene.service.delete_product(ws, scene.storage, version=1)


async def test_past_due_grace_then_the_status_policy(scene: Scene) -> None:
    await scene.create(terms={"seats": 80}, reason="Contract")
    view = await scene.assign(terms={"seats": 80}, status="past_due", version=1)
    acme = view.organizations[0].products[0]
    assert acme.grace_ends_at == START + timedelta(days=7)
    # Within grace: the Tier's grace variant replaces the variant and the Organization terms.
    assert (acme.effective_variant_id, acme.grace, acme.read_only) == ("pro_grace", True, False)
    assert _values(acme)["seats"] == (20, "Grace period")
    assert _values(acme)["sso"] == (False, "Catalog default")
    # Saving again while past due keeps the grace end.
    scene.clock.now = START + timedelta(days=3)
    view = await scene.assign(terms={"seats": 80}, status="past_due", version=2)
    assert view.organizations[0].products[0].grace_ends_at == START + timedelta(days=7)
    # After grace, the default status policy keeps the Organization's values read-only.
    scene.clock.now = START + timedelta(days=8)
    acme = (await scene.view()).organizations[0].products[0]
    assert (acme.effective_variant_id, acme.grace, acme.read_only) == ("pro_standard", False, True)
    assert _values(acme)["seats"] == (80, "Organization terms")
    # A fallback policy moves it to the fallback variant, without its Organization terms.
    async with scene.open("owner") as ws:
        await TierService().set_policy(
            ws, scene.analytics,
            StatusPolicy(past_due=PolicyAction(action="fallback", variant_id="basic_standard"), ended=PolicyAction(action="readOnly")),
            version=0,
        )
    acme = (await scene.view()).organizations[0].products[0]
    assert (acme.effective_variant_id, acme.fallback, acme.read_only) == ("basic_standard", True, False)
    assert _values(acme)["seats"] == (5, "Basic standard")
    view = await scene.assign(terms={"seats": 80}, status="ended", version=3)
    acme = view.organizations[0].products[0]
    assert (acme.grace_ends_at, acme.read_only, acme.effective_variant_id) == (None, True, "pro_standard")


async def test_past_due_grace_needs_a_grace_variant(scene: Scene) -> None:
    async with scene.open("owner") as ws:
        await TierService().update(ws, scene.analytics, "basic", name="Basic", rank=0, grace_period_days=3, version=1)
    with pytest.raises(ValidationFailed) as problem:
        await scene.create(variant="basic_standard", status="past_due")
    assert _pointers(problem) == ["/assignment/status"]


async def test_a_catalog_change_cannot_invalidate_organization_terms(scene: Scene) -> None:
    await scene.create(terms={"seats": 800}, reason="Contract")
    with pytest.raises(ValidationFailed) as problem:
        async with scene.open("owner") as ws:
            await CatalogService().save(ws, scene.analytics, SEATS.model_copy(update={"maximum": 500}), version=1)
    assert _pointers(problem) == ["/entry"]
    assert "Acme" in problem.value.params["errors"][0]["detail"]
    async with scene.open("owner") as ws:
        await CatalogService().save(ws, scene.analytics, SEATS.model_copy(update={"maximum": 900}), version=1)


async def test_a_read_only_privilege_uses_its_catalog_default(scene: Scene) -> None:
    await scene.create(terms={"seats": 80}, reason="Contract")
    async with scene.open("owner") as ws:
        await CatalogService().save(ws, scene.analytics, SEATS.model_copy(update={"default": 1, "visibility": Visibility.READ_ONLY}), version=1)
    acme = (await scene.view()).organizations[0].products[0]
    assert _values(acme)["seats"] == (1, "Catalog default")
    # The stored value stays inert and may be resent unchanged, but not changed.
    await scene.assign(terms={"seats": 80}, status="ended", version=1)
    with pytest.raises(ValidationFailed) as problem:
        await scene.assign(terms={"seats": 81}, version=2, reason="x")
    assert _pointers(problem) == ["/terms/seats"]


async def test_an_environment_prerequisite_can_only_restrict(scene: Scene) -> None:
    mcp = BooleanPrivilege(key="mcp", title="MCP", default=True, env_override="OE_TEST_MCP")
    # Resolution reads the variable it names, so only a Platform administrator binds one.
    with pytest.raises(PermissionDenied):
        async with scene.open("owner") as ws:
            await CatalogService().save(ws, scene.analytics, mcp, version=0)
    async with scene.store.transaction() as repos:
        root = await repos.accounts.sign_in(
            Account(id=uuid4(), issuer="https://id.test", subject="root", email="root@acme.test", platform_admin=True, created_at=START)
        )
    async with scene.service.open(root, scene.ws) as ws:
        await CatalogService().save(ws, scene.analytics, mcp, version=0)
    await scene.create()
    for environment, expected in (
        ({"OE_TEST_MCP": "false"}, (False, "environment", "Environment prerequisite OE_TEST_MCP")),
        ({"OE_TEST_MCP": " TRUE "}, (True, "default", "Catalog default")),
        ({}, (None, "error", "")),
        ({"OE_TEST_MCP": "yes"}, (None, "error", "")),
    ):
        async with scene.open("owner") as ws:
            view = await OrganizationService(environment=environment).view(ws)
        found = next(v for v in view.organizations[0].products[0].values if v.privilege == "mcp")
        assert (found.value, found.source, found.source_name) == expected, environment
