"""Tiers and Tier variants per Product (OPE-40), against both repository implementations."""
import pytest
from openentitlement.privileges import BooleanPrivilege, IntegerPrivilege, Visibility
from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.services.catalog import CatalogService, VariantValue
from openentitlement_service.services.problems import (
    AlreadyTaken,
    NotFound,
    PermissionDenied,
    RevisionConflict,
    TierInUse,
    ValidationFailed,
)
from openentitlement_service.services.tiers import (
    NewTier,
    PolicyAction,
    StatusPolicy,
    TierService,
    VariantInput,
    upgrade_candidates,
)
from openentitlement_service.services.workspaces import WorkspaceService
from test_repository_contract import account

pytestmark = pytest.mark.anyio

READ_ONLY = PolicyAction(action="readOnly")


async def _setup(store, *privileges):
    service, catalog = WorkspaceService(store), CatalogService()
    async with store.transaction() as repos:
        owner = await repos.accounts.sign_in(account())
    ws = await service.create_workspace(owner, "Acme")
    product = ws.products[0].id
    async with service.open(owner, ws.id) as opened:
        for privilege in privileges:
            await catalog.save(opened, product, privilege, version=0)
    return service, owner, ws.id, product


def _pointers(problem):
    return [e["pointer"] for e in problem.value.params["errors"]]


def _standard(tier, **values):
    return VariantInput(id=f"{tier}_standard", name=f"{tier.title()} standard", values=values)


async def test_creating_a_tier_saves_it_with_its_standard_variant(store):
    seats = IntegerPrivilege(key="seats", title="Seats", maximum=100)
    sso = BooleanPrivilege(key="sso", title="SSO", default=False)
    service, owner, ws, product = await _setup(store, seats, sso)
    tiers = TierService()
    async with service.open(owner, ws) as opened:
        view = await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic", seats=5))
        assert [(t.id, t.rank, t.grace_period_days, t.version) for t in view.tiers] == [("basic", 0, 0, 1)]
        assert [(v.id, v.tier_id, v.kind, v.values, v.version) for v in view.variants] == [
            ("basic_standard", "basic", "standard", {"seats": 5}, 1)
        ]
        # The next Tier ranks above the existing ones.
        view = await tiers.create(opened, product, NewTier(id="pro", name="Pro"), _standard("pro", seats=50, sso=True))
        assert [(t.id, t.rank) for t in view.tiers] == [("basic", 0), ("pro", 1)]
    # A Privilege without a default needs a value; nothing is saved without it.
    with pytest.raises(ValidationFailed) as problem:
        async with service.open(owner, ws) as opened:
            await tiers.create(opened, product, NewTier(id="team", name="Team"), _standard("team", sso=True))
    assert _pointers(problem) == ["/standard/values/seats"]
    async with service.open(owner, ws) as opened:
        view = await tiers.view(opened, product)
        assert [t.id for t in view.tiers] == ["basic", "pro"]
        assert view.policy == StatusPolicy(past_due=READ_ONLY, ended=READ_ONLY) and view.policy_version == 0
    with pytest.raises(AlreadyTaken):
        async with service.open(owner, ws) as opened:
            await tiers.create(opened, product, NewTier(id="pro", name="Pro again"), _standard("other", seats=1))


async def test_no_half_created_tier_when_the_variant_write_fails(store):
    service, owner, ws, product = await _setup(store, IntegerPrivilege(key="seats", title="Seats"))
    tiers = TierService()
    with pytest.raises(RuntimeError):
        async with service.open(owner, ws) as opened:

            async def failing(variant, *, expected_version):
                raise RuntimeError("variant write failed")

            opened.repos.catalog.save_variant = failing
            await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic", seats=1))
    async with service.open(owner, ws) as opened:
        view = await tiers.view(opened, product)
        assert (view.tiers, view.variants) == ((), ())


async def test_a_tier_uses_only_its_products_privileges(store):
    service, owner, ws, product = await _setup(store, IntegerPrivilege(key="seats", title="Seats", maximum=10))
    tiers, catalog = TierService(), CatalogService()
    async with service.open(owner, ws) as opened:
        other = await service.create_product(opened, key="storage", name="Storage")
        await catalog.save(opened, other.id, BooleanPrivilege(key="archive", title="Archive", default=False), version=0)
    with pytest.raises(ValidationFailed) as problem:
        async with service.open(owner, ws) as opened:
            await tiers.create(
                opened, product, NewTier(id="basic", name="Basic"), _standard("basic", seats=50, archive=True)
            )
    assert _pointers(problem) == ["/standard/values/archive", "/standard/values/seats"]
    assert "Basic standard" in problem.value.params["errors"][1]["detail"]
    # The same variant ID in another Product is a separate record.
    async with service.open(owner, ws) as opened:
        await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic", seats=5))
        await tiers.create(opened, other.id, NewTier(id="basic", name="Basic"), _standard("basic"))
        assert [v.values for v in (await tiers.view(opened, other.id)).variants] == [{}]


async def test_tier_edits_versions_rank_and_grace_days(store):
    service, owner, ws, product = await _setup(store)
    tiers = TierService()
    async with service.open(owner, ws) as opened:
        await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic"))
        await tiers.create(opened, product, NewTier(id="pro", name="Pro"), _standard("pro"))
    async with service.open(owner, ws) as opened:
        # Different Tiers have independent versions.
        await tiers.update(opened, product, "basic", name="Starter", rank=3, grace_period_days=7, version=1)
        view = await tiers.update(opened, product, "pro", name="Pro", rank=5, grace_period_days=0, version=1)
        assert [(t.id, t.name, t.rank, t.grace_period_days, t.version) for t in view.tiers] == [
            ("basic", "Starter", 3, 7, 2),
            ("pro", "Pro", 5, 0, 2),
        ]
    with pytest.raises(RevisionConflict) as conflict:
        async with service.open(owner, ws) as opened:
            await tiers.update(opened, product, "basic", name="Stale", rank=3, grace_period_days=7, version=1)
    assert conflict.value.params == {"kind": "Tier", "id": "basic"}
    for rank, grace in ((-1, 0), (0, 366), (0, -1)):
        with pytest.raises(ValidationFailed):
            async with service.open(owner, ws) as opened:
                await tiers.update(opened, product, "basic", name="Starter", rank=rank, grace_period_days=grace, version=2)
    with pytest.raises(NotFound):
        async with service.open(owner, ws) as opened:
            await tiers.update(opened, product, "missing", name="Missing", rank=0, grace_period_days=0, version=1)


async def test_variants_one_per_purpose_with_fixed_tier_and_purpose(store):
    service, owner, ws, product = await _setup(store, IntegerPrivilege(key="seats", title="Seats"))
    tiers = TierService()
    async with service.open(owner, ws) as opened:
        await tiers.create(opened, product, NewTier(id="pro", name="Pro"), _standard("pro", seats=5))
        await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic", seats=1))
        view = await tiers.save_variant(
            opened, product, "pro", VariantInput(id="pro_trial", name="Pro trial", kind="trial", values={"seats": 2}), version=0
        )
        assert [(v.id, v.kind, v.version) for v in view.variants if v.tier_id == "pro"] == [
            ("pro_standard", "standard", 1),
            ("pro_trial", "trial", 1),
        ]
        view = await tiers.save_variant(
            opened, product, "pro", VariantInput(id="pro_trial", name="Pro try", kind="trial", values={"seats": 3}), version=1
        )
        assert next(v for v in view.variants if v.id == "pro_trial").values == {"seats": 3}

    async def rejected(tier, variant, version, error=ValidationFailed):
        with pytest.raises(error) as problem:
            async with service.open(owner, ws) as opened:
                await tiers.save_variant(opened, product, tier, variant, version=version)
        return problem

    # One variant per purpose in a Tier.
    problem = await rejected("pro", VariantInput(id="pro_trial_2", name="Again", kind="trial", values={"seats": 1}), 0)
    assert _pointers(problem) == ["/kind"]
    # A variant's Tier and purpose never change.
    problem = await rejected("pro", VariantInput(id="pro_trial", name="Pro trial", kind="grace", values={"seats": 1}), 2)
    assert _pointers(problem) == ["/kind"]
    problem = await rejected("basic", VariantInput(id="pro_trial", name="Pro trial", kind="trial", values={"seats": 1}), 2)
    assert _pointers(problem) == ["/tierId"]
    # A variant ID is unique within the Product; a stale version is a conflict.
    await rejected("basic", VariantInput(id="pro_trial", name="Basic trial", kind="trial", values={"seats": 1}), 0, RevisionConflict)
    await rejected("pro", VariantInput(id="pro_trial", name="Pro trial", kind="trial", values={"seats": 1}), 1, RevisionConflict)
    await rejected("missing", VariantInput(id="missing_trial", name="Trial", kind="trial", values={"seats": 1}), 0, NotFound)
    problem = await rejected("pro", VariantInput(id="pro_grace", name="Pro grace", kind="grace"), 0)
    assert _pointers(problem) == ["/values/seats"]


async def test_read_only_values_stay_inert_and_retained_on_variant_edits(store):
    service, owner, ws, product = await _setup(store, IntegerPrivilege(key="seats", title="Seats", maximum=100))
    tiers, catalog = TierService(), CatalogService()
    async with service.open(owner, ws) as opened:
        await tiers.create(opened, product, NewTier(id="pro", name="Pro"), _standard("pro", seats=50))
        read_only = IntegerPrivilege(key="seats", title="Seats", visibility=Visibility.READ_ONLY, default=5, maximum=10)
        await catalog.save(opened, product, read_only, version=1)
    # The stored value is retained unchanged, whether it is resent or omitted (OPE-39 policy).
    async with service.open(owner, ws) as opened:
        view = await tiers.save_variant(opened, product, "pro", VariantInput(id="pro_standard", name="Pro", values={}), version=1)
        assert view.variants[0].values == {"seats": 50}
        view = await tiers.save_variant(
            opened, product, "pro", VariantInput(id="pro_standard", name="Pro", values={"seats": 50}), version=2
        )
        assert view.variants[0].values == {"seats": 50}
        # A new Tier needs no value for a Read-only Privilege: it uses the Catalog default.
        await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic"))
    with pytest.raises(ValidationFailed) as problem:
        async with service.open(owner, ws) as opened:
            await tiers.save_variant(
                opened, product, "pro", VariantInput(id="pro_standard", name="Pro", values={"seats": 6}), version=3
            )
    assert _pointers(problem) == ["/values/seats"]
    with pytest.raises(ValidationFailed) as problem:
        async with service.open(owner, ws) as opened:
            await tiers.create(opened, product, NewTier(id="team", name="Team"), _standard("team", seats=5))
    assert _pointers(problem) == ["/standard/values/seats"]


async def test_archived_tiers_keep_their_variants_restore_and_delete(store):
    service, owner, ws, product = await _setup(store)
    tiers = TierService()
    async with service.open(owner, ws) as opened:
        await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic"))
        await tiers.create(opened, product, NewTier(id="pro", name="Pro"), _standard("pro"))
        await tiers.create(opened, product, NewTier(id="team", name="Team"), _standard("team"))
        await tiers.save_variant(opened, product, "pro", VariantInput(id="pro_trial", name="Pro trial", kind="trial"), version=0)
        view = await tiers.archive(opened, product, "pro", version=1)
        pro = next(t for t in view.tiers if t.id == "pro")
        assert pro.archived_at == opened.now and pro.version == 2
        # Archived: it keeps every variant, and its variants can still be edited.
        assert [v.id for v in view.variants if v.tier_id == "pro"] == ["pro_standard", "pro_trial"]
        await tiers.save_variant(opened, product, "pro", VariantInput(id="pro_trial", name="Trial", kind="trial"), version=1)
        # Never an upgrade candidate.
        assert [t.id for t in upgrade_candidates(view.tiers, "basic")] == ["team"]
        assert [t.id for t in upgrade_candidates(view.tiers, None)] == ["basic", "team"]
        # Cannot be given to new Organizations through the status policy either.
        with pytest.raises(ValidationFailed) as problem:
            await tiers.set_policy(
                opened, product, StatusPolicy(past_due=READ_ONLY, ended=PolicyAction(action="fallback", variant_id="pro_trial")), version=0
            )
        assert _pointers(problem) == ["/ended/variantId"]
    async with service.open(owner, ws) as opened:
        view = await tiers.restore(opened, product, "pro", version=2)
        assert next(t for t in view.tiers if t.id == "pro").archived_at is None
        assert [t.id for t in upgrade_candidates(view.tiers, "basic")] == ["pro", "team"]
        view = await tiers.delete(opened, product, "team", version=1)
        assert [t.id for t in view.tiers] == ["basic", "pro"]
        assert "team_standard" not in [v.id for v in view.variants]
    with pytest.raises(RevisionConflict):
        async with service.open(owner, ws) as opened:
            await tiers.delete(opened, product, "pro", version=2)


async def test_a_used_tier_cannot_be_deleted():
    store = InMemoryStore()
    service, owner, ws, product = await _setup(store)
    tiers = TierService()
    async with service.open(owner, ws) as opened:
        await tiers.create(opened, product, NewTier(id="pro", name="Pro"), _standard("pro"))
    store.mark_tier_used(product, "pro")
    with pytest.raises(TierInUse):
        async with service.open(owner, ws) as opened:
            await tiers.delete(opened, product, "pro", version=1)
    async with service.open(owner, ws) as opened:
        await tiers.archive(opened, product, "pro", version=1)


async def test_status_policy_per_product_references_its_own_variants(store):
    service, owner, ws, product = await _setup(store)
    tiers = TierService()
    async with service.open(owner, ws) as opened:
        other = await service.create_product(opened, key="storage", name="Storage")
        await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic"))
        await tiers.create(opened, other.id, NewTier(id="cold", name="Cold"), _standard("cold"))
        fallback = StatusPolicy(past_due=READ_ONLY, ended=PolicyAction(action="fallback", variant_id="basic_standard"))
        view = await tiers.set_policy(opened, product, fallback, version=0)
        assert (view.policy, view.policy_version) == (fallback, 1)
        assert (await tiers.view(opened, other.id)).policy_version == 0
    with pytest.raises(RevisionConflict):
        async with service.open(owner, ws) as opened:
            await tiers.set_policy(opened, product, fallback, version=0)
    with pytest.raises(ValidationFailed) as problem:
        async with service.open(owner, ws) as opened:
            cold = PolicyAction(action="fallback", variant_id="cold_standard")
            await tiers.set_policy(opened, product, StatusPolicy(past_due=cold, ended=READ_ONLY), version=1)
    assert _pointers(problem) == ["/pastDue/variantId"]
    # A Tier whose variant is the fallback cannot be deleted until the policy changes.
    with pytest.raises(TierInUse) as in_use:
        async with service.open(owner, ws) as opened:
            await tiers.delete(opened, product, "basic", version=1)
    assert in_use.value.params["variantId"] == "basic_standard"


async def test_roles_scope_and_audit(store):
    from openentitlement_service.services.models import Member, ProductMembership, ProductRole
    from test_repository_contract import NOW

    service, owner, ws, product = await _setup(store)
    tiers = TierService()
    async with store.transaction() as repos:
        reader = await repos.accounts.sign_in(account("reader"))
    async with service.open(owner, ws) as opened:
        other = await service.create_product(opened, key="storage", name="Storage")
        await tiers.create(opened, product, NewTier(id="pro", name="Pro"), _standard("pro"))
        await tiers.update(opened, product, "pro", name="Pro plus", rank=0, grace_period_days=3, version=1)
    async with store.transaction(ws) as repos:
        await repos.members.add(Member(workspace_id=ws, account_id=reader.id, created_at=NOW))
        await repos.members.set_product_role(
            ProductMembership(workspace_id=ws, product_id=product, account_id=reader.id, role=ProductRole.USER)
        )
    async with service.open(reader, ws) as opened:
        assert [t.name for t in (await tiers.view(opened, product)).tiers] == ["Pro plus"]
    with pytest.raises(PermissionDenied):
        async with service.open(reader, ws) as opened:
            await tiers.archive(opened, product, "pro", version=2)
    with pytest.raises(NotFound):
        async with service.open(reader, ws) as opened:
            await tiers.view(opened, other.id)
    other_ws = await service.create_workspace(owner, "Other")
    with pytest.raises(NotFound):
        async with service.open(owner, other_ws.id) as opened:
            await tiers.view(opened, product)
    async with store.transaction(other_ws.id) as repos:
        assert list(await repos.tiers.list(product)) == []
    async with store.transaction(ws) as repos:
        changes = list(await repos.tiers.changes(product))
    assert [(c.target, c.key, c.action) for c in changes] == [("tier", "pro", "created"), ("tier", "pro", "changed")]
    created, changed = changes
    assert (created.actor_id, created.actor_email, created.product_id) == (owner.id, owner.email, product)
    assert created.before is None and created.after["tier"]["name"] == "Pro"
    assert created.after["variants"][0]["id"] == "pro_standard"
    assert (changed.before["tier"]["name"], changed.after["tier"]["name"]) == ("Pro", "Pro plus")


async def test_catalog_required_privilege_and_new_variant_stay_complete(store):
    """A required Privilege saved with values for the existing variants covers a Tier created afterwards."""
    service, owner, ws, product = await _setup(store)
    tiers, catalog = TierService(), CatalogService()
    async with service.open(owner, ws) as opened:
        await tiers.create(opened, product, NewTier(id="basic", name="Basic"), _standard("basic"))
        seats = IntegerPrivilege(key="seats", title="Seats")
        await catalog.save(opened, product, seats, version=0, variant_values={"basic_standard": VariantValue(version=1, value=3)})
        view = await tiers.view(opened, product)
        assert [(v.id, v.values, v.version) for v in view.variants] == [("basic_standard", {"seats": 3}, 2)]
    with pytest.raises(ValidationFailed):
        async with service.open(owner, ws) as opened:
            await tiers.save_variant(opened, product, "basic", VariantInput(id="basic_trial", name="Trial", kind="trial"), version=0)
