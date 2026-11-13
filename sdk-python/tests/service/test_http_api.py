"""HTTP API, black-box: what any client of the service observes."""
from __future__ import annotations

import pytest
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from openentitlement_service.interfaces.http import create_app, workspace_transaction
from openentitlement_service.services.models import Product, Workspace
from openentitlement_service.services.problems import NotFound
from openentitlement_service.services.repositories import Repositories
from openentitlement_service.repositories.memory import InMemoryStore

PROBLEM = "application/problem+json"


class TierInput(BaseModel):
    name: str


class ProductInput(BaseModel):
    key: str
    tiers: list[TierInput]

PROBLEMS = "https://openentitlement.dev/problems/"
NOW = datetime(2026, 11, 12, 9, 30, tzinfo=UTC)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(InMemoryStore()), raise_server_exceptions=False)


def test_health_check_answers_ok(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_route_is_a_not_found_problem(client: TestClient) -> None:
    response = client.get("/api/nothing-here")
    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM
    assert response.json() == {
        "type": PROBLEMS + "not-found",
        "title": "Not found",
        "status": 404,
        "detail": "Nothing exists at this address.",
        "instance": "/api/nothing-here",
    }


@pytest.fixture
def probe_client() -> TestClient:
    """The app with two probe routes, to observe how the one handler renders failures."""
    app = create_app(InMemoryStore())

    @app.post("/api/probe/products")
    async def create(product: ProductInput) -> dict[str, str]:
        return {"key": product.key}

    @app.get("/api/probe/page")
    async def page(limit: int = 10) -> dict[str, int]:
        return {"limit": limit}

    @app.get("/api/probe/teapot")
    async def teapot() -> None:
        raise HTTPException(status_code=418, detail="internal hint")

    @app.post("/api/probe/workspaces/{workspace_id}/products")
    async def add_product(
        workspace_id: UUID, product: ProductInput, repos: Repositories = Depends(workspace_transaction)
    ) -> dict[str, str]:
        if not await repos.workspaces.get():
            await repos.workspaces.add(Workspace(id=workspace_id, name="ACME", created_at=NOW))
        await repos.products.add(
            Product(id=uuid4(), workspace_id=workspace_id, key=product.key, name=product.key, created_at=NOW)
        )
        if product.key == "fail-after-writing":
            raise NotFound("The Tier does not exist.")
        return {"key": product.key}

    @app.get("/api/probe/workspaces/{workspace_id}/products")
    async def list_products(repos: Repositories = Depends(workspace_transaction)) -> list[str]:
        return [p.key for p in await repos.products.list()]

    @app.get("/api/probe/boom")
    async def boom() -> None:
        raise RuntimeError("password=hunter2 at db.internal:5432")

    return TestClient(app, raise_server_exceptions=False)


def test_rejected_body_is_one_validation_failed_problem_with_json_pointers(probe_client: TestClient) -> None:
    response = probe_client.post("/api/probe/products", json={"tiers": [{"name": "Basic"}, {}]})
    assert response.status_code == 400
    assert response.headers["content-type"] == PROBLEM
    body = response.json()
    assert body["type"] == PROBLEMS + "validation-failed"
    assert body["title"] == "Validation failed"
    assert body["status"] == 400
    assert body["instance"] == "/api/probe/products"
    assert {e["pointer"] for e in body["errors"]} == {"/key", "/tiers/1/name"}
    assert all(e["detail"] for e in body["errors"])


def test_malformed_json_is_a_validation_failed_problem(probe_client: TestClient) -> None:
    response = probe_client.post(
        "/api/probe/products", content=b"{not json", headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    body = response.json()
    assert body["type"] == PROBLEMS + "validation-failed"
    assert [e["pointer"] for e in body["errors"]] == [""]


def test_rejected_query_parameter_names_its_location(probe_client: TestClient) -> None:
    response = probe_client.get("/api/probe/page", params={"limit": "many"})
    assert response.status_code == 400
    assert [e["pointer"] for e in response.json()["errors"]] == ["/query/limit"]


def test_unexpected_exception_is_a_generic_internal_error_that_exposes_nothing(probe_client: TestClient) -> None:
    response = probe_client.get("/api/probe/boom")
    assert response.status_code == 500
    assert response.headers["content-type"] == PROBLEM
    assert response.json() == {
        "type": PROBLEMS + "internal-error",
        "title": "Internal error",
        "status": 500,
        "detail": "The service failed to complete this request.",
        "instance": "/api/probe/boom",
    }
    assert "hunter2" not in response.text and "RuntimeError" not in response.text


def test_wrong_method_is_a_method_not_allowed_problem(client: TestClient) -> None:
    response = client.delete("/healthz")
    assert response.status_code == 405
    assert response.headers["content-type"] == PROBLEM
    assert response.headers["allow"] == "GET"
    body = response.json()
    assert body["type"] == PROBLEMS + "method-not-allowed"
    assert body["method"] == "DELETE" and body["allowed"] == ["GET"]


@pytest.fixture
def console_client(tmp_path) -> TestClient:  # type: ignore[no-untyped-def]
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>OpenEntitlement</title>")
    (tmp_path / "assets" / "app.js").write_text("console.log('console')")
    return TestClient(create_app(InMemoryStore(), console_dir=tmp_path), raise_server_exceptions=False)


def test_serves_the_built_console(console_client: TestClient) -> None:
    assert "OpenEntitlement" in console_client.get("/").text
    asset = console_client.get("/assets/app.js")
    assert asset.status_code == 200 and "console" in asset.text


def test_console_routes_fall_back_to_the_console_page(console_client: TestClient) -> None:
    response = console_client.get("/workspaces/acme/catalog")
    assert response.status_code == 200
    assert "OpenEntitlement" in response.text


def test_api_addresses_never_fall_back_to_the_console(console_client: TestClient) -> None:
    for path in ("/api/nothing", "/oerep/v1/nothing", "/mcp/nothing"):
        response = console_client.get(path)
        assert response.status_code == 404, path
        assert response.headers["content-type"] == PROBLEM


def test_console_never_serves_files_outside_its_directory(console_client: TestClient, tmp_path) -> None:  # type: ignore[no-untyped-def]
    (tmp_path.parent / "secret.txt").write_text("secret")
    response = console_client.get("/..%2Fsecret.txt")
    assert "secret" not in response.text


def test_unknown_api_address_is_not_found_for_any_method(console_client: TestClient) -> None:
    response = console_client.post("/api/nothing", json={})
    assert response.status_code == 404
    assert response.json()["type"] == PROBLEMS + "not-found"


def test_other_http_errors_are_plain_problems_not_internal_errors(probe_client: TestClient) -> None:
    response = probe_client.get("/api/probe/teapot")
    assert response.status_code == 418
    assert response.headers["content-type"] == PROBLEM
    assert response.json() == {
        "type": "about:blank",
        "title": "I'm a Teapot",
        "status": 418,
        "instance": "/api/probe/teapot",
    }
    assert "internal hint" not in response.text


def test_a_request_commits_its_workspace_transaction(probe_client: TestClient) -> None:
    workspace = uuid4()
    url = f"/api/probe/workspaces/{workspace}/products"
    assert probe_client.post(url, json={"key": "analytics", "tiers": []}).status_code == 200
    assert probe_client.get(url).json() == ["analytics"]
    assert probe_client.get(f"/api/probe/workspaces/{uuid4()}/products").json() == []


def test_a_failed_request_leaves_nothing_behind(probe_client: TestClient) -> None:
    workspace = uuid4()
    url = f"/api/probe/workspaces/{workspace}/products"
    response = probe_client.post(url, json={"key": "fail-after-writing", "tiers": []})
    assert response.status_code == 404
    assert response.json()["detail"] == "The Tier does not exist."
    assert probe_client.get(url).json() == []
