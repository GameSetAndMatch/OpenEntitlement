"""Concurrent Role changes through the HTTP seam against Postgres (OPE-44)."""
from __future__ import annotations

import asyncio

import httpx
import pytest
from fake_issuer import APP, CLIENT_ID, ISSUER, FakeIssuer

from openentitlement_service.interfaces.http import OidcSettings, SignInSettings, create_app
from openentitlement_service.repositories.postgres import PostgresStore

pytestmark = pytest.mark.anyio


async def test_concurrently_clearing_a_members_last_roles_removes_them(postgres_store: PostgresStore) -> None:
    issuer = FakeIssuer()
    app = create_app(
        postgres_store,
        sign_in=SignInSettings(oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID)),
        oidc_transport=issuer.transport,
    )

    async def person(subject: str) -> httpx.AsyncClient:
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=APP)
        login = await client.get("/auth/login")
        assert (await client.get(issuer.authorize(login.headers["location"], subject))).status_code == 302
        client.headers.update({"origin": APP, "x-oe-csrf": (await client.get("/api/session")).json()["csrf"]})
        return client

    owner = await person("alice")
    workspace = (await owner.post("/api/workspaces", json={"name": "Acme"})).json()
    base = f"/api/workspaces/{workspace['id']}"
    products = [workspace["products"][0]["id"], (await owner.post(base + "/products", json={"key": "storage", "name": "Storage"})).json()["id"]]
    members = []
    for i in range(8):
        member = await person(f"member{i}")
        for product in products:
            link = (await owner.post(base + "/invitations", json={"email": f"member{i}@acme.test", "role": "User", "productId": product})).json()
            assert (await member.post("/api/invitations/accept", json={"token": link["token"]})).status_code == 200
        members.append((member, (await member.get("/api/session")).json()["account"]["id"]))
    responses = await asyncio.gather(*(
        owner.put(f"{base}/members/{account_id}", json={"role": None, "productId": product})
        for _, account_id in members for product in products
    ))
    assert [r.status_code for r in responses] == [204] * len(responses)
    listed = {m["email"] for m in (await owner.get(base + "/members")).json()}
    assert listed == {"alice@acme.test"}
    for member, _ in members:
        assert (await member.get(base)).status_code == 404
        await member.aclose()
    await owner.aclose()


async def test_promoting_an_owner_and_clearing_their_role_concurrently_never_loses_the_owner(postgres_store: PostgresStore) -> None:
    issuer = FakeIssuer()
    app = create_app(
        postgres_store,
        sign_in=SignInSettings(oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID)),
        oidc_transport=issuer.transport,
    )

    async def person(subject: str) -> httpx.AsyncClient:
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=APP)
        login = await client.get("/auth/login")
        assert (await client.get(issuer.authorize(login.headers["location"], subject))).status_code == 302
        client.headers.update({"origin": APP, "x-oe-csrf": (await client.get("/api/session")).json()["csrf"]})
        return client

    async def join(client: httpx.AsyncClient, email: str, role: str) -> str:
        link = (await owner.post(base + "/invitations", json={"email": email, "role": role, "productId": product})).json()
        assert (await client.post("/api/invitations/accept", json={"token": link["token"]})).status_code == 200
        account_id: str = (await client.get("/api/session")).json()["account"]["id"]
        return account_id

    owner = await person("alice")
    workspace = (await owner.post("/api/workspaces", json={"name": "Acme"})).json()
    base, product = f"/api/workspaces/{workspace['id']}", workspace["products"][0]["id"]
    manager = await person("manager")
    await join(manager, "manager@acme.test", "Manager")
    members = [await join(await person(f"member{i}"), f"member{i}@acme.test", "User") for i in range(8)]
    promoted, cleared = await asyncio.gather(
        asyncio.gather(*(owner.put(f"{base}/members/{m}", json={"role": "Owner"}) for m in members)),
        asyncio.gather(*(manager.put(f"{base}/members/{m}", json={"role": None, "productId": product}) for m in members)),
    )
    listed = {m["id"]: m for m in (await owner.get(base + "/members")).json()}
    for account_id, promote, clear in zip(members, promoted, cleared, strict=True):
        if promote.status_code == 204:
            # Promoted first: the Manager may not change an Owner, and the Owner remains.
            assert clear.status_code == 403 and listed[account_id]["owner"] is True
        else:
            # Cleared first: the member left, so there is nobody to promote.
            assert (clear.status_code, promote.status_code) == (204, 404) and account_id not in listed
