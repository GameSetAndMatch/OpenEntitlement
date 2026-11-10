import json

import pytest
from pydantic import ValidationError
from openentitlement.privileges import (
    BooleanPrivilege,
    Group,
    IntegerPrivilege,
    Privilege,
    PrivilegeCatalog,
    StringEnumPrivilege,
    Tag,
    Visibility,
)


def test_privilege_models_round_trip_with_one_group_and_many_tags():
    Group(id="mcp", title="MCP")
    Tag(id="enterprise", title="Enterprise")
    Tag(id="integration", title="Integration")
    privilege = BooleanPrivilege(
        key="mcp_enabled", title="MCP access", default=False,
        visibility=Visibility.READ_ONLY, env_override="MCP_INSTALLED",
        group_id="mcp", tags=("enterprise", "integration"),
    )
    dumped = json.loads(privilege.to_json())
    assert dumped["type"] == "boolean"
    assert dumped["visibility"] == "read_only"
    assert dumped["groupId"] == "mcp"
    assert dumped["envOverride"] == "MCP_INSTALLED"
    assert "group_id" not in dumped
    assert dumped["tags"] == ["enterprise", "integration"]
    assert Privilege.from_dict(dumped) == privilege


def test_env_override_is_only_a_boolean_model_field():
    for kind in ("integer", "enum"):
        with pytest.raises(ValidationError):
            Privilege.from_dict({"key": "value", "title": "Value", "type": kind, "env_override": "SETTING"})
    with pytest.raises(ValidationError):
        Privilege.from_dict({"key": "value", "title": "Value", "type": "boolean", "group_ids": ["one", "two"]})
    with pytest.raises(ValueError):
        BooleanPrivilege(key="access", title="Access", default=False, tags=("same", "same"))


def test_defaults_and_typed_constraints_are_validated():
    assert IntegerPrivilege(key="seats", title="Seats", default=10, minimum=0, maximum=20).default == 10
    assert StringEnumPrivilege(key="retention", title="Retention", enum=("30d", "365d"), default="30d").default == "30d"
    with pytest.raises(ValueError):
        IntegerPrivilege(key="seats", title="Seats", default=True)
    with pytest.raises(ValueError):
        StringEnumPrivilege(key="retention", title="Retention", enum=("30d",), default="365d")
    with pytest.raises(ValueError):
        BooleanPrivilege(key="access", title="Access", visibility=Visibility.HIDDEN)


def test_catalog_checks_references_cycles_and_multiple_tags():
    from openentitlement import PrivilegeCatalog

    catalog = PrivilegeCatalog(
        groups=(Group(id="mcp", title="MCP"),),
        tags=(Tag(id="enterprise", title="Enterprise"), Tag(id="integration", title="Integration")),
        privileges=(BooleanPrivilege(key="mcp_enabled", title="MCP", default=False,
            group_id="mcp", tags=("enterprise", "integration")),),
    )
    assert PrivilegeCatalog.from_dict(json.loads(catalog.to_json())) == catalog
    with pytest.raises(ValueError, match="unknown Tag"):
        PrivilegeCatalog(privileges=catalog.privileges, groups=catalog.groups)
    with pytest.raises(ValueError, match="cycle"):
        PrivilegeCatalog(privileges=(), groups=(Group(id="one", title="One", parent_id="two"), Group(id="two", title="Two", parent_id="one")))


@pytest.mark.parametrize("default", [{}, {"unlimited": 1}, {"unlimited": False}, {"unlimited": None}, {"unlimited": True, "extra": 0}])
def test_unlimited_requires_explicit_true(default):
    with pytest.raises(ValueError):
        IntegerPrivilege(key="seats", title="Seats", unlimited=True, default=default)


@pytest.mark.parametrize("field", ["groupId", "maximum", "default"])
def test_explicit_null_is_rejected(field):
    with pytest.raises(ValueError):
        IntegerPrivilege.model_validate({"key": "seats", "title": "Seats", field: None})


def test_nested_normal_serialization_omits_absent_fields():
    from pydantic import BaseModel

    class Response(BaseModel):
        catalog: PrivilegeCatalog

    catalog = PrivilegeCatalog(privileges=(BooleanPrivilege(key="enabled", title="Enabled"),))
    raw = json.loads(Response(catalog=catalog).model_dump_json())["catalog"]
    assert "groupId" not in raw["privileges"][0]
    assert "default" not in raw["privileges"][0]
    assert "envOverride" not in raw["privileges"][0]
    assert PrivilegeCatalog.model_validate(raw) == catalog
