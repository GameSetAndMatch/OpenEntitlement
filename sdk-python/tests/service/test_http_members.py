"""HTTP API, black-box: Members, invitation links and the Cloud service tier (OPE-44)."""
from __future__ import annotations

import pytest
from fake_issuer import APP, CLIENT_ID, ISSUER, FakeIssuer, sign_in
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openentitlement_service.interfaces.http import OidcSettings, SignInSettings, create_app
from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.services.workspaces import Deployment

PROBLEMS = "https://openentitlement.dev/problems/"


def build(deployment: Deployment = Deployment.SELF_HOSTED) -> tuple[FastAPI, FakeIssuer]:
    issuer = FakeIssuer()
    settings = SignInSettings(oidc=OidcSettings(app_url=APP, issuer=ISSUER, client_id=CLIENT_ID), platform_admin_subject="root")
    return create_app(InMemoryStore(), sign_in=settings, oidc_transport=issuer.transport, deployment=deployment), issuer


def person(app: FastAPI, issuer: FakeIssuer, subject: str) -> TestClient:
    client = TestClient(app, base_url=APP, raise_server_exceptions=False)
    client.headers.update(sign_in(client, issuer, subject))
    return client


def problem(response, status: int, slug: str) -> dict[str, object]:  # type: ignore[no-untyped-def]
    assert response.status_code == status, response.text
    assert response.headers["content-type"] == "application/problem+json"
    body: dict[str, object] = response.json()
    assert body["type"] == PROBLEMS + slug
    return body


def test_an_invitation_link_joins_the_invited_email_to_its_product() -> None:
    app, issuer = build()
    alice, bob, carol = (person(app, issuer, s) for s in ("alice", "bob", "carol"))
    ws = alice.post("/api/workspaces", json={"name": "Acme"}).json()
    analytics = ws["products"][0]["id"]
    base = f"/api/workspaces/{ws['id']}"

    created = alice.post(base + "/invitations", json={"email": "bob@acme.test", "role": "Manager", "productId": analytics})
    assert created.status_code == 201, created.text
    link = created.json()
    assert (link["email"], link["role"], link["productId"]) == ("bob@acme.test", "Manager", analytics)
    assert link["expiresAt"].startswith("20") and link["token"].startswith(ws["id"] + ".")

    problem(carol.post("/api/invitations/accept", json={"token": link["token"]}), 403, "invitation-for-another-email")
    joined = bob.post("/api/invitations/accept", json={"token": link["token"]})
    assert joined.json() == {"workspaceId": ws["id"], "alreadyMember": False, "role": "Manager"}
    problem(bob.post("/api/invitations/accept", json={"token": link["token"]}), 404, "invitation-invalid")
    assert [(p["id"], p["role"]) for p in bob.get(base).json()["products"]] == [(analytics, "Manager")]

    # The Manager invites a User to their Product, but not an Owner.
    user_link = bob.post(base + "/invitations", json={"email": "carol@acme.test", "role": "User", "productId": analytics}).json()
    carol.post("/api/invitations/accept", json={"token": user_link["token"]})
    refused = problem(bob.post(base + "/invitations", json={"email": "dan@acme.test", "role": "Owner"}), 403, "permission-denied")
    assert refused["permission"] == "owners:manage"
    pointers = problem(alice.post(base + "/invitations", json={"email": "x", "role": "Admin"}), 400, "validation-failed")["errors"]
    assert [e["pointer"] for e in pointers] == ["/role"]  # type: ignore[union-attr,index]

    members = bob.get(base + "/members").json()
    assert [(m["email"], m["role"], [(r["productId"], r["role"]) for r in m["products"]]) for m in members] == [
        ("alice@acme.test", "Owner", []),
        ("bob@acme.test", "Manager", [(analytics, "Manager")]),
        ("carol@acme.test", "User", [(analytics, "User")]),
    ]
    problem(carol.get(base + "/members"), 403, "permission-denied")


def test_roles_change_and_members_are_removed_with_one_owner_kept() -> None:
    app, issuer = build()
    alice, bob = person(app, issuer, "alice"), person(app, issuer, "bob")
    ws = alice.post("/api/workspaces", json={"name": "Acme"}).json()
    base, analytics = f"/api/workspaces/{ws['id']}", ws["products"][0]["id"]
    token = alice.post(base + "/invitations", json={"email": "bob@acme.test", "role": "User", "productId": analytics}).json()["token"]
    assert bob.post("/api/invitations/accept", json={"token": token}).status_code == 200
    bob_id = bob.get("/api/session").json()["account"]["id"]
    alice_id = alice.get("/api/session").json()["account"]["id"]

    problem(alice.put(f"{base}/members/{alice_id}", json={"role": "User", "productId": analytics}), 409, "last-owner")
    problem(alice.delete(f"{base}/members/{alice_id}"), 409, "last-owner")
    assert alice.put(f"{base}/members/{bob_id}", json={"role": "Manager", "productId": analytics}).status_code == 204
    assert bob.get(base).json()["role"] == "Manager"
    assert alice.put(f"{base}/members/{bob_id}", json={"role": "Owner"}).status_code == 204
    # Bob, now Owner, demotes Alice; changing your own access is seen on the next request.
    assert bob.put(f"{base}/members/{alice_id}", json={"role": "User", "productId": analytics}).status_code == 204
    assert alice.get(base).json()["role"] == "User"
    assert bob.delete(f"{base}/members/{alice_id}").status_code == 204
    problem(alice.get(base), 404, "not-found")
    problem(bob.delete(f"{base}/members/{alice_id}"), 404, "not-found")


def test_a_change_without_the_csrf_token_is_refused() -> None:
    app, issuer = build()
    alice = person(app, issuer, "alice")
    ws = alice.post("/api/workspaces", json={"name": "Acme"}).json()
    del alice.headers["x-oe-csrf"]
    problem(alice.post(f"/api/workspaces/{ws['id']}/invitations", json={"email": "b@acme.test", "role": "Owner"}), 403, "csrf-rejected")


def test_the_cloud_service_tier_limits_products_and_only_a_platform_administrator_changes_it() -> None:
    app, issuer = build(Deployment.SAAS)
    alice, root = person(app, issuer, "alice"), person(app, issuer, "root")
    ws = alice.post("/api/workspaces", json={"name": "Acme"}).json()
    base = f"/api/workspaces/{ws['id']}"
    assert ws["hosting"] == {"mode": "saas", "tier": "pro", "subjectEntitlements": False, "productLimit": 1}
    limit = problem(alice.post(base + "/products", json={"key": "storage", "name": "Storage"}), 409, "product-limit")
    assert (limit["serviceTier"], limit["limit"]) == ("pro", 1)

    problem(alice.put(base + "/service-tier", json={"tier": "enterprise", "version": 1}), 403, "permission-denied")
    upgraded = root.put(base + "/service-tier", json={"tier": "enterprise", "version": 1})
    assert upgraded.status_code == 200 and upgraded.json()["hosting"]["tier"] == "enterprise"
    assert upgraded.json()["version"] == 2
    assert alice.post(base + "/products", json={"key": "storage", "name": "Storage"}).status_code == 201

    refused = problem(root.put(base + "/service-tier", json={"tier": "pro", "version": 2}), 409, "product-limit")
    assert [p["name"] for p in refused["products"]] == ["Acme", "Storage"]  # type: ignore[union-attr,index]
    problem(root.put(base + "/service-tier", json={"tier": "pro", "version": 1}), 409, "revision-conflict")


def test_a_self_hosted_install_has_no_product_limit() -> None:
    app, issuer = build()
    alice, root = person(app, issuer, "alice"), person(app, issuer, "root")
    ws = alice.post("/api/workspaces", json={"name": "Acme"}).json()
    assert ws["hosting"] == {"mode": "self_hosted", "tier": "pro", "subjectEntitlements": True, "productLimit": None}
    for key in ("storage", "compute"):
        assert alice.post(f"/api/workspaces/{ws['id']}/products", json={"key": key, "name": key.title()}).status_code == 201
    problem(root.put(f"/api/workspaces/{ws['id']}/service-tier", json={"tier": "enterprise", "version": 1}), 400, "validation-failed")


@pytest.mark.parametrize(("token", "status", "slug"), [("", 404, "invitation-invalid"), ("x" * 201, 400, "validation-failed")])
def test_an_unusable_token_is_refused(token: str, status: int, slug: str) -> None:
    app, issuer = build()
    problem(person(app, issuer, "alice").post("/api/invitations/accept", json={"token": token}), status, slug)
