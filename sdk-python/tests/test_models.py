"""The Pydantic models (ADR-0006): snake_case attributes, camelCase JSON, OEREP wire compatibility."""

from __future__ import annotations

import json
import pickle
from datetime import datetime, timezone

import pytest
from pydantic import TypeAdapter, ValidationError

from openentitlement import (
    UNLIMITED,
    AuditEvent,
    Capabilities,
    Catalog,
    EvaluationContext,
    Grant,
    GrantApplied,
    InMemoryProvider,
    InvalidArgument,
    InvalidValue,
    Override,
    Plan,
    Reason,
    ResolutionDetails,
    Scope,
    UsageBreakdown,
    create_client,
    feature,
    integer,
)
from openentitlement.model import OpenEntitlementModel
from openentitlement.values import Limit

T0 = datetime(2026, 6, 15, 12, tzinfo=timezone.utc)


def test_every_public_model_is_a_frozen_pydantic_model() -> None:
    import openentitlement

    models = [v for v in vars(openentitlement).values() if isinstance(v, type) and issubclass(v, OpenEntitlementModel)]
    assert len(models) >= 25
    for model in models:
        assert model.model_config["frozen"] and model.model_config["serialize_by_alias"]
    with pytest.raises(ValidationError):
        Plan(id="free", name="Free").name = "Other"  # type: ignore[misc]


def test_resolution_details_json_is_the_oerep_wire_shape() -> None:
    d = ResolutionDetails(
        privilege="seat_max",
        value=UNLIMITED,
        reason=Reason.GRANT,
        grants=(GrantApplied(id="g1", amount=2, subject_id="alice"), GrantApplied(id="g2", amount=1)),
        plan_id="pro",
        plan_value=UNLIMITED,
        has_plan_value=True,
    )
    wire = {
        "privilege": "seat_max",
        "value": {"unlimited": True},
        "reason": "GRANT",
        "grants": [{"id": "g1", "amount": 2, "subjectId": "alice"}, {"id": "g2", "amount": 1}],
        "staleOverrides": [],
        "planId": "pro",
        "planValue": {"unlimited": True},
    }
    assert d.to_dict() == wire
    assert d.model_dump() == wire and json.loads(d.model_dump_json()) == wire
    # An absent plan value stays absent even when it is None or falsy.
    plain = ResolutionDetails(privilege="sso_enabled", value=False, reason=Reason.DEFAULT)
    assert plain.model_dump() == {"privilege": "sso_enabled", "value": False, "reason": "DEFAULT", "grants": [], "staleOverrides": []}
    zero = plain.with_(plan_value=None, has_plan_value=True)
    assert zero.to_dict()["planValue"] is None


def test_fact_and_audit_json_keep_isoformat_timestamps() -> None:
    scope = Scope(organization_id="acme", subject_id="alice")
    o = Override(id="o1", scope=scope, privilege="seat_max", value=UNLIMITED, plan_family="pro", reason="deal", starts_at=T0)
    g = Grant(id="g1", scope=scope, privilege="seat_max", amount=5, reason="pack", expires_at=T0)
    e = AuditEvent(actor="ops", reason="deal", entity="override", entity_id="o1", action="create", before=None, after=o.to_dict(), at=T0)
    for model in (o, g, e, Plan(id="pro", name="Pro", rank=1)):
        assert json.loads(model.model_dump_json()) == model.to_dict() == model.model_dump()
    assert o.to_dict()["startsAt"] == "2026-06-15T12:00:00+00:00" and o.to_dict()["value"] == {"unlimited": True}
    assert "resourceId" not in g.to_dict()["scope"]


def test_validation_accepts_snake_case_and_camel_case() -> None:
    assert EvaluationContext.model_validate({"organizationId": "acme", "subjectId": "a"}) == EvaluationContext(
        organization_id="acme", subject_id="a"
    )
    assert Plan.model_validate({"id": "x", "name": "X", "variantOf": "pro"}).variant_of == "pro"
    assert Plan.model_validate({"id": "x", "name": "X", "variant_of": "pro"}).family == "pro"
    assert UsageBreakdown.model_validate({"pool": 3}).to_dict() == {"pool": 3, "subject": 0}
    with pytest.raises(ValidationError):
        Plan(id="x", name="X", colour="red")  # type: ignore[call-arg]


def test_json_schema_uses_camel_case_and_hides_internal_flags() -> None:
    schema = TypeAdapter(ResolutionDetails[Limit]).json_schema(mode="serialization")
    props = schema["properties"]
    assert {"staleOverrides", "planId", "planValue", "errorCode", "lockDomain"} <= props.keys()
    assert "hasPlanValue" not in props and "stale_overrides" not in props
    assert {"type": "integer"} in props["value"]["anyOf"]
    assert any(s.get("properties", {}).get("unlimited") for s in props["value"]["anyOf"])


def test_unlimited_validates_from_its_json_form() -> None:
    adapter = TypeAdapter(Limit)
    assert adapter.validate_python({"unlimited": True}) is UNLIMITED
    assert adapter.validate_python(UNLIMITED) is UNLIMITED and adapter.validate_python(5) == 5
    assert adapter.dump_python(UNLIMITED) == {"unlimited": True}
    with pytest.raises(ValidationError):
        adapter.validate_python({"unlimited": False})


def test_dataclass_compatibility_positional_equality_hash_copy() -> None:
    assert Plan("free", "Free", rank=0) == Plan(id="free", name="Free", rank=0)
    assert len({Plan("free", "Free"), Plan(id="free", name="Free"), Scope(organization_id="acme")}) == 2
    with pytest.raises(TypeError):
        Plan("free", "Free", id="other")
    caps = Capabilities(grants=True)
    assert caps.tags() == {"grants"} and pickle.loads(pickle.dumps(caps)) == caps
    d = ResolutionDetails[int](privilege="seat_max", value=3, reason=Reason.PLAN)
    assert isinstance(d, ResolutionDetails) and d.with_(value=4).value == 4 and d.value == 3
    assert d.with_(value=4) == ResolutionDetails(privilege="seat_max", value=4, reason=Reason.PLAN)
    assert hash(d.with_(value=4)) == hash(ResolutionDetails(privilege="seat_max", value=4, reason=Reason.PLAN))
    with pytest.raises(TypeError):
        d.with_(colour="red")


def test_omitted_and_explicitly_invalid_tenants_differ() -> None:
    default = EvaluationContext(organization_id="acme")
    assert default.merged_with(EvaluationContext(subject_id="a")).organization_id == "acme"
    assert default.merged_with(EvaluationContext(organization_id=None)).validation_error() == "organization_id is required"
    # Identifiers are checked at evaluation, never on construction.
    assert EvaluationContext(organization_id=0).validation_error() == "organization_id is required"  # type: ignore[arg-type]


def test_malformed_admin_arguments_raise_sdk_errors() -> None:
    catalog = Catalog([feature("seats", "Seats", [integer("seat_max", default=1)])])
    c = create_client(InMemoryProvider(), catalog)
    with pytest.raises(InvalidValue):
        c.admin.create_grant("acme", "seat_max", True, actor="ops", reason="pack")  # type: ignore[arg-type]
    with pytest.raises(InvalidArgument):
        c.admin.create_grant(None, "seat_max", 1, actor="ops", reason="pack")  # type: ignore[arg-type]
    with pytest.raises(InvalidArgument):
        c.admin.assign_plan("acme", "free", actor=None, reason="x")  # type: ignore[arg-type]
