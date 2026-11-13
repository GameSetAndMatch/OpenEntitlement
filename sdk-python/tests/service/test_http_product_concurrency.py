"""Concurrent Product deletion through the HTTP seam against Postgres."""
from __future__ import annotations

import asyncio

import httpx
import pytest
from fake_issuer import APP, CLIENT_ID, ISSUER, FakeIssuer

from openentitlement_service.interfaces.http import OidcSettings, SignInSettings, create_app
from openentitlement_service.repositories.postgres import PostgresStore

pytestmark = pytest.mark.anyio


async def test_concurrent_deletes_keep_the_last_product(postgres_store: PostgresStore) -> None:
    issuer = FakeIssuer()
    app = create_app(
        postgres_store,
        sign_in=SignInSettings(oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID)),
        oidc_transport=issuer.transport,
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=APP) as client:
        login = await client.get('/auth/login')
        callback = issuer.authorize(login.headers['location'], 'alice')
        assert (await client.get(callback)).status_code == 302
        csrf = (await client.get('/api/session')).json()['csrf']
        client.headers.update({'origin': APP, 'x-oe-csrf': csrf})
        workspace = (await client.post('/api/workspaces', json={'name': 'Acme'})).json()
        base = f"/api/workspaces/{workspace['id']}/products"
        created = await asyncio.gather(*(
            client.post(base, json={'key': f'storage_{i}', 'name': f'Storage {i}'})
            for i in range(19)
        ))
        products = [workspace['products'][0], *(response.json() for response in created)]
        responses = await asyncio.gather(*(
            client.delete(f"{base}/{product['id']}?version=1")
            for product in products
        ))
        assert sorted(r.status_code for r in responses) == [204] * 19 + [409]
        assert len((await client.get(base)).json()) == 1
