import asyncio
import httpx
import pytest
from fake_issuer import APP, CLIENT_ID, ISSUER, FakeIssuer
from openentitlement_service.interfaces.http import OidcSettings, SignInSettings, create_app

pytestmark = pytest.mark.anyio


async def test_catalog_http_validation_and_concurrent_records(store):
    issuer = FakeIssuer()
    app = create_app(
        store,
        sign_in=SignInSettings(oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID)),
        oidc_transport=issuer.transport,
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=APP) as client:
        login = await client.get("/auth/login")
        assert (await client.get(issuer.authorize(login.headers["location"], "alice"))).status_code == 302
        csrf = (await client.get("/api/session")).json()["csrf"]
        client.headers.update({"origin": APP, "x-oe-csrf": csrf})
        ws = (await client.post("/api/workspaces", json={"name": "Acme"})).json()
        path = f"/api/workspaces/{ws['id']}/products/{ws['products'][0]['id']}/catalog"

        async def save(key, title, version=0):
            return await client.put(
                path,
                json={
                    "kind": "privileges",
                    "entry": {"key": key, "type": "boolean", "title": title, "default": False},
                    "version": version,
                },
            )

        assert (await save("one", "One")).status_code == 200
        assert (await save("two", "Two")).status_code == 200
        responses = await asyncio.gather(save("one", "First", 1), save("two", "Second", 1))
        assert [r.status_code for r in responses] == [200, 200]
        responses = await asyncio.gather(save("one", "Third", 2), save("one", "Fourth", 2))
        assert sorted(r.status_code for r in responses) == [200, 409]
        conflict = next(r.json() for r in responses if r.status_code == 409)
        assert conflict["type"].endswith("/revision-conflict")
        assert conflict["id"] == "one"
        cases = [
            ({"key": "bad", "title": "Bad", "type": "integer", "envOverride": "BAD"}, ["/entry/envOverride"]),
            ({"key": "bad", "title": "Bad", "type": "boolean", "visibility": "read_only"}, ["/entry/default"]),
            ({"key": "bad", "title": "Bad", "type": "boolean", "visibility": "hidden"}, ["/entry/default"]),
            # Both integer alternatives (a number or Unlimited) reject it, at the submitted member.
            ({"key": "bad", "title": "Bad", "type": "integer", "default": "oops"}, ["/entry/default"] * 2),
            ({"key": "bad", "title": "Bad", "type": "integer", "default": 9, "maximum": 8}, ["/entry/default"]),
            (
                {"key": "bad", "title": "Bad", "type": "integer", "visibility": "read_only", "default": 9, "maximum": 8},
                ["/entry/default"],
            ),
            ({"key": "bad", "title": "Bad", "type": "enum", "values": ["a"]}, ["/entry/enum", "/entry/values"]),
            ({"key": "bad", "title": "Bad", "type": "nope"}, ["/entry/type"]),
            ({"key": "bad", "title": "Bad", "type": "boolean", "default": False, "groupId": "absent"}, ["/entry/groupId"]),
            ({"id": "child", "title": "Child", "parentId": "absent"}, ["/entry/parentId"]),
        ]
        for entry, pointers in cases:
            response = await client.put(
                path, json={"kind": "groups" if "id" in entry else "privileges", "entry": entry, "version": 0}
            )
            assert response.status_code == 400, response.text
            problem = response.json()
            assert problem["type"].endswith("/validation-failed")
            assert [e["pointer"] for e in problem["errors"]] == pointers, (entry, problem["errors"])
        # Request-model errors in variant values also point at the submitted value, not a union member.
        response = await client.put(
            path,
            json={
                "kind": "privileges",
                "entry": {"key": "x", "title": "X", "type": "integer"},
                "variantValues": {"basic": {"version": 1, "value": [1]}, "pro": {"value": 1}},
                "version": 0,
            },
        )
        assert response.status_code == 400, response.text
        assert sorted({e["pointer"] for e in response.json()["errors"]}) == [
            "/variantValues/basic/value",
            "/variantValues/pro/version",
        ]
        assert len((await client.get(path)).json()["catalog"]["privileges"]) == 2
