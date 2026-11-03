"""Error types (spec §8.1) and the HTTP problem mapping (spec §8.2)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from .values import encode_value

if TYPE_CHECKING:  # pragma: no cover
    from .details import ResolutionDetails, Usage


class OpenEntitlementError(Exception):
    """Base for every error raised by OpenEntitlement."""

    code: str = "GENERAL"


class EntitlementDenied(OpenEntitlementError):
    """Base for denials; map every subclass to one HTTP 403 (Requirement 8.1.3)."""

    def __init__(
        self,
        message: str,
        *,
        feature: str,
        privilege: str,
        details: "ResolutionDetails",
        required_plan: Optional[str] = None,
    ):
        super().__init__(message)
        self.feature = feature
        self.privilege = privilege
        self.details = details
        self.required_plan = required_plan


class EntitlementLimitExceeded(EntitlementDenied):
    code = "entitlement_limit_exceeded"

    def __init__(
        self,
        *,
        feature: str,
        privilege: str,
        limit: Any,
        current: "Usage",
        requested: int,
        details: "ResolutionDetails",
        required_plan: Optional[str] = None,
    ):
        super().__init__(
            f"{privilege}: requested {requested} with current {current} exceeds limit {limit!r}",
            feature=feature,
            privilege=privilege,
            details=details,
            required_plan=required_plan,
        )
        self.limit = limit
        self.current = current
        self.requested = requested


class FeatureNotEntitled(EntitlementDenied):
    code = "feature_not_entitled"

    def __init__(
        self,
        *,
        feature: str,
        privilege: str,
        details: "ResolutionDetails",
        required_plan: Optional[str] = None,
    ):
        super().__init__(
            f"feature {feature!r} is not entitled",
            feature=feature,
            privilege=privilege,
            details=details,
            required_plan=required_plan,
        )


class TypeMismatch(OpenEntitlementError):
    code = "TYPE_MISMATCH"


class InvalidArgument(OpenEntitlementError):
    code = "INVALID_ARGUMENT"


class NotSupported(OpenEntitlementError):
    code = "NOT_SUPPORTED"


class NotFound(OpenEntitlementError):
    code = "NOT_FOUND"


class Conflict(OpenEntitlementError):
    code = "CONFLICT"


class InvalidValue(OpenEntitlementError):
    code = "INVALID_VALUE"


class ProviderNotReady(OpenEntitlementError):
    """Raised by providers to signal PROVIDER_NOT_READY (Requirement 6.1.5)."""

    code = "PROVIDER_NOT_READY"


PROBLEM_TYPE = "urn:openentitlement:problem:entitlement-required"


def to_http_problem(error: EntitlementDenied) -> tuple[int, dict[str, Any]]:
    """Map a denial to ``(403, RFC 9457 problem body)`` (Requirement 8.2.1)."""
    if not isinstance(error, EntitlementDenied):
        raise TypeError("to_http_problem only maps EntitlementDenied errors")
    body: dict[str, Any] = {
        "type": PROBLEM_TYPE,
        "title": "Entitlement required",
        "status": 403,
        "error": "entitlement_required",
        "code": error.code,
        "feature": error.feature,
        "privilege": error.privilege,
    }
    if isinstance(error, EntitlementLimitExceeded):
        body["limit"] = encode_value(error.limit)
        from .details import usage_to_json

        body["current"] = usage_to_json(error.current)
        body["requested"] = error.requested
    if error.required_plan is not None:
        body["requiredPlan"] = error.required_plan
    return 403, body
