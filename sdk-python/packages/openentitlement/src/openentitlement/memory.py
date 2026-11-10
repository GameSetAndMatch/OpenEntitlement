"""The in-memory reference provider: full capabilities, no persistence."""

from __future__ import annotations

import threading
from datetime import datetime
from typing import Any, Iterable, Mapping, Optional, Sequence

from .catalog import PrivilegeDefinition
from .errors import InvalidArgument, NotFound
from .facts import Assignment, Grant, Override, Plan
from .provider import (
    AuditEvent,
    Capabilities,
    FactsProvider,
    GrantInput,
    MutationMeta,
    OverrideInput,
    ProviderMetadata,
    check_override_conflict,
    new_id,
    require_reason,
    validate_grant,
    validate_interval,
    validate_scope,
    validate_value,
)


class _Store:
    """Dict-backed state; implements the FactSource protocol directly."""

    def __init__(self) -> None:
        self.plan_map: dict[str, Plan] = {}
        self.values: dict[tuple[str, str], Any] = {}
        self.assignments: dict[str, Assignment] = {}
        self.override_map: dict[str, Override] = {}
        self.grant_map: dict[str, Grant] = {}

    def assignment(self, organization_id: str) -> Optional[Assignment]:
        return self.assignments.get(organization_id)

    def plan(self, plan_id: str) -> Optional[Plan]:
        return self.plan_map.get(plan_id)

    def plans(self) -> Sequence[Plan]:
        return list(self.plan_map.values())

    def plan_value(self, plan_id: str, privilege: str) -> tuple[bool, Any]:
        k = (plan_id, privilege)
        return (k in self.values, self.values.get(k))

    def overrides(self, organization_id: str, privilege: str) -> Sequence[Override]:
        return [
            o for o in self.override_map.values()
            if o.scope.organization_id == organization_id and o.privilege == privilege
        ]

    def grants(self, organization_id: str, privilege: str) -> Sequence[Grant]:
        return [
            g for g in self.grant_map.values()
            if g.scope.organization_id == organization_id and g.privilege == privilege
        ]


class InMemoryProvider(FactsProvider):
    """Reference provider. Thread-safe; data lives for the life of the process.

    For quick setups, seed it directly (seeding bypasses audit, as it is configuration, not change)::

        InMemoryProvider(
            plans=[Plan(id="free", name="Free", rank=0), Plan(id="pro", name="Pro", rank=1)],
            values={"free": {"seat_max": 3}, "pro": {"seat_max": 50}},
            assignments={"acme": "pro"},
        )

    Seeded values are not validated against a catalog; use the admin API for validated writes.
    """

    metadata = ProviderMetadata(name="in-memory")
    capabilities = Capabilities(overrides=True, grants=True, mutations=True, plan_catalog=True)

    def __init__(
        self,
        *,
        plans: Iterable[Plan] = (),
        values: Optional[Mapping[str, Mapping[str, Any]]] = None,
        assignments: Optional[Mapping[str, str]] = None,
    ):
        self._store = _Store()
        self._lock = threading.RLock()
        self.mutations = _Mutations(self._store, self._lock)
        for p in plans:
            self._store.plan_map[p.id] = p
        for plan_id, vals in (values or {}).items():
            for key, v in vals.items():
                self._store.values[(plan_id, key)] = v
        for org, plan_id in (assignments or {}).items():
            self._store.assignments[org] = Assignment(organization_id=org, plan_id=plan_id)

    def facts(self) -> _Store:
        return self._store

    def resolve(self, privilege, ctx):  # type: ignore[no-untyped-def]
        with self._lock:
            return super().resolve(privilege, ctx)

    def suggest_plan(self, privilege, need, ctx):  # type: ignore[no-untyped-def]
        with self._lock:
            return super().suggest_plan(privilege, need, ctx)


class _Mutations:
    def __init__(self, store: _Store, lock: threading.RLock):
        self._s = store
        self._lock = lock

    def upsert_plan(self, plan: Plan, meta: MutationMeta, at: datetime) -> AuditEvent:
        with self._lock:
            if not plan.id or not plan.name:
                raise InvalidArgument("plan needs an id and a name")
            if plan.variant_of is not None:
                if plan.variant_of == plan.id or any(p.variant_of == plan.id for p in self._s.plan_map.values()):
                    raise InvalidArgument("a base plan with variants cannot become a variant (Requirement 1.3.2)")
                base = self._s.plan_map.get(plan.variant_of)
                if base is None:
                    raise NotFound(f"plan {plan.variant_of!r} (variantOf) not found")
                if base.variant_of is not None:
                    raise InvalidArgument("variantOf must not chain (Requirement 1.3.2)")
            before = self._s.plan_map.get(plan.id)
            self._s.plan_map[plan.id] = plan
            return AuditEvent(
                actor=meta.actor,
                reason=meta.reason,
                entity="plan",
                entity_id=plan.id,
                action="update" if before else "create",
                before=before.to_dict() if before else None,
                after=plan.to_dict(),
                at=at,
            )

    def set_plan_value(
        self, plan_id: str, privilege: PrivilegeDefinition, value: Any, meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        with self._lock:
            if plan_id not in self._s.plan_map:
                raise NotFound(f"plan {plan_id!r} not found")
            validate_value(privilege, value)
            k = (plan_id, privilege.key)
            existed = k in self._s.values
            before = self._s.values.get(k)
            self._s.values[k] = value
            return AuditEvent(
                actor=meta.actor,
                reason=meta.reason,
                entity="planValue",
                entity_id=f"{plan_id}:{privilege.key}",
                action="update" if existed else "create",
                before=before if existed else None,
                after=value,
                at=at,
            )

    def assign_plan(
        self, organization_id: str, plan_id: Optional[str], channel: Optional[str], meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        with self._lock:
            if not organization_id:
                raise InvalidArgument("organization_id is required")
            before = self._s.assignments.get(organization_id)
            if plan_id is None:
                if before is None:
                    raise NotFound(f"organization {organization_id!r} has no plan")
                del self._s.assignments[organization_id]
                return AuditEvent(
                    actor=meta.actor,
                    reason=meta.reason,
                    entity="assignment",
                    entity_id=organization_id,
                    action="delete",
                    before=before.to_dict(),
                    after=None,
                    at=at,
                )
            if plan_id not in self._s.plan_map:
                raise NotFound(f"plan {plan_id!r} not found")
            after = Assignment(organization_id=organization_id, plan_id=plan_id, channel=channel)
            self._s.assignments[organization_id] = after
            return AuditEvent(
                actor=meta.actor,
                reason=meta.reason,
                entity="assignment",
                entity_id=organization_id,
                action="update" if before else "create",
                before=before.to_dict() if before else None,
                after=after.to_dict(),
                at=at,
            )

    def create_override(
        self, data: OverrideInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        with self._lock:
            validate_scope(data.scope, allow_resource=True)
            validate_value(privilege, data.value)
            validate_interval(data.starts_at, data.expires_at)
            require_reason(data.reason, "an override")
            family = data.plan_family
            if family is None:
                a = self._s.assignments.get(data.scope.organization_id)
                plan = self._s.plan_map.get(a.plan_id) if a else None
                if plan is None:
                    raise InvalidArgument("organization has no plan; pass plan_family explicitly (Requirement 1.5.3)")
                family = plan.family
            check_override_conflict(data, self._s.overrides(data.scope.organization_id, data.privilege))
            oid = data.id or new_id("ovr")
            if oid in self._s.override_map:
                raise InvalidArgument(f"override id {oid!r} already exists")
            o = Override(
                id=oid, scope=data.scope, privilege=data.privilege, value=data.value, plan_family=family,
                reason=data.reason, starts_at=data.starts_at, expires_at=data.expires_at, created_by=meta.actor,
            )
            self._s.override_map[oid] = o
            return AuditEvent(
                actor=meta.actor,
                reason=meta.reason,
                entity="override",
                entity_id=oid,
                action="create",
                before=None,
                after=o.to_dict(),
                at=at,
            )

    def delete_override(self, override_id: str, meta: MutationMeta, at: datetime) -> AuditEvent:
        with self._lock:
            o = self._s.override_map.pop(override_id, None)
            if o is None:
                raise NotFound(f"override {override_id!r} not found")
            return AuditEvent(
                actor=meta.actor,
                reason=meta.reason,
                entity="override",
                entity_id=override_id,
                action="delete",
                before=o.to_dict(),
                after=None,
                at=at,
            )

    def create_grant(
        self, data: GrantInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        with self._lock:
            validate_scope(data.scope, allow_resource=False)
            validate_grant(privilege, data)
            validate_interval(data.starts_at, data.expires_at)
            require_reason(data.reason, "a grant")
            gid = data.id or new_id("grt")
            if gid in self._s.grant_map:
                raise InvalidArgument(f"grant id {gid!r} already exists")
            g = Grant(
                id=gid, scope=data.scope, privilege=data.privilege, amount=data.amount, reason=data.reason,
                starts_at=data.starts_at, expires_at=data.expires_at, created_by=meta.actor,
            )
            self._s.grant_map[gid] = g
            return AuditEvent(
                actor=meta.actor,
                reason=meta.reason,
                entity="grant",
                entity_id=gid,
                action="create",
                before=None,
                after=g.to_dict(),
                at=at,
            )

    def revoke_grant(self, grant_id: str, meta: MutationMeta, at: datetime) -> AuditEvent:
        with self._lock:
            g = self._s.grant_map.get(grant_id)
            if g is None or g.revoked_at is not None:
                raise NotFound(f"active grant {grant_id!r} not found")
            revoked = g.model_copy(update={"revoked_at": at})
            self._s.grant_map[grant_id] = revoked
            return AuditEvent(
                actor=meta.actor,
                reason=meta.reason,
                entity="grant",
                entity_id=grant_id,
                action="revoke",
                before=g.to_dict(),
                after=revoked.to_dict(),
                at=at,
            )
