"""Evaluation context, resolution details, reasons, usage (spec §2, §4.3-4.5)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Generic, Mapping, Optional, TypeVar, Union

from pydantic import Field, SkipValidation, StrictInt, model_validator

from .errors import InvalidArgument
from .model import OpenEntitlementModel, WireModel
from .values import decode_value, encode_value, is_int

T = TypeVar("T")

# Context identifiers are checked at evaluation, not construction: an invalid context
# resolves to reason ERROR / INVALID_CONTEXT instead of raising (spec §2, Requirement 2.1.x).
ContextId = Annotated[Optional[str], SkipValidation]


class Reason(str, Enum):
    PLAN = "PLAN"
    OVERRIDE = "OVERRIDE"
    GRANT = "GRANT"
    FIXED = "FIXED"
    DEFAULT = "DEFAULT"
    ERROR = "ERROR"


class ErrorCode(str, Enum):
    PROVIDER_NOT_READY = "PROVIDER_NOT_READY"
    PRIVILEGE_NOT_FOUND = "PRIVILEGE_NOT_FOUND"
    FEATURE_NOT_FOUND = "FEATURE_NOT_FOUND"
    TYPE_MISMATCH = "TYPE_MISMATCH"
    INVALID_CONTEXT = "INVALID_CONTEXT"
    GENERAL = "GENERAL"


class EvaluationContext(OpenEntitlementModel):
    """Spec §2. ``now`` is filled from the client's clock when absent.

    Identifiers are not validated on construction; :meth:`validation_error` reports
    a missing or invalid tenant so evaluation can return INVALID_CONTEXT.
    An omitted ``organization_id`` inherits the client default when merged; an
    explicit ``None`` or ``""`` does not.
    """

    organization_id: ContextId = None
    subject_id: ContextId = None
    resource_id: ContextId = None
    now: Optional[datetime] = None

    def merged_with(self, other: Optional["EvaluationContext"]) -> "EvaluationContext":
        """Invocation fields take precedence (Requirement 2.2.1)."""
        if other is None:
            return self
        own_tenant = "organization_id" not in other.model_fields_set
        source = self if own_tenant else other
        fields_set = {"subject_id", "resource_id", "now"}
        if "organization_id" in source.model_fields_set:
            fields_set.add("organization_id")
        # Both inputs are already EvaluationContexts, so skip re-validation on the hot path.
        return EvaluationContext._trusted(
            fields_set,
            {
                "organization_id": source.organization_id,
                "subject_id": other.subject_id if other.subject_id is not None else self.subject_id,
                "resource_id": other.resource_id if other.resource_id is not None else self.resource_id,
                "now": other.now if other.now is not None else self.now,
            },
        )

    def validation_error(self) -> Optional[str]:
        if not isinstance(self.organization_id, str) or not self.organization_id:
            return "organization_id is required"
        for name in ("subject_id", "resource_id"):
            v = getattr(self, name)
            if v is not None and (not isinstance(v, str) or not v):
                return f"{name} must be a non-empty string when present"
        return None


class GrantApplied(WireModel):
    id: str
    amount: StrictInt
    subject_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "amount": self.amount}
        if self.subject_id is not None:
            d["subjectId"] = self.subject_id
        return d


class ResolutionDetails(WireModel, Generic[T]):
    """Spec §4.3: the counterpart of OpenFeature's FlagEvaluationDetails.

    Its JSON form (``to_dict``, ``model_dump_json``, FastAPI responses) is the OEREP v1
    details object: camelCase keys, absent optional members omitted, UNLIMITED as
    ``{"unlimited": true}``.
    """

    privilege: str
    value: T
    reason: Reason
    grants: tuple[GrantApplied, ...] = ()
    stale_overrides: tuple[str, ...] = ()
    feature: Optional[str] = None
    plan_id: Optional[str] = None
    plan_value: Any = None
    has_plan_value: bool = Field(default=False, exclude=True)
    override_id: Optional[str] = None
    required_plan: Optional[str] = None
    error_code: Optional[ErrorCode] = None
    error_message: Optional[str] = None
    lock_domain: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _preserve_plan_presence(cls, value: Any) -> Any:
        if isinstance(value, dict) and ("planValue" in value or "plan_value" in value):
            value = dict(value)
            if "has_plan_value" not in value and "hasPlanValue" not in value:
                value["has_plan_value"] = True
            key = "planValue" if "planValue" in value else "plan_value"
            value[key] = decode_value(value[key])
        return value

    def with_(self, **changes: Any) -> "ResolutionDetails[Any]":
        """A copy with ``changes`` applied, like ``dataclasses.replace`` (not re-validated)."""
        unknown = changes.keys() - type(self).__pydantic_fields__.keys()
        if unknown:
            raise TypeError(f"unknown ResolutionDetails fields: {sorted(unknown)}")
        return self._evolve(changes)

    def to_dict(self) -> dict[str, Any]:
        """JSON form with spec field names (Requirement 4.3.3)."""
        d: dict[str, Any] = {
            "privilege": self.privilege,
            "value": encode_value(self.value),
            "reason": self.reason.value,
            "grants": [g.to_dict() for g in self.grants],
            "staleOverrides": list(self.stale_overrides),
        }
        if self.feature is not None:
            d["feature"] = self.feature
        if self.plan_id is not None:
            d["planId"] = self.plan_id
        if self.has_plan_value:
            d["planValue"] = encode_value(self.plan_value)
        if self.override_id is not None:
            d["overrideId"] = self.override_id
        if self.required_plan is not None:
            d["requiredPlan"] = self.required_plan
        if self.error_code is not None:
            d["errorCode"] = self.error_code.value
        if self.error_message is not None:
            d["errorMessage"] = self.error_message
        if self.lock_domain is not None:
            d["lockDomain"] = self.lock_domain
        return d


class UsageBreakdown(WireModel):
    """Spec Requirement 3.3.2: consumption drawn from the pool and from the subject allowance."""

    pool: Annotated[StrictInt, Field(ge=0)]
    subject: Annotated[StrictInt, Field(ge=0)] = 0

    def to_dict(self) -> dict[str, int]:
        return {"pool": self.pool, "subject": self.subject}


Usage = Union[int, UsageBreakdown, Mapping[str, int]]


def normalize_usage(current: Any) -> UsageBreakdown:
    if isinstance(current, UsageBreakdown):
        return current
    if is_int(current):
        pool, subject = current, 0
    elif isinstance(current, Mapping):
        pool, subject = current.get("pool"), current.get("subject", 0)
    else:
        raise InvalidArgument(f"current must be an int or a usage breakdown, got {current!r}")
    if not (is_int(pool) and is_int(subject)) or pool < 0 or subject < 0:
        raise InvalidArgument(f"usage must be non-negative integers, got {current!r}")
    return UsageBreakdown._trusted({"pool", "subject"}, {"pool": pool, "subject": subject})


def usage_to_json(current: Any) -> Any:
    if is_int(current):
        return current
    return normalize_usage(current).to_dict()


def pool_usage(
    usage_by_subject: Mapping[str, int],
    allowance_by_subject: Mapping[str, int],
    unattributed: int = 0,
) -> int:
    """Pool draw implied by the draw order (Requirement 3.3.4)."""
    return unattributed + sum(
        max(0, used - allowance_by_subject.get(s, 0)) for s, used in usage_by_subject.items()
    )


def error_details(
    privilege: str, default: Any, code: ErrorCode, message: str, feature: Optional[str] = None
) -> ResolutionDetails[Any]:
    return ResolutionDetails(
        privilege=privilege,
        value=default,
        reason=Reason.ERROR,
        error_code=code,
        error_message=message,
        feature=feature,
    )


__all__ = [
    "Reason",
    "ErrorCode",
    "EvaluationContext",
    "GrantApplied",
    "ResolutionDetails",
    "UsageBreakdown",
    "Usage",
    "normalize_usage",
    "usage_to_json",
    "pool_usage",
    "error_details",
]
