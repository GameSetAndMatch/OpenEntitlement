"""FastAPI example: uv run --project sdk-python fastapi dev sdk-python/examples/fastapi_app.py.

OpenEntitlement models are Pydantic models, so FastAPI validates requests,
serializes responses and documents both in OpenAPI with no adapter code.
Python code uses snake_case attributes; the JSON is camelCase.

FastAPI is not an OpenEntitlement dependency: install it in your application.
"""

from __future__ import annotations

from fastapi import FastAPI

from openentitlement import (
    UNLIMITED,
    Catalog,
    InMemoryProvider,
    Limit,
    Plan,
    PrivilegeCatalog,
    ResolutionDetails,
    boolean,
    create_client,
    feature,
    integer,
)

CATALOG = Catalog(
    [
        feature("seats", "Seats", [integer("seat_max", default=1, unlimited_allowed=True)]),
        feature("sso", "Single sign-on", [boolean("sso_enabled")]),
    ]
)

# A demo provider seeded in memory; use PostgresProvider or RemoteProvider in production.
client = create_client(
    InMemoryProvider(
        plans=[Plan(id="free", name="Free", rank=0), Plan(id="pro", name="Pro", rank=1)],
        values={"free": {"seat_max": 3, "sso_enabled": False}, "pro": {"seat_max": UNLIMITED, "sso_enabled": True}},
        assignments={"acme": "free", "globex": "pro"},
    ),
    CATALOG,
)

app = FastAPI(title="ACME entitlements")


@app.get("/organizations/{organization_id}/limits/{privilege}")
def get_limit(organization_id: str, privilege: str) -> ResolutionDetails[Limit]:
    """Resolution details in the OEREP JSON shape: ``planId``, ``staleOverrides``, ``{"unlimited": true}``."""
    return client.get_limit_details(privilege, {"organization_id": organization_id})


@app.get("/organizations/{organization_id}/features/{feature_code}")
def get_feature(organization_id: str, feature_code: str) -> ResolutionDetails[bool]:
    return client.is_enabled_details(feature_code, {"organization_id": organization_id})


@app.post("/privilege-catalog")
def check_privilege_catalog(catalog: PrivilegeCatalog) -> PrivilegeCatalog:
    """Validate a Privilege Catalog (camelCase JSON) and echo its normalized form; invalid input is a 422."""
    return catalog
