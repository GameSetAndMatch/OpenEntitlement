"""API keys per Product and product-scoped OEREP 0.1 on the HTTP API (OPE-42, RFC-0005, spec §10)."""
from datetime import UTC, datetime
from uuid import UUID

import pytest
from test_http_organizations import _offer
from test_http_tiers import _client, _pointers, _privilege

pytestmark = pytest.mark.anyio

PROBLEMS = "https://openentitlement.dev/problems/"
CONTEXT = {"context": {"organizationId": "acme"}}


def _problem(response, status, slug):
    assert response.status_code == status, response.text
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["type"] == PROBLEMS + slug and body["status"] == status
    return body


async def _key(client, product, name="Billing app"):
    created = await client.post(f"{product}/api-keys", json={"name": name})
    assert created.status_code == 201, created.text
    return created.json()


async def _assign(client, product, organization, variant):
    organizations = product.split("/products/")[0] + "/organizations"
    body = {"id": organization, "name": organization.title(), "assignment": {"productId": product.rsplit("/", 1)[1], "variantId": variant}}
    assert (await client.post(organizations, json=body)).status_code == 201


def _oerep(product_key, privilege=None, action="resolve"):
    base = f"/oerep/v1/products/{product_key}/privileges"
    return f"{base}/{action}" if privilege is None else f"{base}/{privilege}/{action}"


async def test_api_keys_are_per_product_and_shown_once(store):
    async with _client(store) as (client, product):
        assert (await client.get(f"{product}/api-keys")).json() == []
        key = await _key(client, product)
        assert key["secret"].startswith("oek_") and key["preview"] == "oek_…" + key["secret"][-4:]
        listed = (await client.get(f"{product}/api-keys")).json()
        assert [(k["id"], k["name"], k["preview"]) for k in listed] == [(key["id"], "Billing app", key["preview"])]
        assert "secret" not in listed[0], "the secret is shown once"
        async with store.transaction(UUID(product.split('/products/')[0].rsplit('/', 1)[-1])) as repos:
            stored = await repos.api_keys.get(UUID(key['id']))
            assert stored is not None and stored.token_hash != key['secret']
            events = [e for e in await repos.settings_changes.list() if e.action == 'api-key.created']
            assert len(events) == 1 and events[0].actor_email == 'alice@acme.test'
            assert events[0].actor_id == stored.created_by and events[0].product_id == stored.product_id
        # A transaction in another Workspace cannot find the key, even by its hash.
        async with store.transaction(UUID(int=1)) as repos:
            assert await repos.api_keys.get(stored.id) is None
            assert await repos.api_keys.find(stored.token_hash) is None

        invalid = await client.post(f"{product}/api-keys", json={"name": "  "})
        assert invalid.status_code == 400 and _pointers(invalid) == ["/name"]

        # Revoked: the key stops evaluating at once.
        assert (await client.delete(f"{product}/api-keys/{key['id']}")).status_code == 204
        assert (await client.get(f"{product}/api-keys")).json() == []
        _problem(await client.delete(f"{product}/api-keys/{key['id']}"), 404, "not-found")

        # An archived Product gets no new keys; its existing keys keep evaluating.
        kept = await _key(client, product, "Kept")
        product_view = (await client.get(product)).json()
        assert (await client.post(f"{product}/archive", json={"version": product_view["version"]})).status_code == 200
        refused = await client.post(f"{product}/api-keys", json={"name": "New"})
        assert refused.status_code == 400 and _pointers(refused) == [""]
        evaluated = await client.post(
            _oerep(product_view["key"]), json=CONTEXT, headers={"authorization": f"Bearer {kept['secret']}"}
        )
        assert evaluated.status_code == 200


async def test_only_the_products_managers_and_owners_manage_keys(store):
    async with _client(store) as (client, product):
        async with _client(store, "bob") as (other, _):
            _problem(await other.get(f"{product}/api-keys"), 404, "not-found")
            _problem(await other.post(f"{product}/api-keys", json={"name": "x"}), 404, "not-found")


async def test_resolution_and_upgrade_within_the_keys_product(store):
    async with _client(store, clock=lambda: datetime(2026, 11, 13, tzinfo=UTC)) as (client, product):
        await _offer(client, product)
        await _assign(client, product, "acme", "basic_standard")
        product_key = (await client.get(product)).json()["key"]
        key = await _key(client, product)
        app = {"authorization": f"Bearer {key['secret']}"}

        single = await client.post(_oerep(product_key, "seats"), json=CONTEXT, headers=app)
        assert single.status_code == 200 and single.headers["cache-control"] == "no-store"
        assert single.json() == {
            "privilege": "seats", "value": 5, "reason": "PLAN", "planId": "basic_standard", "planValue": 5,
            "grants": [], "staleOverrides": [],
        }
        bulk = (await client.post(_oerep(product_key), json=CONTEXT, headers=app)).json()
        assert [(d["privilege"], d["value"], d["reason"]) for d in bulk["privileges"]] == [
            ("seats", 5, "PLAN"), ("sso", False, "DEFAULT")
        ]

        # An application user's Grant adds to the Organization's value, for that user only.
        organizations = product.split("/products/")[0] + "/organizations"
        user = {"name": "Alice", "grants": {"seats": 3}, "version": 0, "reason": "Pilot"}
        assert (await client.put(f"{organizations}/acme/products/{product.rsplit('/', 1)[1]}/users/alice", json=user)).status_code == 200
        alice = {"context": {"organizationId": "acme", "subjectId": "alice"}}
        granted = (await client.post(_oerep(product_key, "seats"), json=alice, headers=app)).json()
        assert (granted["value"], granted["reason"], granted["grants"]) == (8, "GRANT", [{"id": "grant:seats", "amount": 3, "subjectId": "alice"}])

        # An Organization without a Tier in this Product resolves from the Catalog defaults, or the
        # most restrictive value for a Privilege without one.
        nobody = {"context": {"organizationId": "globex"}}
        bulk = (await client.post(_oerep(product_key), json=nobody, headers=app)).json()
        assert [(d["privilege"], d["value"], d["reason"]) for d in bulk["privileges"]] == [
            ("seats", 0, "DEFAULT"), ("sso", False, "DEFAULT")
        ]

        # Upgrade: the lowest-ranked eligible Tier above the current one; never an archived one.
        upgrade = await client.post(_oerep(product_key, "sso", "upgrade"), json=CONTEXT | {"need": True}, headers=app)
        assert upgrade.status_code == 200 and upgrade.json() == {"requiredPlan": "pro"}
        assert (await client.post(_oerep(product_key, "seats", "upgrade"), json=CONTEXT | {"need": 500}, headers=app)).json() == {"requiredPlan": None}
        assert (await client.post(_oerep(product_key, "sso", "upgrade"), json=nobody | {"need": True}, headers=app)).json() == {"requiredPlan": "pro"}
        assert (await client.post(f"{product}/tiers/pro/archive", json={"version": 1})).status_code == 200
        assert (await client.post(_oerep(product_key, "sso", "upgrade"), json=CONTEXT | {"need": True}, headers=app)).json() == {"requiredPlan": None}
        bad_need = await client.post(_oerep(product_key, "sso", "upgrade"), json=CONTEXT | {"need": 1}, headers=app)
        assert _problem(bad_need, 400, "validation-failed")["errors"] == [{"pointer": "/need", "detail": "Send true."}]

        # An explicit time is used as is; a malformed one is refused.
        at = {"context": {"organizationId": "acme", "now": "2026-11-03T12:00:00Z"}}
        assert (await client.post(_oerep(product_key, "seats"), json=at, headers=app)).status_code == 200
        wrong = await client.post(_oerep(product_key, "seats"), json={"context": {"organizationId": "", "now": "yesterday"}}, headers=app)
        assert sorted(e["pointer"] for e in _problem(wrong, 400, "validation-failed")["errors"]) == [
            "/context/now", "/context/organizationId"
        ]


async def test_checks_run_in_order_401_then_403_then_404(store):
    async with _client(store) as (client, product):
        await _offer(client, product)
        product_key = (await client.get(product)).json()["key"]
        workspace = product.split("/products/")[0]
        other = (await client.post(f"{workspace}/products", json={"key": "storage", "name": "Storage"})).json()
        key = await _key(client, product)
        app = {"authorization": f"Bearer {key['secret']}"}
        for path in (_oerep(product_key, "seats"), _oerep(product_key), _oerep(product_key, "sso", "upgrade")):
            # 401 for a missing, malformed or unknown key, whatever the body.
            for headers in ({}, {"authorization": "Bearer nonsense"}, {"authorization": "Bearer oek_" + workspace.rsplit("/", 1)[1] + ".unknown"}):
                problem = _problem(await client.post(path, content=b"{", headers=headers), 401, "api-key-invalid")
                assert problem["instance"] == path
            assert (await client.post(path, content=b"{", headers={})).headers["www-authenticate"] == "Bearer"
            # 403 for another Product, existing or not, with one body whatever the Privilege.
            bodies = set()
            for wrong in (path.replace(product_key, "storage"), path.replace(product_key, "missing"), path.replace(product_key, "Not A Key")):
                problem = _problem(await client.post(wrong, json=CONTEXT, headers=app), 403, "product-forbidden")
                bodies.add(__import__("json").dumps(problem, sort_keys=True))
            assert len(bodies) == 1
        unknown = _oerep("storage", "nothing")
        _problem(await client.post(unknown, json=CONTEXT, headers=app), 403, "product-forbidden")
        # 404 only inside the key's Product; then the body is judged.
        _problem(await client.post(_oerep(product_key, "nothing"), content=b"{", headers=app), 404, "not-found")
        _problem(await client.post(_oerep(product_key, "nothing", "upgrade"), json=CONTEXT, headers=app), 404, "not-found")
        assert other["key"] == "storage"

        plain = await client.post(_oerep(product_key, "seats"), content=b"{}", headers=app | {"content-type": "text/plain"})
        _problem(plain, 415, "unsupported-media-type")
        big = await client.post(_oerep(product_key, "seats"), content=b"x" * 1_000_001, headers=app | {"content-type": "application/json"})
        _problem(big, 413, "request-too-large")
        broken = await client.post(_oerep(product_key, "seats"), content=b"{", headers=app | {"content-type": "application/json"})
        assert _problem(broken, 400, "validation-failed")["errors"] == [{"pointer": "", "detail": "Send valid JSON."}]
        for body in ([], 1, "invalid"):
            _problem(await client.post(_oerep(product_key, "seats", "upgrade"), json=body, headers=app), 400, "validation-failed")
        # The protocol before Products is gone.
        _problem(await client.post("/oerep/v1/resolve/seats", json=CONTEXT, headers=app), 404, "not-found")
        _problem(await client.get(_oerep(product_key, "seats"), headers=app), 405, "method-not-allowed")


async def test_the_same_privilege_key_in_two_products_never_mixes(store):
    async with _client(store) as (client, analytics):
        workspace = analytics.split("/products/")[0]
        storage_id = (await client.post(f"{workspace}/products", json={"key": "storage", "name": "Storage"})).json()["id"]
        storage = f"{workspace}/products/{storage_id}"
        for product, seats in ((analytics, 10), (storage, 99)):
            assert (await _privilege(client, product, {"key": "seats", "type": "integer", "title": "Seats", "maximum": 1000})).status_code == 200
            body = {"tier": {"id": "business", "name": "Business"}, "standard": {"id": "business_standard", "name": "Business standard", "values": {"seats": seats}}}
            assert (await client.post(f"{product}/tiers", json=body)).status_code == 201
        await _assign(client, analytics, "acme", "business_standard")
        analytics_key = (await client.get(analytics)).json()["key"]
        analytics_app = {"authorization": f"Bearer {(await _key(client, analytics))['secret']}"}
        storage_app = {"authorization": f"Bearer {(await _key(client, storage))['secret']}"}
        assert (await client.post(_oerep(analytics_key, "seats"), json=CONTEXT, headers=analytics_app)).json()["value"] == 10
        # In Storage, Acme has no Tier: the Storage Catalog's base, never the Analytics value.
        assert (await client.post(_oerep("storage", "seats"), json=CONTEXT, headers=storage_app)).json()["reason"] == "DEFAULT"
        _problem(await client.post(_oerep("storage", "seats"), json=CONTEXT, headers=analytics_app), 403, "product-forbidden")
        _problem(await client.post(_oerep(analytics_key, "seats"), json=CONTEXT, headers=storage_app), 403, "product-forbidden")


async def test_product_managers_can_manage_only_their_keys_and_users_cannot(store):
    async with _client(store) as (owner, product):
        workspace = product.split('/products/')[0]
        product_id = product.rsplit('/', 1)[-1]
        async with _client(store, 'bob') as (manager, _):
            invitation = (await owner.post(workspace + '/invitations', json={
                'email': 'bob@acme.test', 'role': 'Manager', 'productId': product_id
            })).json()
            assert (await manager.post('/api/invitations/accept', json={'token': invitation['token']})).status_code == 200
            key = await _key(manager, product)
            assert (await manager.delete(product + '/api-keys/' + key['id'])).status_code == 204
            async with _client(store, 'carol') as (reader, _):
                invitation = (await owner.post(workspace + '/invitations', json={
                    'email': 'carol@acme.test', 'role': 'User', 'productId': product_id
                })).json()
                assert (await reader.post('/api/invitations/accept', json={'token': invitation['token']})).status_code == 200
                for response in (
                    await reader.get(product + '/api-keys'),
                    await reader.post(product + '/api-keys', json={'name': 'forbidden'}),
                    await reader.delete(product + '/api-keys/' + key['id']),
                ):
                    _problem(response, 403, 'permission-denied')
