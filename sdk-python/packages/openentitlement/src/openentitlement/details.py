"""Evaluation context, resolution details, reasons, usage (spec §2, §4.3-4.5)."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
from typing import Any, Generic, Mapping, Optional, TypeVar, Union

from .errors import InvalidArgument
from .values import encode_value, is_int

T = TypeVar("T")


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


@dataclass(frozen=True)
class EvaluationContext:
    """Spec §2. ``now`` is filled from the client's clock when absent."""

    organization_id: str = ""
    subject_id: Optional[str] = None
    resource_id: Optional[str] = None
    now: Optional[datetime] = None

    def merged_with(self, other: Optional["EvaluationContext"]) -> "EvaluationContext":
        """Invocation fields take precedence (Requirement 2.2.1)."""
        if other is None:
            return self
        return EvaluationContext(
            organization_id=other.organization_id or self.organization_id,
            subject_id=other.subject_id if other.subject_id is not None else self.subject_id,
            resource_id=other.resource_id if other.resource_id is not None else self.resource_id,
            now=other.now if other.now is not None else self.now,
        )

    def validation_error(self) -> Optional[str]:
        if not isinstance(self.organization_id, str) or not self.organization_id:
            return "organization_id is required"
        for name in ("subject_id", "resource_id"):
            v = getattr(self, name)
            if v is not None and (not isinstance(v, str) or not v):
                return f"{name} must be a non-empty string when present"
        return None


@dataclass(frozen=True)
class GrantApplied:
    id: str
    amount: int
    subject_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "amount": self.amount}
        if self.subject_id is not None:
            d["subjectId"] = self.subject_id
        return d


@dataclass(frozen=True)
class ResolutionDetails(Generic[T]):
    """Spec §4.3: the counterpart of OpenFeature's FlagEvaluationDetails."""

    privilege: str
    value: T
    reason: Reason
    grants: tuple[GrantApplied, ...] = ()
    stale_overrides: tuple[str, ...] = ()
    feature: Optional[str] = None
    plan_id: Optional[str] = None
    plan_value: Any = None
    has_plan_value: bool = False
    override_id: Optional[str] = None
    required_plan: Optional[str] = None
    error_code: Optional[ErrorCode] = None
    error_message: Optional[str] = None
    lock_domain: Optional[str] = None

    def with_(self, **changes: Any) -> "ResolutionDetails[Any]":
        return replace(self, **changes)

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


@dataclass(frozen=True)
class UsageBreakdown:
    """Spec Requirement 3.3.2: consumption drawn from the pool and from the subject allowance."""

    pool: int
    subject: int = 0

    def to_dict(self) -> dict[str, int]:
        return {"pool": self.pool, "subject": self.subject}


Usage = Union[int, UsageBreakdown, Mapping[str, int]]


def normalize_usage(current: Any) -> UsageBreakdown:
    if is_int(current):
        u = UsageBreakdown(pool=current)
    elif isinstance(current, UsageBreakdown):
        u = current
    elif isinstance(current, Mapping):
        u = UsageBreakdown(pool=current.get("pool", 0), subject=current.get("subject", 0))
    else:
        raise InvalidArgument(f"current must be an int or a usage breakdown, got {current!r}")
    if not (is_int(u.pool) and is_int(u.subject)) or u.pool < 0 or u.subject < 0:
        raise InvalidArgument(f"usage must be non-negative integers, got {current!r}")
    return u


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
