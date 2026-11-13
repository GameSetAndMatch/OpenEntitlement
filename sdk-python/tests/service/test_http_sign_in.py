"""HTTP API, black-box: OIDC sign-in, the session cookie, CSRF, Workspaces and Products."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fake_issuer import APP, CLIENT_ID, ISSUER, FakeIssuer, sign_in
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openentitlement_service.interfaces.http import OidcSettings, SignInSettings, WorkspaceAccess, create_app
from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.services.models import Member, Product, ProductMembership, ProductRole
from openentitlement_service.services.problems import NotFound
from openentitlement_service.services.repositories import Repositories

PROBLEMS = "https://openentitlement.dev/problems/"
PROBLEM = "application/problem+json"


@pytest.fixture
def issuer() -> FakeIssuer:
    return FakeIssuer()


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore()


@pytest.fixture
def app(store: InMemoryStore, issuer: FakeIssuer) -> FastAPI:
    settings = SignInSettings(
        oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID),
        platform_admin_subject="root",
    )
    return create_app(store, sign_in=settings, oidc_transport=issuer.transport)


def browser(app: FastAPI) -> TestClient:
    return TestClient(app, base_url=APP, raise_server_exceptions=False)


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return browser(app)


def problem(response: object, status: int, slug: str) -> dict[str, object]:
    from httpx import Response

    assert isinstance(response, Response)
    assert response.status_code == status, response.text
    assert response.headers["content-type"] == PROBLEM
    body: dict[str, object] = response.json()
    assert body["type"] == PROBLEMS + slug
    return body


# Sign-in.


def test_signing_in_sets_a_protected_session_cookie_and_returns_to_the_console(client: TestClient, issuer: FakeIssuer) -> None:
    login = client.get("/auth/login", follow_redirects=False)
    assert login.status_code == 302 and login.headers["cache-control"] == "no-store"
    flow_cookie = login.headers["set-cookie"]
    assert flow_cookie.startswith("oe_flow=") and "HttpOnly" in flow_cookie and "SameSite=lax" in flow_cookie and "Secure" in flow_cookie
    callback = client.get(issuer.authorize(login.headers["location"], "alice"), follow_redirects=False)
    assert callback.status_code == 302 and callback.headers["location"] == "/app/"
    session_cookie = next(c for c in callback.headers.get_list("set-cookie") if c.startswith("oe_session="))
    assert "HttpOnly" in session_cookie and "SameSite=lax" in session_cookie and "Secure" in session_cookie
    assert "Max-Age=43200" in session_cookie
    session = client.get("/api/session").json()
    assert session["account"]["email"] == "alice@acme.test" and session["account"]["platformAdmin"] is False
    assert len(session["csrf"]) >= 32


def test_the_configured_subject_signs_in_as_platform_administrator(client: TestClient, issuer: FakeIssuer) -> None:
    sign_in(client, issuer, "root")
    assert client.get("/api/session").json()["account"]["platformAdmin"] is True


def test_the_api_requires_signing_in(client: TestClient) -> None:
    for response in (client.get("/api/session"), client.get("/api/workspaces"), client.get(f"/api/workspaces/{uuid4()}")):
        problem(response, 401, "sign-in-required")
    client.cookies.set("oe_session", "forged", domain="console.test")
    problem(client.get("/api/session"), 401, "sign-in-required")


def test_a_callback_with_another_state_fails_and_uses_up_the_flow(client: TestClient, issuer: FakeIssuer) -> None:
    login = client.get("/auth/login", follow_redirects=False)
    callback = issuer.authorize(login.headers["location"], "alice")
    problem(client.get(callback.replace("state=", "state=x"), follow_redirects=False), 401, "sign-in-failed")
    problem(client.get(callback, follow_redirects=False), 401, "sign-in-failed")
    problem(client.get("/api/session"), 401, "sign-in-required")


def test_a_callback_without_its_flow_cookie_fails(app: FastAPI, issuer: FakeIssuer) -> None:
    started, elsewhere = browser(app), browser(app)
    callback = issuer.authorize(started.get("/auth/login", follow_redirects=False).headers["location"], "alice")
    problem(elsewhere.get(callback, follow_redirects=False), 401, "sign-in-failed")


def test_an_issuer_error_fails_the_sign_in(client: TestClient) -> None:
    login = client.get("/auth/login", follow_redirects=False)
    state = login.headers["location"].split("state=")[1].split("&")[0]
    problem(client.get(f"/auth/callback?error=access_denied&state={state}", follow_redirects=False), 401, "sign-in-failed")


@pytest.mark.parametrize(
    "tamper",
    [
        {"nonce": "replayed"},
        {"aud": "another-client"},
        {"iss": "https://evil.test"},
        {"exp": 1_000_000_000},
        "unknown key",
    ],
    ids=["nonce", "audience", "issuer", "expired", "signature"],
)
def test_an_id_token_that_fails_verification_fails_the_sign_in(client: TestClient, issuer: FakeIssuer, tamper: object) -> None:
    if tamper == "unknown key":
        issuer.sign_with_unknown_key = True
    else:
        assert isinstance(tamper, dict)
        issuer.id_token_overrides = tamper
    login = client.get("/auth/login", follow_redirects=False)
    problem(client.get(issuer.authorize(login.headers["location"], "alice"), follow_redirects=False), 401, "sign-in-failed")
    problem(client.get("/api/session"), 401, "sign-in-required")


def test_userinfo_for_another_subject_fails_the_sign_in(client: TestClient, issuer: FakeIssuer) -> None:
    issuer.userinfo_overrides = {"sub": "mallory"}
    login = client.get("/auth/login", follow_redirects=False)
    problem(client.get(issuer.authorize(login.headers["location"], "alice"), follow_redirects=False), 401, "sign-in-failed")


def test_an_unverified_email_is_refused(client: TestClient, issuer: FakeIssuer) -> None:
    issuer.userinfo_overrides = {"email_verified": "true"}
    login = client.get("/auth/login", follow_redirects=False)
    body = problem(client.get(issuer.authorize(login.headers["location"], "alice"), follow_redirects=False), 403, "sign-in-refused")
    assert body["reason"] == "email-not-verified"


def test_signing_in_is_unavailable_until_configured() -> None:
    client = TestClient(create_app(InMemoryStore()), raise_server_exceptions=False)
    problem(client.get("/auth/login", follow_redirects=False), 503, "service-unavailable")
    problem(client.get("/api/session"), 401, "sign-in-required")


# Sign-out and CSRF.


def test_signing_out_ends_the_session(client: TestClient, issuer: FakeIssuer) -> None:
    headers = sign_in(client, issuer, "alice")
    response = client.post("/auth/logout", headers=headers)
    assert response.status_code == 204
    assert 'oe_session=""' in response.headers["set-cookie"] and "Max-Age=0" in response.headers["set-cookie"]
    problem(client.get("/api/session"), 401, "sign-in-required")


@pytest.mark.parametrize(
    "headers",
    [{}, {"origin": APP}, {"origin": "https://evil.test", "x-oe-csrf": "{csrf}"}, {"origin": APP, "x-oe-csrf": "wrong"}],
    ids=["nothing", "no token", "other origin", "wrong token"],
)
def test_a_change_without_the_consoles_origin_and_csrf_token_is_refused(client: TestClient, issuer: FakeIssuer, headers: dict[str, str]) -> None:
    csrf = sign_in(client, issuer, "alice")["x-oe-csrf"]
    sent = {k: v.replace("{csrf}", csrf) for k, v in headers.items()}
    problem(client.post("/api/workspaces", json={"name": "Acme"}, headers=sent), 403, "csrf-rejected")
    problem(client.post("/auth/logout", headers=sent), 403, "csrf-rejected")
    assert client.get("/api/workspaces").json() == []


# Workspaces and Products.


def test_creating_a_workspace_lists_it_with_its_first_product(client: TestClient, issuer: FakeIssuer) -> None:
    headers = sign_in(client, issuer, "alice")
    created = client.post("/api/workspaces", json={"name": "Acme analytics"}, headers=headers)
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "Acme analytics" and body["role"] == "Owner"
    assert [(p["key"], p["name"], p["role"], p["version"]) for p in body["products"]] == [("acme_analytics", "Acme analytics", "Owner", 1)]
    assert client.get("/api/workspaces").json() == [{"id": body["id"], "name": "Acme analytics", "role": "Owner"}]
    assert client.get(f"/api/workspaces/{body['id']}").json() == body


def test_a_workspace_name_is_required(client: TestClient, issuer: FakeIssuer) -> None:
    headers = sign_in(client, issuer, "alice")
    body = problem(client.post("/api/workspaces", json={"name": "  "}, headers=headers), 400, "validation-failed")
    assert body["errors"] == [{"pointer": "/name", "detail": "Enter a name."}]


def test_another_accounts_workspace_is_not_found(app: FastAPI, issuer: FakeIssuer) -> None:
    alice, bob = browser(app), browser(app)
    created = alice.post("/api/workspaces", json={"name": "Acme"}, headers=sign_in(alice, issuer, "alice")).json()
    bob_headers = sign_in(bob, issuer, "bob")
    for response in (
        bob.get(f"/api/workspaces/{created['id']}"),
        bob.get(f"/api/workspaces/{uuid4()}"),
        bob.post(f"/api/workspaces/{created['id']}/products", json={"key": "x", "name": "X"}, headers=bob_headers),
    ):
        problem(response, 404, "not-found")
    assert bob.get("/api/workspaces").json() == []


def test_an_owner_manages_products(client: TestClient, issuer: FakeIssuer) -> None:
    headers = sign_in(client, issuer, "alice")
    workspace = client.post("/api/workspaces", json={"name": "Acme"}, headers=headers).json()
    base = f"/api/workspaces/{workspace['id']}/products"
    first = workspace["products"][0]
    problem(client.delete(f"{base}/{first['id']}?version=1", headers=headers), 409, "last-product")
    storage = client.post(base, json={"key": "storage", "name": "Storage"}, headers=headers)
    assert storage.status_code == 201
    problem(client.post(base, json={"key": "storage", "name": "Again"}, headers=headers), 409, "already-exists")
    renamed = client.patch(f"{base}/{first['id']}", json={"name": "Analytics", "version": 1}, headers=headers).json()
    assert (renamed["id"], renamed["key"], renamed["name"], renamed["version"]) == (first["id"], "acme", "Analytics", 2)
    stale = problem(client.patch(f"{base}/{first['id']}", json={"name": "Old", "version": 1}, headers=headers), 409, "revision-conflict")
    assert stale["kind"] == "Product" and stale["id"] == first["id"]
    archived = client.post(f"{base}/{first['id']}/archive", json={"version": 2}, headers=headers).json()
    assert archived["archivedAt"] is not None and archived["version"] == 3
    restored = client.post(f"{base}/{first['id']}/restore", json={"version": 3}, headers=headers).json()
    assert restored["archivedAt"] is None
    assert client.delete(f"{base}/{storage.json()['id']}?version=1", headers=headers).status_code == 204
    assert [p["key"] for p in client.get(base).json()] == ["acme"]


def grant(store: InMemoryStore, workspace_id: str, account_id: str, roles: dict[str, ProductRole]) -> None:
    """Members and invitations arrive with OPE-44; until then a test seeds a Role in the store."""
    import anyio

    async def seed() -> None:
        async with store.transaction(UUID(workspace_id)) as repos:
            await repos.members.add(Member(workspace_id=UUID(workspace_id), account_id=UUID(account_id), created_at=datetime.now(UTC)))
            for product_id, role in roles.items():
                await repos.members.set_product_role(
                    ProductMembership(workspace_id=UUID(workspace_id), product_id=UUID(product_id), account_id=UUID(account_id), role=role)
                )

    anyio.run(seed)


def test_a_member_sees_only_their_products_and_cannot_manage_them(app: FastAPI, store: InMemoryStore, issuer: FakeIssuer) -> None:
    owner, manager = browser(app), browser(app)
    owner_headers = sign_in(owner, issuer, "alice")
    workspace = owner.post("/api/workspaces", json={"name": "Acme"}, headers=owner_headers).json()
    base = f"/api/workspaces/{workspace['id']}/products"
    storage = owner.post(base, json={"key": "storage", "name": "Storage"}, headers=owner_headers).json()
    manager_headers = sign_in(manager, issuer, "bob")
    grant(store, workspace["id"], manager.get("/api/session").json()["account"]["id"], {storage["id"]: ProductRole.MANAGER})
    assert manager.get("/api/workspaces").json() == [{"id": workspace["id"], "name": "Acme", "role": "Manager"}]
    assert [(p["key"], p["role"]) for p in manager.get(base).json()] == [("storage", "Manager")]
    denied = problem(manager.patch(f"{base}/{storage['id']}", json={"name": "Mine", "version": 1}, headers=manager_headers), 403, "permission-denied")
    assert denied["permission"] == "products:manage"
    problem(manager.post(base, json={"key": "billing", "name": "Billing"}, headers=manager_headers), 403, "permission-denied")
    hidden = workspace["products"][0]["id"]
    problem(manager.get(f"{base}/{hidden}"), 404, "not-found")
    problem(manager.delete(f"{base}/{hidden}?version=1", headers=manager_headers), 404, "not-found")


# The request's Workspace transaction.


@pytest.fixture
def probe(app: FastAPI) -> FastAPI:
    """A route that writes in the Workspace transaction, then fails when asked to."""
    @app.post("/api/probe/workspaces/{workspace_id}/write")
    async def write(workspace: WorkspaceAccess, fail: bool = False) -> dict[str, bool]:
        product = Product(id=uuid4(), workspace_id=workspace.actor.workspace_id, key="probe", name="Probe", created_at=workspace.now)
        await workspace.repos.products.add(product)
        if fail:
            raise NotFound("The Tier does not exist.")
        return {"written": True}

    return app


def test_a_request_commits_its_workspace_transaction_and_a_failed_one_leaves_nothing(probe: FastAPI, issuer: FakeIssuer) -> None:
    client = browser(probe)
    headers = sign_in(client, issuer, "alice")
    workspace = client.post("/api/workspaces", json={"name": "Acme"}, headers=headers).json()
    url = f"/api/probe/workspaces/{workspace['id']}/write"
    failed = client.post(url + "?fail=true", headers=headers)
    assert failed.status_code == 404 and failed.json()["detail"] == "The Tier does not exist."
    assert [p["key"] for p in client.get(f"/api/workspaces/{workspace['id']}/products").json()] == ["acme"]
    assert client.post(url, headers=headers).status_code == 200
    assert [p["key"] for p in client.get(f"/api/workspaces/{workspace['id']}/products").json()] == ["acme", "probe"]


class CommitFails(InMemoryStore):
    """A store whose Workspace commits fail after the route finished, like a lost connection at COMMIT."""

    @asynccontextmanager
    async def transaction(self, workspace_id: UUID | None = None, *, account_id: UUID | None = None) -> AsyncIterator[Repositories]:
        async with super().transaction(workspace_id, account_id=account_id) as repos:
            yield repos
        if workspace_id is not None:
            raise ConnectionError("server closed the connection during COMMIT")


def test_a_failed_commit_is_never_reported_as_success(issuer: FakeIssuer) -> None:
    settings = SignInSettings(oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID))
    client = browser(create_app(CommitFails(), sign_in=settings, oidc_transport=issuer.transport))
    response = client.post("/api/workspaces", json={"name": "Acme"}, headers=sign_in(client, issuer, "alice"))
    assert response.status_code == 500
    assert response.json()["type"] == PROBLEMS + "internal-error"
