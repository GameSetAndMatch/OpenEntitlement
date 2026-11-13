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
