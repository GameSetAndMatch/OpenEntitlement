"""Audit read authorization, projection and stable continuation on both repository implementations."""
from uuid import uuid4
import pytest
from test_organization_service import Scene, START
from openentitlement_service.services.audit import AuditService, AuditEntry, AuditChange, AuditAction, TargetKind
from openentitlement_service.services.problems import PermissionDenied
from openentitlement_service.services.models import ProductMembership, ProductRole

pytestmark = pytest.mark.anyio

async def test_shared_entry_projects_only_managed_product_and_users_are_denied(store):
    scene = await Scene(store).setup()
    async with store.transaction(scene.ws) as repos:
        await repos.members.set_product_role(ProductMembership(workspace_id=scene.ws, product_id=scene.storage, account_id=scene.people['manager'].id, role=ProductRole.USER))
    async with scene.open('owner') as ws:
        await ws.repos.audit.add(AuditEntry(
            id=uuid4(), workspace_id=scene.ws, actor_id=scene.people['owner'].id,
            actor_email='owner@acme.test', at=START, action=AuditAction.CHANGED,
            target_kind=TargetKind.ORGANIZATION, target_id='acme', target_name='Acme before rename', reason='private agreement',
            changes=(AuditChange(field='name', before='Acme', after='ACME'),
                     AuditChange(field='terms.seats', after=20, product_id=scene.analytics),
                     AuditChange(field='terms.secret', after='private', product_id=scene.storage))))
    async with scene.open('manager') as ws:
        page = await AuditService().log(ws, limit=1)
        assert [c.field for c in page.entries[0].changes] == ['name', 'terms.seats']
        assert page.entries[0].actor_email == 'owner@acme.test'
        assert 'private' not in page.model_dump_json()
        assert page.entries[0].target_name == 'Acme before rename'
        rest = await AuditService().log(ws, before=page.next, limit=200)
        assert page.entries[0].id not in {e.id for e in rest.entries}
    async with scene.open('user') as ws:
        with pytest.raises(PermissionDenied):
            await AuditService().log(ws)

async def test_http_audit_pagination_validation_and_snapshot(store):
    from test_http_tiers import _client, _privilege
    async with _client(store) as (client, product):
        await _privilege(client, product, {'key':'sso','type':'boolean','title':'SSO','default':False})
        path = product.split('/products/')[0] + '/audit'
        response = await client.get(path, params={'limit':1})
        assert response.status_code == 200
        page = response.json()
        assert page['entries'][0]['targetName'] == 'SSO'
        assert page['entries'][0]['actorEmail']
        assert (await client.get(path, params={'limit':201})).status_code == 400
        if page['next']:
            rest = (await client.get(path, params={'before':page['next']})).json()
            assert page['entries'][0]['id'] not in {e['id'] for e in rest['entries']}

def test_http_user_denial_and_unknown_workspace_do_not_disclose_entries():
    from test_http_members import build, person, problem
    app, issuer = build()
    owner, user = person(app, issuer, 'alice'), person(app, issuer, 'bob')
    ws = owner.post('/api/workspaces', json={'name':'Acme'}).json()
    base = f"/api/workspaces/{ws['id']}"
    token = owner.post(base+'/invitations', json={'email':'bob@acme.test','role':'User','productId':ws['products'][0]['id']}).json()['token']
    assert user.post('/api/invitations/accept', json={'token':token}).status_code == 200
    problem(user.get(base+'/audit'), 403, 'permission-denied')
    problem(user.get(f'/api/workspaces/{uuid4()}/audit'), 404, 'not-found')
    assert owner.get(base+'/audit').status_code == 200

async def test_creating_a_workspace_records_owner_only_snapshots_by_its_creator(store):
    from test_workspace_services import account
    from openentitlement_service.services.workspaces import WorkspaceService
    service = WorkspaceService(store, clock=lambda: START)
    alice = await account(store, 'alice')
    created = await service.create_workspace(alice, 'Acme analytics')
    product = created.products[0]
    async with service.open(alice, created.id) as ws:
        page = await AuditService().log(ws)
    entries = sorted(page.entries, key=lambda e: e.target_kind)
    assert [(e.action, e.target_kind, e.target_id, e.target_name) for e in entries] == [
        (AuditAction.CREATED, TargetKind.MEMBER, str(alice.id), 'alice@acme.test'),
        (AuditAction.CREATED, TargetKind.PRODUCT, str(product.id), 'Acme analytics'),
        (AuditAction.CREATED, TargetKind.WORKSPACE, str(created.id), 'Acme analytics'),
    ]
    assert {(e.actor_email, e.at) for e in entries} == {('alice@acme.test', START)}
    assert {c.field: c.after for c in entries[1].changes} == {'name': 'Acme analytics'}
    assert {c.field: c.after for c in entries[0].changes} == {'role': 'Owner'}
    # Owners only: a Manager of the first Product reads none of them.
    bob = await account(store, 'bob')
    async with store.transaction(created.id) as repos:
        from openentitlement_service.services.models import Member
        await repos.members.add(Member(workspace_id=created.id, account_id=bob.id, owner=False, created_at=START))
        await repos.members.set_product_role(ProductMembership(workspace_id=created.id, product_id=product.id, account_id=bob.id, role=ProductRole.MANAGER))
    async with service.open(bob, created.id) as ws:
        assert not (await AuditService().log(ws)).entries

async def test_a_failed_workspace_creation_leaves_no_audit_entry(store, monkeypatch):
    from test_workspace_services import account
    from openentitlement_service.services import audit
    from openentitlement_service.services.workspaces import WorkspaceService
    service = WorkspaceService(store, clock=lambda: START)
    alice = await account(store, 'alice')
    recorded, original = [], audit.record
    async def spy(ws, **kwargs):
        recorded.append(ws.actor.workspace_id)
        await original(ws, **kwargs)
    monkeypatch.setattr(audit, 'record', spy)
    def fail(workspace):
        raise RuntimeError('after the audit entries')
    monkeypatch.setattr(service, 'hosting', fail)
    with pytest.raises(RuntimeError):
        await service.create_workspace(alice, 'Acme analytics')
    assert recorded, 'creation records its entries before it fails'
    assert await service.list_workspaces(alice) == []
    async with store.transaction(recorded[0]) as repos:
        assert list(await repos.audit.list(managed=None, limit=10)) == []
