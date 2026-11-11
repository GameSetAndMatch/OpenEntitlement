import json

import pytest
from pydantic import ValidationError

from openentitlement.authoring import (
    BooleanPrivilege,
    Group,
    IntegerPrivilege,
    Privilege,
    PrivilegeCatalog,
    StringEnumPrivilege,
    Tag,
)


def test_pydantic_catalog_roundtrip_and_schema():
    catalog = PrivilegeCatalog(
        groups=[Group(id="collaboration", title="Collaboration")],
        tags=[Tag(id="licensed", title="Licensed")],
        privileges=[
            IntegerPrivilege(
                key="seat_max",
                title="Seats",
                default=5,
                minimum=0,
                maximum=500,
                group_id="collaboration",
                tags=["licensed"],
            )
        ],
    )
    payload = catalog.model_dump_json(exclude_none=True)
    assert PrivilegeCatalog.model_validate_json(payload) == catalog
    assert json.loads(payload)["privileges"][0]["key"] == "seat_max"
    assert IntegerPrivilege.model_json_schema()["properties"]["minimum"]["minimum"] == -(2**53 - 1)
    assert IntegerPrivilege.model_json_schema()["properties"]["minimum"]["maximum"] == 2**53 - 1
    assert (
        Privilege.from_dict({"type": "boolean", "key": "export_enabled", "title": "Exports", "default": False}).default
        is False
    )


@pytest.mark.parametrize(
    "data",
    [
        {"type": "integer", "default": True},
        {"type": "integer", "default": "5"},
        {"type": "integer", "minimum": 2, "default": 1},
        {"type": "integer", "env_override": "MCP_INSTALLED"},
        {"type": "boolean", "default": "false"},
        {"type": "boolean", "default": None},
        {"type": "boolean", "visibility": "read_only"},
        {"type": "enum", "enum": ["short", "long"], "default": "other"},
    ],
)
def test_pydantic_rejects_coercion_and_invalid_contracts(data):
    with pytest.raises(ValidationError):
        Privilege.from_dict({"key": "allowance", "title": "Allowance", **data})


def test_pydantic_uses_same_groups_and_tags_invariants():
    with pytest.raises(ValidationError, match="unknown Group"):
        PrivilegeCatalog(privileges=[BooleanPrivilege(key="export_enabled", title="Exports", group_id="missing")])
    with pytest.raises(ValidationError, match="unique Tag"):
        BooleanPrivilege(key="export_enabled", title="Exports", tags=["same", "same"])
    with pytest.raises(ValidationError):
        StringEnumPrivilege(key="retention", title="Retention", enum=["short"], env_override="RETENTION")


def test_pydantic_and_zod_share_serialized_catalog():
    import shutil
    import subprocess
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    if not shutil.which("node") or not (root / "console/node_modules").exists():
        pytest.skip("cross-language authoring needs the Node workspace")
    catalog = PrivilegeCatalog(
        groups=[Group(id="collaboration", title="Collaboration")],
        tags=[Tag(id="licensed", title="Licensed")],
        privileges=[
            IntegerPrivilege(key="seat_max", title="Seats", default=5, group_id="collaboration", tags=["licensed"]),
            BooleanPrivilege(key="export_enabled", title="Exports", default=False),
        ],
    )
    script = "import {parseCatalog} from './packages/core/src/authoring.ts'; let input=''; for await (const c of process.stdin) input+=c; console.log(JSON.stringify(parseCatalog(JSON.parse(input))));"
    result = subprocess.run(
        ["node", "--conditions=source", "--input-type=module", "-e", script],
        cwd=root / "sdk-js",
        input=catalog.to_json(),
        text=True,
        capture_output=True,
        check=True,
    )
    assert json.loads(result.stdout) == catalog.to_dict()


def test_pydantic_python_names_are_snake_case_and_json_is_camel_case():
    privilege = BooleanPrivilege(
        key="mcp_enabled", title="MCP", default=False, group_id="ai", env_override="MCP_INSTALLED"
    )
    assert privilege.group_id == "ai"
    dumped = privilege.to_dict()
    assert dumped["groupId"] == "ai" and dumped["envOverride"] == "MCP_INSTALLED"
    assert "group_id" not in dumped and "env_override" not in dumped
    # JSON Schema (and therefore FastAPI's OpenAPI) advertises the camelCase names.
    properties = BooleanPrivilege.model_json_schema()["properties"]
    assert "groupId" in properties and "envOverride" in properties
    # Both spellings validate, so Python callers and JSON clients can each use their own convention.
    camel = {"type": "boolean", "key": "mcp_enabled", "title": "MCP", "default": False, "groupId": "ai"}
    snake = {**camel, "group_id": "ai"}
    del snake["groupId"]
    assert Privilege.from_dict(camel) == Privilege.from_dict(snake)
    assert Group.model_validate({"id": "ai", "title": "AI", "parentId": "root"}).parent_id == "root"


def test_unlimited_default_round_trips_as_the_wire_encoding():
    seats = IntegerPrivilege(key="seat_max", title="  Seats  ", default={"unlimited": True}, unlimited=True)
    assert seats.title == "Seats"
    assert seats.to_dict()["default"] == {"unlimited": True}
    assert IntegerPrivilege.model_validate_json(seats.to_json()) == seats
    with pytest.raises(ValidationError, match="Unlimited is not allowed"):
        IntegerPrivilege(key="seat_max", title="Seats", default={"unlimited": True})
