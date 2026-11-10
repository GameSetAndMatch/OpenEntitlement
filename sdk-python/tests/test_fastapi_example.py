"""The FastAPI example: camelCase JSON on the wire and in the generated OpenAPI schema."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "fastapi_app.py"


@pytest.fixture(scope="module")
def api() -> TestClient:
    spec = importlib.util.spec_from_file_location("fastapi_app", EXAMPLE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # generic models such as ResolutionDetails[Limit] register by module
    spec.loader.exec_module(module)
    return TestClient(module.app)


def test_resolution_details_are_oerep_camel_case_json(api: TestClient) -> None:
    r = api.get("/organizations/acme/limits/seat_max")
    assert r.status_code == 200
    assert r.json() == {
        "privilege": "seat_max",
        "value": 3,
        "reason": "PLAN",
        "grants": [],
        "staleOverrides": [],
        "planId": "free",
        "planValue": 3,
    }
    pro = api.get("/organizations/globex/limits/seat_max").json()
    assert pro["value"] == {"unlimited": True} and pro["planValue"] == {"unlimited": True}
    denied = api.get("/organizations/acme/features/sso").json()
    assert denied["value"] is False and denied["requiredPlan"] == "pro" and denied["feature"] == "sso"


def test_privilege_catalog_accepts_and_returns_camel_case(api: TestClient) -> None:
    body = {
        "groups": [{"id": "ai", "title": "AI"}],
        "tags": [{"id": "usage", "title": "Usage"}],
        "privileges": [
            {"type": "boolean", "key": "mcp_enabled", "title": "MCP", "default": False, "groupId": "ai",
             "tags": ["usage"], "envOverride": "MCP_INSTALLED"},
            {"type": "integer", "key": "seat_max", "title": "Seats", "default": {"unlimited": True}, "unlimited": True},
        ],
    }
    r = api.post("/privilege-catalog", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["privileges"][0]["groupId"] == "ai" and out["privileges"][0]["envOverride"] == "MCP_INSTALLED"
    assert "group_id" not in out["privileges"][0]
    assert out["privileges"][1]["default"] == {"unlimited": True}
    # Python-style keys are accepted too, and invalid catalogs are rejected with 422.
    snake = {"privileges": [{"type": "boolean", "key": "x", "title": "X", "group_id": "missing"}]}
    assert api.post("/privilege-catalog", json=snake).status_code == 422


def test_openapi_schema_uses_camel_case_property_names(api: TestClient) -> None:
    schemas = api.get("/openapi.json").json()["components"]["schemas"]
    details = next(v for k, v in schemas.items() if k.startswith("ResolutionDetails"))
    assert {"staleOverrides", "planId", "planValue", "overrideId", "requiredPlan", "errorCode", "lockDomain"} <= set(
        details["properties"]
    )
    assert not any("_" in name for name in details["properties"])
    assert "hasPlanValue" not in details["properties"]
    privilege = next(v for k, v in schemas.items() if k.startswith("BooleanPrivilege"))
    assert {"groupId", "envOverride"} <= set(privilege["properties"])
    assert not any("_" in name for s in schemas.values() for name in s.get("properties", {}))
