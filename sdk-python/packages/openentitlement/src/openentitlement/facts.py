"""Facts: plans, assignments, overrides, grants (spec §1.3-1.6)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, Protocol, Sequence

from pydantic import StrictInt

from .model import WireModel
from .values import encode_value


class Plan(WireModel):
    id: str
    name: str
    rank: Optional[int] = None
    public: bool = True
    variant_of: Optional[str] = None

    @property
    def family(self) -> str:
        """Requirement 1.3.2."""
        return self.variant_of or self.id

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "rank": self.rank,
            "public": self.public,
            "variantOf": self.variant_of,
        }


class Assignment(WireModel):
    organization_id: str
    plan_id: str
    channel: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {"organizationId": self.organization_id, "planId": self.plan_id, "channel": self.channel}


class Scope(WireModel):
    organization_id: str
    subject_id: Optional[str] = None
    resource_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "organizationId": self.organization_id,
            "subjectId": self.subject_id,
            "resourceId": self.resource_id,
        }


class Override(WireModel):
    id: str
    scope: Scope
    privilege: str
    value: Any
    plan_family: str
    reason: str
    starts_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_by: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "scope": self.scope.to_dict(),
            "privilege": self.privilege,
            "value": encode_value(self.value),
            "planFamily": self.plan_family,
            "reason": self.reason,
            "startsAt": _iso(self.starts_at),
            "expiresAt": _iso(self.expires_at),
            "createdBy": self.created_by,
        }


class Grant(WireModel):
    id: str
    scope: Scope
    privilege: str
    amount: StrictInt
    reason: str
    starts_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    created_by: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "scope": {k: v for k, v in self.scope.to_dict().items() if k != "resourceId"},
            "privilege": self.privilege,
            "amount": self.amount,
            "reason": self.reason,
            "startsAt": _iso(self.starts_at),
            "expiresAt": _iso(self.expires_at),
            "revokedAt": _iso(self.revoked_at),
            "createdBy": self.created_by,
        }


def within(t: datetime, starts_at: Optional[datetime], expires_at: Optional[datetime]) -> bool:
    """Half-open interval test, open-ended when a bound is missing (spec §3.1)."""
    return (starts_at is None or starts_at <= t) and (expires_at is None or t < expires_at)


def intervals_overlap(
    a_start: Optional[datetime],
    a_end: Optional[datetime],
    b_start: Optional[datetime],
    b_end: Optional[datetime],
) -> bool:
    """Whether [a_start, a_end) and [b_start, b_end) intersect (Requirement 1.5.7)."""
    starts_before_b_ends = b_end is None or a_start is None or a_start < b_end
    b_starts_before_a_ends = a_end is None or b_start is None or b_start < a_end
    return starts_before_b_ends and b_starts_before_a_ends


class FactSource(Protocol):
    """What a facts-based provider must be able to read (spec §6 overview).

    Implementations may batch or cache; the resolver calls each at most once per resolution.
    """

    def assignment(self, organization_id: str) -> Optional[Assignment]: ...

    def plan(self, plan_id: str) -> Optional[Plan]: ...

    def plans(self) -> Sequence[Plan]: ...

    def plan_value(self, plan_id: str, privilege: str) -> tuple[bool, Any]:
        """Return ``(found, value)``."""
        ...

    def overrides(self, organization_id: str, privilege: str) -> Sequence[Override]: ...

    def grants(self, organization_id: str, privilege: str) -> Sequence[Grant]: ...


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt is not None else None


__all__ = [
    "Plan",
    "Assignment",
    "Scope",
    "Override",
    "Grant",
    "FactSource",
    "within",
    "intervals_overlap",
]
