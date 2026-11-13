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
RESERVED_MEMBERS = frozenset({"type", "title", "status", "detail", "instance"})


class Problem(Exception):
    """Base class of every typed problem. Subclasses set ``slug``, ``status`` and ``title``."""

    slug: ClassVar[str]
    status: ClassVar[int]
    title: ClassVar[str]

    def __init__(self, detail: str, /, **params: Any) -> None:
        clashes = RESERVED_MEMBERS & params.keys()
        if clashes:
            raise ValueError(f"problem parameters cannot replace standard members: {sorted(clashes)}")
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


# Sign-in and authorization (OPE-38).


class SignInRequired(Problem):
    """No valid session: the caller is not signed in, or their session expired or ended."""

    slug = "sign-in-required"
    status = 401
    title = "Sign-in required"

    def __init__(self, detail: str = "Sign in to continue.") -> None:
        super().__init__(detail)


class SignInFailed(Problem):
    """The OIDC sign-in could not be completed: it expired, was replayed, or the issuer refused it."""

    slug = "sign-in-failed"
    status = 401
    title = "Sign-in failed"

    def __init__(self, detail: str = "Sign-in failed. Start again.") -> None:
        super().__init__(detail)


class SignInRefused(Problem):
    """The identity is valid but may not sign in here. ``reason`` says why."""

    slug = "sign-in-refused"
    status = 403
    title = "Sign-in refused"

    def __init__(self, detail: str, *, reason: str) -> None:
        super().__init__(detail, reason=reason)


class CsrfRejected(Problem):
    """A state-changing request without this console's origin and the session's CSRF token."""

    slug = "csrf-rejected"
    status = 403
    title = "Request origin not allowed"

    def __init__(self) -> None:
        super().__init__("This request did not come from the console. Reload the page and try again.")


class PermissionDenied(Problem):
    """The caller's Role does not allow the operation. ``permission`` names what was needed."""

    slug = "permission-denied"
    status = 403
    title = "Permission denied"

    def __init__(self, detail: str, *, permission: str) -> None:
        super().__init__(detail, permission=permission)


class RevisionConflict(Problem):
    """The record changed since the caller read it. Reload it before saving again."""

    slug = "revision-conflict"
    status = 409
    title = "Changed elsewhere"

    def __init__(self, *, kind: str, id: str) -> None:  # noqa: A002 - the extension member is named id
        super().__init__(f"This {kind} changed elsewhere. Reload it before saving.", kind=kind, id=id)


class AlreadyTaken(Problem):
    """Another record already uses this unique key, such as a Product key in its Workspace."""

    slug = "already-exists"
    status = 409
    title = "Already exists"

    def __init__(self, detail: str, *, kind: str, key: str) -> None:
        super().__init__(detail, kind=kind, key=key)


class ProductInUse(Problem):
    """An Organization uses the Product, so it can be archived but not deleted (ADR-0008)."""

    slug = "product-in-use"
    status = 409
    title = "Product in use"

    def __init__(self, *, id: str) -> None:  # noqa: A002
        super().__init__("Customers use this Product. Archive it instead of deleting it.", id=id)


class LastProduct(Problem):
    """A Workspace always keeps at least one Product (ADR-0008)."""

    slug = "last-product"
    status = 409
    title = "Last Product"

    def __init__(self, *, id: str) -> None:  # noqa: A002
        super().__init__("A Workspace keeps at least one Product. Create another one before deleting this one.", id=id)
