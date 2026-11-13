"""Tiers on the HTTP API (OPE-40): the guided creation, lifecycle, status policy and concurrency."""
import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from fake_issuer import APP, CLIENT_ID, ISSUER, FakeIssuer
from openentitlement_service.interfaces.http import OidcSettings, SignInSettings, create_app
from openentitlement_service.repositories.postgres import PostgresStore

pytestmark = pytest.mark.anyio


@asynccontextmanager
async def _client(store, person="alice"):
    issuer = FakeIssuer()
    app = create_app(
        store,
        sign_in=SignInSettings(oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID)),
        oidc_transport=issuer.transport,
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=APP) as client:
        yield client, await _sign_in(client, issuer, person)


async def _sign_in(client, issuer, person):
    login = await client.get("/auth/login")
    assert (await client.get(issuer.authorize(login.headers["location"], person))).status_code == 302
    csrf = (await client.get("/api/session")).json()["csrf"]
    client.headers.update({"origin": APP, "x-oe-csrf": csrf})
    ws = (await client.post("/api/workspaces", json={"name": "Acme"})).json()
    return f"/api/workspaces/{ws['id']}/products/{ws['products'][0]['id']}"


async def _privilege(client, product, entry, version=0, variant_values=None):
    body = {"kind": "privileges", "entry": entry, "version": version}
    if variant_values:
        body["variantValues"] = variant_values
    return await client.put(f"{product}/catalog", json=body)


def _pointers(response):
    return [e["pointer"] for e in response.json()["errors"]]


async def test_tiers_over_http(store):
    async with _client(store) as (client, product):
        assert (await _privilege(client, product, {"key": "seats", "type": "integer", "title": "Seats", "maximum": 100})).status_code == 200
        tiers = f"{product}/tiers"
        empty = (await client.get(tiers)).json()
        assert empty == {
            "tiers": [],
            "variants": [],
            "policy": {"pastDue": {"action": "readOnly"}, "ended": {"action": "readOnly"}},
            "policyVersion": 0,
        }
        # Guided creation: the Tier and its standard variant in one request.
        created = await client.post(
            tiers, json={"tier": {"id": "pro", "name": "Pro"}, "standard": {"id": "pro_standard", "name": "Pro standard", "values": {"seats": 50}}}
        )
        assert created.status_code == 201
        view = created.json()
        assert [(t["id"], t["rank"], t["gracePeriodDays"], t["archivedAt"], t["version"]) for t in view["tiers"]] == [
            ("pro", 0, 0, None, 1)
        ]
        assert [(v["id"], v["tierId"], v["kind"], v["values"]) for v in view["variants"]] == [
            ("pro_standard", "pro", "standard", {"seats": 50})
        ]
        # The Catalog lists the same variants with their Tier.
        assert (await client.get(f"{product}/catalog")).json()["variants"][0]["tierId"] == "pro"

        missing = await client.post(tiers, json={"tier": {"id": "team", "name": "Team"}, "standard": {"id": "team_standard", "name": "Team standard"}})
        assert missing.status_code == 400 and _pointers(missing) == ["/standard/values/seats"]
        invalid = await client.post(tiers, json={"tier": {"id": "Bad id", "name": ""}, "standard": {"id": "x", "name": "X"}})
        assert invalid.status_code == 400 and sorted(_pointers(invalid)) == ["/tier/id", "/tier/name"]
        taken = await client.post(tiers, json={"tier": {"id": "pro", "name": "Pro"}, "standard": {"id": "other", "name": "Other", "values": {"seats": 1}}})
        assert taken.status_code == 409 and taken.json()["type"].endswith("/already-exists")
        assert [t["id"] for t in (await client.get(tiers)).json()["tiers"]] == ["pro"]

        # Trial and grace variants; grace days on the Tier.
        trial = await client.put(f"{tiers}/pro/variants/pro_trial", json={"name": "Pro trial", "kind": "trial", "values": {"seats": 5}, "version": 0})
        assert trial.status_code == 200
        grace = await client.put(f"{tiers}/pro/variants/pro_grace", json={"name": "Pro grace period", "kind": "grace", "values": {"seats": 5}, "version": 0})
        assert grace.status_code == 200
        edited = await client.patch(f"{tiers}/pro", json={"name": "Pro", "rank": 2, "gracePeriodDays": 5, "version": 1})
        assert edited.status_code == 200 and edited.json()["tiers"][0]["gracePeriodDays"] == 5
        too_long = await client.patch(f"{tiers}/pro", json={"name": "Pro", "rank": 2, "gracePeriodDays": 366, "version": 2})
        assert too_long.status_code == 400 and _pointers(too_long) == ["/gracePeriodDays"]
        stale = await client.patch(f"{tiers}/pro", json={"name": "Pro", "rank": 2, "gracePeriodDays": 5, "version": 1})
        assert stale.status_code == 409 and stale.json()["kind"] == "Tier" and stale.json()["id"] == "pro"
        out_of_bounds = await client.put(f"{tiers}/pro/variants/pro_trial", json={"name": "Pro trial", "kind": "trial", "values": {"seats": 500}, "version": 1})
        assert out_of_bounds.status_code == 400 and _pointers(out_of_bounds) == ["/values/seats"]

        # Status policy per Product.
        policy = {"pastDue": {"action": "readOnly"}, "ended": {"action": "fallback", "variantId": "pro_standard"}}
        saved = await client.put(f"{product}/status-policy", json=policy | {"version": 0})
        assert saved.status_code == 200 and saved.json()["policy"] == policy and saved.json()["policyVersion"] == 1
        unknown = await client.put(f"{product}/status-policy", json={**policy, "ended": {"action": "fallback", "variantId": "gone"}, "version": 1})
        assert unknown.status_code == 400 and _pointers(unknown) == ["/ended/variantId"]
        in_use = await client.delete(f"{tiers}/pro?version=2")
        assert in_use.status_code == 409 and in_use.json()["type"].endswith("/tier-in-use")
        assert in_use.json()["variantId"] == "pro_standard"

        # Archive, restore, delete.
        archived = await client.post(f"{tiers}/pro/archive", json={"version": 2})
        assert archived.status_code == 200 and archived.json()["tiers"][0]["archivedAt"] is not None
        assert len(archived.json()["variants"]) == 3
        restored = await client.post(f"{tiers}/pro/restore", json={"version": 3})
        assert restored.status_code == 200 and restored.json()["tiers"][0]["archivedAt"] is None
        await client.put(f"{product}/status-policy", json={**policy, "ended": {"action": "readOnly"}, "version": 1})
        assert (await client.delete(f"{tiers}/pro?version=4")).status_code == 204
        assert (await client.get(tiers)).json()["variants"] == []
        assert (await client.post(f"{tiers}/missing/archive", json={"version": 1})).status_code == 404


async def test_a_reader_cannot_change_tiers(store):
    async with _client(store) as (client, product):
        async with _client(store, "bob") as (other, _):
            # Not a member of Alice's Workspace: the Product is not found.
            assert (await other.get(f"{product}/tiers")).status_code == 404
            refused = await other.post(f"{product}/tiers", json={"tier": {"id": "pro", "name": "Pro"}, "standard": {"id": "s", "name": "S"}})
            assert refused.status_code == 404


async def test_required_privilege_and_new_variant_never_both_commit_incomplete(postgres_store: PostgresStore) -> None:
    """The Catalog and the Tier service take the same Product row lock, so required values stay complete."""
    async with _client(postgres_store) as (client, product):
        await client.post(f"{product}/tiers", json={"tier": {"id": "basic", "name": "Basic"}, "standard": {"id": "basic_standard", "name": "Basic standard"}})
        for round_ in range(8):
            key = f"required_{round_}"
            variant = f"basic_v{round_}"
            privilege, created = await asyncio.gather(
                _privilege(
                    client,
                    product,
                    {"key": key, "type": "integer", "title": key},
                    variant_values={v["id"]: {"version": v["version"], "value": 1} for v in (await client.get(f"{product}/tiers")).json()["variants"]},
                ),
                client.post(
                    f"{product}/tiers",
                    json={
                        "tier": {"id": variant, "name": variant},
                        "standard": {"id": variant, "name": variant, "values": {f"required_{r}": 1 for r in range(round_)}},
                    },
                ),
            )
            assert {privilege.status_code, created.status_code} <= {200, 201, 400, 409}, (privilege.text, created.text)
            view = (await client.get(f"{product}/catalog")).json()
            required = [p["key"] for p in view["catalog"]["privileges"] if "default" not in p]
            for v in view["variants"]:
                assert set(required) <= set(v["values"]), (round_, v["id"], required, v["values"])
