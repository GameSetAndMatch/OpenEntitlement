import pytest
from openentitlement.privileges import BooleanPrivilege, Group
from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.services.catalog import CatalogService
from openentitlement_service.services.problems import RevisionConflict, ValidationFailed
from openentitlement_service.services.workspaces import WorkspaceService
from test_repository_contract import account

pytestmark = pytest.mark.anyio


async def test_catalog_records_have_independent_versions_and_validate_references():
    store = InMemoryStore()
    service = WorkspaceService(store)
    person = account()
    ws = await service.create_workspace(person, "Acme")
    product = ws.products[0].id
    catalog = CatalogService()
    async with service.open(person, ws.id) as opened:
        await catalog.save(opened, product, Group(id="root", title="Root"), version=0)
        await catalog.save(opened, product, BooleanPrivilege(key="one", title="One", default=False), version=0)
        await catalog.save(opened, product, BooleanPrivilege(key="two", title="Two", default=False), version=0)
    async with service.open(person, ws.id) as opened:
        await catalog.save(opened, product, BooleanPrivilege(key="one", title="Changed", default=True), version=1)
        await catalog.save(opened, product, BooleanPrivilege(key="two", title="Also changed", default=True), version=1)
    with pytest.raises(RevisionConflict):
        async with service.open(person, ws.id) as opened:
            await catalog.save(opened, product, BooleanPrivilege(key="one", title="Stale", default=False), version=1)
    with pytest.raises(ValidationFailed):
        async with service.open(person, ws.id) as opened:
            await catalog.save(opened, product, Group(id="root", title="Root", parent_id="missing"), version=1)
    async with service.open(person, ws.id) as opened:
        result = await catalog.view(opened, product)
        assert [p.title for p in result.catalog.privileges] == ["Changed", "Also changed"]
        assert result.versions["groups"]["root"] == 1


async def test_product_and_workspace_scope_and_roles(store):
    from openentitlement_service.services.models import Member, ProductMembership, ProductRole
    from openentitlement_service.services.problems import NotFound, PermissionDenied
    from test_repository_contract import NOW

    service, catalog = WorkspaceService(store), CatalogService()
    async with store.transaction() as repos:
        owner = await repos.accounts.sign_in(account())
        reader = await repos.accounts.sign_in(account("reader"))
    ws = await service.create_workspace(owner, "Acme")
    product = ws.products[0].id
    other = await service.create_workspace(owner, "Other")
    async with service.open(owner, ws.id) as opened:
        second = await service.create_product(opened, key="second", name="Second")
        await catalog.save(opened, product, BooleanPrivilege(key="one", title="One", default=False), version=0)
        await catalog.save(opened, second.id, BooleanPrivilege(key="one", title="Other one", default=True), version=0)
    async with store.transaction(ws.id) as repos:
        await repos.members.add(Member(workspace_id=ws.id, account_id=reader.id, created_at=NOW))
        await repos.members.set_product_role(
            ProductMembership(workspace_id=ws.id, product_id=product, account_id=reader.id, role=ProductRole.USER)
        )
    async with service.open(reader, ws.id) as opened:
        assert (await catalog.view(opened, product)).catalog.privileges[0].default is False
    with pytest.raises(PermissionDenied):
        async with service.open(reader, ws.id) as opened:
            await catalog.save(opened, product, Group(id="root", title="Root"), version=0)
    with pytest.raises(NotFound):
        async with service.open(reader, ws.id) as opened:
            await catalog.view(opened, second.id)
    with pytest.raises(NotFound):
        async with service.open(owner, other.id) as opened:
            await catalog.view(opened, product)
    async with store.transaction(other.id) as repos:
        assert list(await repos.catalog.list(product)) == []
    async with service.open(owner, ws.id) as opened:
        await service.delete_product(opened, second.id, version=1)
    async with store.transaction(ws.id) as repos:
        assert list(await repos.catalog.list(second.id)) == []


async def test_required_privilege_and_variant_values_commit_together(store):
    from openentitlement_service.services.catalog import VariantValues, VariantValue

    service, catalog = WorkspaceService(store), CatalogService()
    async with store.transaction() as repos:
        owner = await repos.accounts.sign_in(account())
    ws = await service.create_workspace(owner, "Acme")
    product = ws.products[0].id
    async with store.transaction(ws.id) as repos:
        await repos.catalog.save_variant(
            VariantValues(workspace_id=ws.id, product_id=product, id="standard", name="Standard", values={}, version=1),
            expected_version=0,
        )
    required = BooleanPrivilege(key="required", title="Required")
    with pytest.raises(ValidationFailed):
        async with service.open(owner, ws.id) as opened:
            await catalog.save(opened, product, required, version=0)
    async with service.open(owner, ws.id) as opened:
        result = await catalog.save(
            opened, product, required, version=0, variant_values={"standard": VariantValue(version=1, value=False)}
        )
        assert result.variants[0].values == {"required": False}
        assert result.variants[0].version == 2
    with pytest.raises(RevisionConflict):
        async with service.open(owner, ws.id) as opened:
            await catalog.save(
                opened, product, required, version=1, variant_values={"standard": VariantValue(version=1, value=True)}
            )
    async with service.open(owner, ws.id) as opened:
        assert (await catalog.view(opened, product)).versions["privileges"]["required"] == 1


async def test_nested_groups_tags_and_cycles_use_the_canonical_catalog(store):
    from openentitlement.privileges import Tag

    service, catalog = WorkspaceService(store), CatalogService()
    async with store.transaction() as repos:
        owner = await repos.accounts.sign_in(account())
    ws = await service.create_workspace(owner, "Acme")
    product = ws.products[0].id
    async with service.open(owner, ws.id) as opened:
        await catalog.save(opened, product, Group(id="root", title="Root"), version=0)
        await catalog.save(opened, product, Group(id="child", title="Child", parent_id="root"), version=0)
        await catalog.save(opened, product, Tag(id="enterprise", title="Enterprise"), version=0)
        await catalog.save(
            opened,
            product,
            BooleanPrivilege(key="one", title="One", group_id="child", tags=("enterprise",), default=False),
            version=0,
        )
    with pytest.raises(ValidationFailed):
        async with service.open(owner, ws.id) as opened:
            await catalog.save(opened, product, Group(id="root", title="Root", parent_id="child"), version=1)
    async with service.open(owner, ws.id) as opened:
        result = await catalog.view(opened, product)
        assert result.catalog.tags == (Tag(id="enterprise", title="Enterprise"),)
        assert result.versions["tags"]["enterprise"] == 1
        assert len(result.catalog.groups) == 2


async def _two_variants(store, values=None):
    from openentitlement_service.services.catalog import VariantValues

    service = WorkspaceService(store)
    async with store.transaction() as repos:
        owner = await repos.accounts.sign_in(account())
    ws = await service.create_workspace(owner, "Acme")
    product = ws.products[0].id
    async with store.transaction(ws.id) as repos:
        for variant in ("basic", "pro"):
            await repos.catalog.save_variant(
                VariantValues(
                    workspace_id=ws.id,
                    product_id=product,
                    id=variant,
                    name=variant.title(),
                    values=dict((values or {}).get(variant, {})),
                    version=1,
                ),
                expected_version=0,
            )
    return service, owner, ws.id, product


async def _state(store, workspace_id, product):
    async with store.transaction(workspace_id) as repos:
        variants = [(v.id, v.version, v.values) for v in await repos.catalog.variants(product)]
        records = {(r.kind, r.key): r.version for r in await repos.catalog.list(product)}
        return variants, records, list(await repos.catalog.changes(product))


def _pointers(problem):
    return [e["pointer"] for e in problem.value.params["errors"]]


async def test_read_only_validates_against_the_catalog_default_not_inert_variant_values(store):
    from openentitlement.privileges import IntegerPrivilege, Visibility
    from openentitlement_service.services.catalog import VariantValue

    service, owner, ws, product = await _two_variants(store)
    catalog = CatalogService()
    seats = IntegerPrivilege(key="seats", title="Seats")
    async with service.open(owner, ws) as opened:
        await catalog.save(
            opened,
            product,
            seats,
            version=0,
            variant_values={"basic": VariantValue(version=1, value=100), "pro": VariantValue(version=1, value=500)},
        )
    stored = [("basic", 2, {"seats": 100}), ("pro", 2, {"seats": 500})]
    read_only = IntegerPrivilege(key="seats", title="Seats", visibility=Visibility.READ_ONLY, default=5, maximum=10)
    async with service.open(owner, ws) as opened:
        # The variant values are now inert: Read-only uses the Catalog default (RFC-0002).
        result = await catalog.save(opened, product, read_only, version=1)
        assert result.catalog.privileges[0].default == 5
    # Bounds and default edits on an already Read-only Privilege also ignore the inert values.
    async with service.open(owner, ws) as opened:
        await catalog.save(
            opened,
            product,
            IntegerPrivilege(key="seats", title="Seats", visibility=Visibility.READ_ONLY, default=8, maximum=8),
            version=2,
        )
    variants, records, changes = await _state(store, ws, product)
    assert variants == stored  # Retained untouched; no Tier variant version moves.
    assert records[("privileges", "seats")] == 3
    assert len(changes) == 3
    with pytest.raises(ValidationFailed) as problem:
        async with service.open(owner, ws) as opened:
            await catalog.save(
                opened, product, read_only, version=3, variant_values={"pro": VariantValue(version=2, value=6)}
            )
    assert _pointers(problem) == ["/variantValues/pro"]
    # Becoming editable again makes the stored values effective, so they are validated again.
    with pytest.raises(ValidationFailed) as problem:
        async with service.open(owner, ws) as opened:
            await catalog.save(opened, product, IntegerPrivilege(key="seats", title="Seats", maximum=10), version=3)
    assert _pointers(problem) == ["/variantValues/basic/value", "/variantValues/pro/value"]
    assert problem.value.params["errors"][0]["detail"] == "Basic: Integer Privilege default is out of bounds"
    assert await _state(store, ws, product) == (variants, records, changes)


async def test_reference_and_variant_errors_point_at_the_submitted_members(store):
    from openentitlement.privileges import IntegerPrivilege, Tag
    from openentitlement_service.services.catalog import VariantValue

    service, owner, ws, product = await _two_variants(store, {"basic": {}, "pro": {}})
    catalog = CatalogService()
    async with service.open(owner, ws) as opened:
        await catalog.save(opened, product, Group(id="root", title="Root"), version=0)
        await catalog.save(opened, product, Group(id="child", title="Child", parent_id="root"), version=0)
        await catalog.save(opened, product, Tag(id="known", title="Known"), version=0)

    async def rejected(entry, version=0, **values):
        with pytest.raises(ValidationFailed) as problem:
            async with service.open(owner, ws) as opened:
                await catalog.save(opened, product, entry, version=version, variant_values=values or None)
        return _pointers(problem)

    assert await rejected(Group(id="orphan", title="Orphan", parent_id="absent")) == ["/entry/parentId"]
    assert await rejected(Group(id="root", title="Root", parent_id="child"), version=1) == ["/entry/parentId"]
    assert await rejected(
        BooleanPrivilege(key="b", title="B", default=False, group_id="absent", tags=("known", "absent"))
    ) == ["/entry/groupId", "/entry/tags/1"]
    seats = IntegerPrivilege(key="seats", title="Seats", maximum=10)
    assert await rejected(seats, basic=VariantValue(version=1, value=5)) == ["/variantValues/pro"]
    assert await rejected(
        seats, basic=VariantValue(version=1, value=11), pro=VariantValue(version=1, value="many")
    ) == ["/variantValues/basic/value", "/variantValues/pro/value"]
    assert await rejected(seats, gold=VariantValue(version=1, value=1)) == ["/variantValues/gold"]


async def test_two_variant_save_rolls_back_entirely_when_the_second_write_fails(store):
    from openentitlement.privileges import IntegerPrivilege
    from openentitlement_service.services.catalog import VariantValue
    from openentitlement_service.services.repositories import StaleVersion

    service, owner, ws, product = await _two_variants(store)
    catalog = CatalogService()
    seats = IntegerPrivilege(key="seats", title="Seats", maximum=10)
    before = await _state(store, ws, product)
    assert before[0] == [("basic", 1, {}), ("pro", 1, {})]
    values = {"basic": VariantValue(version=1, value=3), "pro": VariantValue(version=1, value=7)}

    # The second variant's value is invalid.
    with pytest.raises(ValidationFailed):
        async with service.open(owner, ws) as opened:
            await catalog.save(opened, product, seats, version=0, variant_values=values | {"pro": VariantValue(version=1, value=70)})
    assert await _state(store, ws, product) == before

    # The first variant write succeeds, then the second one finds a newer version.
    writes = []
    with pytest.raises(RevisionConflict):
        async with service.open(owner, ws) as opened:
            original = opened.repos.catalog.save_variant

            async def second_is_stale(variant, *, expected_version):
                writes.append(variant.id)
                if len(writes) == 2:
                    raise StaleVersion(variant.id)
                await original(variant, expected_version=expected_version)

            opened.repos.catalog.save_variant = second_is_stale
            await catalog.save(opened, product, seats, version=0, variant_values=values)
    assert writes == ["basic", "pro"]
    assert await _state(store, ws, product) == before


async def test_catalog_audit_records_the_actor_product_target_and_before_after(store):
    from openentitlement.privileges import IntegerPrivilege
    from openentitlement_service.services.catalog import VariantValue

    service, owner, ws, product = await _two_variants(store)
    catalog = CatalogService()
    seats = IntegerPrivilege(key="seats", title="Seats", maximum=10)
    async with service.open(owner, ws) as opened:
        await catalog.save(
            opened,
            product,
            seats,
            version=0,
            variant_values={"basic": VariantValue(version=1, value=3), "pro": VariantValue(version=1, value=7)},
        )
    renamed = IntegerPrivilege(key="seats", title="Seat limit", maximum=10)
    async with service.open(owner, ws) as opened:
        await catalog.save(opened, product, renamed, version=1)
    _, _, changes = await _state(store, ws, product)
    assert len(changes) == 2
    for change in changes:
        assert (change.workspace_id, change.product_id) == (ws, product)
        assert (change.actor_id, change.actor_email) == (owner.id, owner.email)
        assert (change.kind, change.key) == ("privileges", "seats")
    created, edited = changes
    assert (created.before, created.after, created.title) == (None, seats, "Seats")
    assert [(v.id, v.version, v.values) for v in created.variant_before] == [("basic", 1, {}), ("pro", 1, {})]
    assert [(v.id, v.version, v.values) for v in created.variant_after] == [
        ("basic", 2, {"seats": 3}),
        ("pro", 2, {"seats": 7}),
    ]
    assert (edited.before, edited.after, edited.title) == (seats, renamed, "Seat limit")
    assert edited.variant_before == edited.variant_after == created.variant_after
