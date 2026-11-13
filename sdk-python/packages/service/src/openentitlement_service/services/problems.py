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


class TierInUse(Problem):
    """Organizations or the status policy use the Tier, so it can be archived but not deleted (ADR-0008)."""

    slug = "tier-in-use"
    status = 409
    title = "Tier in use"

    def __init__(self, *, id: str, variant_id: str | None = None) -> None:  # noqa: A002
        if variant_id is None:
            super().__init__("Customers use this Tier. Archive it instead of deleting it.", id=id)
        else:
            super().__init__(
                f"The status policy falls back to {variant_id}. Choose another fallback before deleting this Tier.",
                id=id,
                variantId=variant_id,
            )


# Members, invitations and the Cloud service tier (OPE-44).


class LastOwner(Problem):
    """A Workspace always keeps at least one Owner."""

    slug = "last-owner"
    status = 409
    title = "Last Owner"

    def __init__(self, *, id: str) -> None:  # noqa: A002
        super().__init__("A Workspace keeps at least one Owner. Make another member Owner first.", id=id)


class ProductLimit(Problem):
    """Cloud Pro allows one Product (ADR-0008). ``products`` lists the Workspace's Products."""

    slug = "product-limit"
    status = 409
    title = "Product limit reached"

    def __init__(self, detail: str, *, service_tier: str, limit: int, products: Sequence[Mapping[str, str]]) -> None:
        super().__init__(detail, serviceTier=service_tier, limit=limit, products=[dict(p) for p in products])


class InvitationInvalid(Problem):
    """The invitation link does not exist, was already used, or expired. The three are not told apart."""

    slug = "invitation-invalid"
    status = 404
    title = "Invitation not valid"

    def __init__(self) -> None:
        super().__init__("This invitation link is not valid. It may have expired or been used. Ask for a new one.")


class InvitationForAnotherEmail(Problem):
    """The signed-in Account's verified email is not the invited one."""

    slug = "invitation-for-another-email"
    status = 403
    title = "Invitation for another email"

    def __init__(self) -> None:
        super().__init__("This invitation is for another email address. Sign in with the invited email to accept it.")


# Application users (OPE-60).


class UserEntitlementsUnavailable(Problem):
    """User-level entitlements need Cloud Enterprise; Cloud Pro has Organization entitlements (ADR-0005)."""

    slug = "user-entitlements-unavailable"
    status = 403
    title = "User entitlements unavailable"

    def __init__(self, *, service_tier: str) -> None:
        super().__init__(
            "Personal terms and Grants for application users need Cloud Enterprise. "
            "Organization terms stay available on Cloud Pro.",
            serviceTier=service_tier,
        )


def escape_pointer_token(token: object) -> str:
    return str(token).replace("~", "~0").replace("/", "~1")


def input_pointer(loc: Sequence[object], data: object, error_type: str = "", ctx: Mapping[str, Any] | None = None) -> str:
    """A JSON Pointer into ``data`` (the submitted JSON) for a Pydantic error location.

    Pydantic locations also name union members and discriminator branches ("constrained-int",
    "Unlimited", "integer"), which do not exist in the request. Only steps that address the
    submitted document are kept, plus a missing member's name and a rejected discriminator.
    """
    tokens: list[str] = []
    node = data
    for index, step in enumerate(loc):
        if isinstance(node, Mapping) and isinstance(step, str) and step in node:
            node = node[step]
            tokens.append(step)
        elif isinstance(node, list) and isinstance(step, int) and 0 <= step < len(node):
            node = node[step]
            tokens.append(str(step))
        elif error_type == "missing" and index == len(loc) - 1 and isinstance(node, Mapping) and isinstance(step, str):
            tokens.append(step)
    if error_type.startswith("union_tag") and isinstance(node, Mapping) and ctx and "discriminator" in ctx:
        tokens.append(str(ctx["discriminator"]).strip("'"))
    return "".join("/" + escape_pointer_token(t) for t in tokens)
