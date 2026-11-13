"""Typed problems: every error the service returns (ADR-0009, RFC 9457).

Each problem is an exception with a stable ``type`` URI, an HTTP status, a ``title``,
a ``detail`` and parameters that become extension members of the Problem Details body.
The service layer raises them; one handler in the interface layer renders them.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, ClassVar

PROBLEM_TYPE_BASE = "https://openentitlement.dev/problems/"


class Problem(Exception):
    """Base class of every typed problem. Subclasses set ``slug``, ``status`` and ``title``."""

    slug: ClassVar[str]
    status: ClassVar[int]
    title: ClassVar[str]

    def __init__(self, detail: str, **params: Any) -> None:
        super().__init__(detail)
        self.detail = detail
        self.params: Mapping[str, Any] = params

    @property
    def type(self) -> str:
        return PROBLEM_TYPE_BASE + self.slug


class NotFound(Problem):
    slug = "not-found"
    status = 404
    title = "Not found"

    def __init__(self, detail: str = "Nothing exists at this address.", **params: Any) -> None:
        super().__init__(detail, **params)


class MethodNotAllowed(Problem):
    slug = "method-not-allowed"
    status = 405
    title = "Method not allowed"

    def __init__(self, method: str, allowed: Sequence[str]) -> None:
        super().__init__(f"This address does not accept {method}.", method=method, allowed=list(allowed))


@dataclass(frozen=True)
class FieldError:
    """One rejected field: a JSON Pointer (RFC 6901) into the request body and its message."""

    pointer: str
    detail: str


class ValidationFailed(Problem):
    slug = "validation-failed"
    status = 400
    title = "Validation failed"

    def __init__(self, errors: Sequence[FieldError], detail: str = "The request is not valid. See errors.") -> None:
        super().__init__(detail, errors=[{"pointer": e.pointer, "detail": e.detail} for e in errors])


class ServiceUnavailable(Problem):
    slug = "service-unavailable"
    status = 503
    title = "Service unavailable"

    def __init__(self, detail: str = "The service cannot reach its database.") -> None:
        super().__init__(detail)


class InternalError(Problem):
    """An unexpected failure. Never carries the original exception's message."""

    slug = "internal-error"
    status = 500
    title = "Internal error"

    def __init__(self) -> None:
        super().__init__("The service failed to complete this request.")
