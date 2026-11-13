"""Organizations on the HTTP API (OPE-41): creation with a Tier variant, terms with reasons, resolved values."""
import asyncio

import pytest
from openentitlement_service.repositories.postgres import PostgresStore
from test_http_tiers import _client, _pointers, _privilege

pytestmark = pytest.mark.anyio


async def _offer(client, product):
    """Seats and SSO, with Basic and Pro."""
    seats = {"key": "seats", "type": "integer", "title": "Seats", "maximum": 1000}
    assert (await _privilege(client, product, seats)).status_code == 200
    assert (await _privilege(client, product, {"key": "sso", "type": "boolean", "title": "SSO", "default": False})).status_code == 200
    for tier, values in (("basic", {"seats": 5}), ("pro", {"seats": 50, "sso": True})):
        body = {"tier": {"id": tier, "name": tier.title()}, "standard": {"id": f"{tier}_standard", "name": f"{tier.title()} standard", "values": values}}
        assert (await client.post(f"{product}/tiers", json=body)).status_code == 201


async def test_organizations_over_http(store):
    async with _client(store) as (client, product):
        await _offer(client, product)
        product_id = product.rsplit("/", 1)[1]
        organizations = product.split("/products/")[0] + "/organizations"
        assert (await client.get(organizations)).json() == {"organizations": []}

        # Created with its Tier variant and Organization terms, in one request; the terms need a reason.
        body = {"id": "acme", "name": "Acme", "assignment": {"productId": product_id, "variantId": "pro_standard", "terms": {"seats": 80}}}
        missing = await client.post(organizations, json=body)
        assert missing.status_code == 400 and _pointers(missing) == ["/reason"]
        assert (await client.get(organizations)).json() == {"organizations": []}, "nothing is saved without the reason"
        created = await client.post(organizations, json=body | {"reason": "Signed contract"})
        assert created.status_code == 201
        acme = created.json()["organizations"][0]
        assert (acme["id"], acme["name"], acme["version"]) == ("acme", "Acme", 1)
        assigned = acme["products"][0]
        assert (assigned["productId"], assigned["variantId"], assigned["status"], assigned["terms"], assigned["version"]) == (
            product_id, "pro_standard", "active", {"seats": 80}, 1
        )
        assert [(v["privilege"], v["value"], v["source"], v["sourceName"]) for v in assigned["values"]] == [
            ("seats", 80, "organizationTerms", "Organization terms"),
            ("sso", True, "variant", "Pro standard"),
        ]

        invalid = await client.post(organizations, json={"id": "Bad id", "name": ""})
        assert invalid.status_code == 400 and sorted(_pointers(invalid)) == ["/id", "/name"]
        taken = await client.post(organizations, json={"id": "acme", "name": "Acme again"})
        assert taken.status_code == 409 and taken.json()["type"].endswith("/already-exists")

        # Change the variant: the terms sent with it are the new variant's terms.
        assignment = f"{organizations}/acme/products/{product_id}"
        downgrade = {"variantId": "basic_standard", "terms": {}, "version": 1}
        assert _pointers(await client.put(assignment, json=downgrade)) == ["/reason"]
        changed = await client.put(assignment, json=downgrade | {"reason": "Downgrade"})
        assert changed.status_code == 200
        assigned = changed.json()["organizations"][0]["products"][0]
        assert (assigned["variantId"], assigned["terms"], assigned["values"][0]["sourceName"]) == ("basic_standard", {}, "Basic standard")
        # A status change alone needs no reason.
        ended = await client.put(assignment, json={"variantId": "basic_standard", "status": "ended", "version": 2})
        assert ended.status_code == 200 and ended.json()["organizations"][0]["products"][0]["readOnly"] is True
        stale = await client.put(assignment, json={"variantId": "basic_standard", "version": 2})
        assert stale.status_code == 409 and stale.json()["type"].endswith("/revision-conflict")
        out_of_bounds = await client.put(assignment, json={"variantId": "basic_standard", "terms": {"seats": 5000}, "version": 3, "reason": "x"})
        assert out_of_bounds.status_code == 400 and _pointers(out_of_bounds) == ["/terms/seats"]
        too_long = await client.put(assignment, json={"variantId": "basic_standard", "version": 3, "reason": "x" * 2001})
        assert too_long.status_code == 400 and _pointers(too_long) == ["/reason"]

        renamed = await client.patch(f"{organizations}/acme", json={"name": "Acme Corp", "version": 1})
        assert renamed.status_code == 200 and renamed.json()["organizations"][0]["name"] == "Acme Corp"

        # The Tier is in use: it can be archived, not deleted; then it is given to no other Organization.
        in_use = await client.delete(f"{product}/tiers/basic?version=1")
        assert in_use.status_code == 409 and in_use.json()["type"].endswith("/tier-in-use")
        assert (await client.post(f"{product}/tiers/basic/archive", json={"version": 1})).status_code == 200
        refused = await client.post(organizations, json={"id": "globex", "name": "Globex", "assignment": {"productId": product_id, "variantId": "basic_standard"}})
        assert refused.status_code == 400 and _pointers(refused) == ["/assignment/variantId"]
        assert (await client.put(assignment, json={"variantId": "basic_standard", "version": 3})).status_code == 200


async def test_a_non_member_sees_no_organizations(store):
    async with _client(store) as (client, product):
        organizations = product.split("/products/")[0] + "/organizations"
        async with _client(store, "bob") as (other, _):
            assert (await other.get(organizations)).status_code == 404
            assert (await other.post(organizations, json={"id": "acme", "name": "Acme"})).status_code == 404


async def test_terms_and_a_catalog_change_never_both_commit_invalid(postgres_store: PostgresStore) -> None:
    """Organization terms and the Catalog take the same Product lock, so stored terms stay valid."""
    async with _client(postgres_store) as (client, product):
        await _offer(client, product)
        product_id = product.rsplit("/", 1)[1]
        organizations = product.split("/products/")[0] + "/organizations"
        for round_ in range(6):
            org = f"org_{round_}"
            maximum = 500 - round_
            seats = {"key": "seats", "type": "integer", "title": "Seats", "maximum": maximum}
            version = (await client.get(f"{product}/catalog")).json()["versions"]["privileges"]["seats"]
            body = {"id": org, "name": org, "assignment": {"productId": product_id, "variantId": "pro_standard", "terms": {"seats": 900}}, "reason": "Contract"}
            catalog, created = await asyncio.gather(
                _privilege(client, product, seats | {"maximum": maximum}, version=version),
                client.post(organizations, json=body),
            )
            assert {catalog.status_code, created.status_code} <= {200, 201, 400}, (catalog.text, created.text)
            current = (await client.get(f"{product}/catalog")).json()["catalog"]["privileges"]
            limit = next(p for p in current if p["key"] == "seats").get("maximum", 10**9)
            for organization in (await client.get(organizations)).json()["organizations"]:
                for assigned in organization["products"]:
                    assert assigned["terms"].get("seats", 0) <= limit, (round_, organization["id"], limit)
            if catalog.status_code == 200:
                # Restore a wide maximum for the next round.
                version = (await client.get(f"{product}/catalog")).json()["versions"]["privileges"]["seats"]
                await _privilege(client, product, seats | {"maximum": 1000}, version=version)

