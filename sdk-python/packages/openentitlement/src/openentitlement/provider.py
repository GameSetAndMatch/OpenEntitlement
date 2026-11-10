"""The provider interface (spec §6) and mutation types (spec §6.3, §7.3)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional, Protocol, Sequence, runtime_checkable

from pydantic import StrictInt

from .catalog import PrivilegeDefinition, ValueType
from .details import EvaluationContext, ResolutionDetails
from .errors import Conflict, InvalidArgument, InvalidValue
from .facts import FactSource, Override, Plan, Scope, intervals_overlap
from .model import OpenEntitlementModel, WireModel
from .resolver import Need, resolve_from_facts, suggest_plan_from_facts
from .values import encode_json, is_int


class ProviderMetadata(OpenEntitlementModel):
    name: str


class Capabilities(OpenEntitlementModel):
    """Requirement 6.1.3."""

    overrides: bool = False
    grants: bool = False
    mutations: bool = False
    plan_catalog: bool = False
    fixed: bool = False

    def tags(self) -> set[str]:
        """Conformance tags this provider must pass."""
        names = {
            "overrides": self.overrides,
            "grants": self.grants,
            "mutations": self.mutations,
            "plan-catalog": self.plan_catalog,
            "fixed": self.fixed,
        }
        return {k for k, v in names.items() if v}


class MutationMeta(OpenEntitlementModel):
    actor: str
    reason: str

    def check(self) -> None:
        """Requirement 6.3.2."""
        if not isinstance(self.actor, str) or not self.actor.strip():
            raise InvalidArgument("mutation requires a non-empty actor")
        if not isinstance(self.reason, str) or not self.reason.strip():
            raise InvalidArgument("mutation requires a non-empty reason")


class AuditEvent(WireModel):
    """Requirement 7.3.1."""

    actor: str
    reason: str
    entity: str  # plan | planValue | assignment | override | grant
    entity_id: str
    action: str  # create | update | delete | revoke
    before: Any
    after: Any
    at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "actor": self.actor,
            "reason": self.reason,
            "entity": self.entity,
            "entityId": self.entity_id,
            "action": self.action,
            "before": encode_json(self.before),
            "after": encode_json(self.after),
            "at": self.at.isoformat(),
        }


class OverrideInput(OpenEntitlementModel):
    scope: Scope
    privilege: str
    value: Any
    reason: str
    starts_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    plan_family: Optional[str] = None
    id: Optional[str] = None


class GrantInput(OpenEntitlementModel):
    scope: Scope
    privilege: str
    amount: StrictInt
    reason: str
    starts_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    id: Optional[str] = None


class Mutations(Protocol):
    """Requirement 6.3.1. ``at`` comes from the client clock; ``meta`` is already checked."""

    def upsert_plan(self, plan: Plan, meta: MutationMeta, at: datetime) -> AuditEvent: ...

    def set_plan_value(
        self, plan_id: str, privilege: PrivilegeDefinition, value: Any, meta: MutationMeta, at: datetime
    ) -> AuditEvent: ...

    def assign_plan(
        self,
        organization_id: str,
        plan_id: Optional[str],
        channel: Optional[str],
        meta: MutationMeta,
        at: datetime,
    ) -> AuditEvent: ...

    def create_override(
        self, data: OverrideInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: datetime
    ) -> AuditEvent: ...

    def delete_override(self, override_id: str, meta: MutationMeta, at: datetime) -> AuditEvent: ...

    def create_grant(
        self, data: GrantInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: datetime
    ) -> AuditEvent: ...

    def revoke_grant(self, grant_id: str, meta: MutationMeta, at: datetime) -> AuditEvent: ...


@runtime_checkable
class Provider(Protocol):
    metadata: ProviderMetadata
    capabilities: Capabilities

    def resolve(self, privilege: PrivilegeDefinition, ctx: EvaluationContext) -> ResolutionDetails[Any]: ...


class AbstractProvider:
    """Convenience base with no-op lifecycle and no optional capabilities."""

    metadata = ProviderMetadata(name="abstract")
    capabilities = Capabilities()
    mutations: Optional[Mutations] = None

    def initialize(self) -> None:
        return None

    def shutdown(self) -> None:
        return None

    def resolve(self, privilege: PrivilegeDefinition, ctx: EvaluationContext) -> ResolutionDetails[Any]:
        raise NotImplementedError

    def suggest_plan(self, privilege: PrivilegeDefinition, need: Need, ctx: EvaluationContext) -> Optional[str]:
        return None


class FactsProvider(AbstractProvider):
    """Base for facts-based providers: implement :class:`FactSource`, get spec resolution for free."""

    def facts(self) -> FactSource:  # pragma: no cover - abstract
        raise NotImplementedError

    def resolve(self, privilege: PrivilegeDefinition, ctx: EvaluationContext) -> ResolutionDetails[Any]:
        return resolve_from_facts(self.facts(), privilege, ctx)

    def suggest_plan(self, privilege: PrivilegeDefinition, need: Need, ctx: EvaluationContext) -> Optional[str]:
        return suggest_plan_from_facts(self.facts(), privilege, need, ctx)


# ---------------------------------------------------------------------------
# Shared validation for providers that implement mutations (Requirements 1.2.5, 1.5.x, 1.6.x)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def validate_value(privilege: PrivilegeDefinition, value: Any) -> None:
    problem = privilege.validate_value(value)
    if problem:
        raise InvalidValue(problem)


def validate_scope(scope: Scope, *, allow_resource: bool) -> None:
    if not scope.organization_id:
        raise InvalidArgument("scope.organization_id is required")
    if scope.subject_id is not None and not scope.subject_id:
        raise InvalidArgument("scope.subject_id must be non-empty when present")
    if scope.resource_id is not None and (not allow_resource or not scope.resource_id):
        raise InvalidArgument("grants cannot be scoped to a resource" if not allow_resource else "bad resource_id")


def validate_interval(starts_at: Optional[datetime], expires_at: Optional[datetime]) -> None:
    if starts_at is not None and expires_at is not None and not starts_at < expires_at:
        raise InvalidArgument("starts_at must be before expires_at")


def check_override_conflict(data: OverrideInput, existing: Sequence[Override]) -> None:
    """Requirement 1.5.7."""
    for o in existing:
        if o.scope == data.scope and o.privilege == data.privilege and intervals_overlap(
            o.starts_at, o.expires_at, data.starts_at, data.expires_at
        ):
            raise Conflict(f"override {o.id} already covers {data.privilege} for this scope and interval")


def validate_grant(privilege: PrivilegeDefinition, data: GrantInput) -> None:
    """Requirement 1.6.2."""
    if privilege.value_type is not ValueType.INTEGER:
        raise InvalidValue(f"grants only apply to integer privileges, {privilege.key} is {privilege.value_type.value}")
    if not is_int(data.amount) or data.amount <= 0:
        raise InvalidValue("grant amount must be a positive integer")


def require_reason(reason: str, what: str) -> None:
    if not isinstance(reason, str) or not reason.strip():
        raise InvalidArgument(f"{what} requires a non-empty reason")


__all__ = [
    "ProviderMetadata",
    "Capabilities",
    "MutationMeta",
    "AuditEvent",
    "OverrideInput",
    "GrantInput",
    "Mutations",
    "Provider",
    "AbstractProvider",
    "FactsProvider",
    "new_id",
    "validate_value",
    "validate_scope",
    "validate_interval",
    "check_override_conflict",
    "validate_grant",
    "require_reason",
]
