"""Postgres provider and advisory lock for OpenEntitlement (psycopg 3)."""

from __future__ import annotations

from datetime import datetime
from importlib import resources
from typing import Any, Callable, Optional, Sequence, TypeVar

import psycopg
from psycopg.types.json import Jsonb

from openentitlement import (
    AuditEvent,
    Capabilities,
    FactsProvider,
    GrantInput,
    InvalidArgument,
    MutationMeta,
    NotFound,
    OverrideInput,
    ProviderMetadata,
)
from openentitlement.catalog import PrivilegeDefinition
from openentitlement.facts import Assignment, Grant, Override, Plan, Scope
from openentitlement.provider import (
    check_override_conflict,
    new_id,
    require_reason,
    validate_grant,
    validate_interval,
    validate_scope,
    validate_value,
)
from openentitlement.resolver import resolve_from_facts, suggest_plan_from_facts
from openentitlement.values import decode_value, encode_json, encode_value

__all__ = ["PostgresProvider", "PostgresAdvisoryLock", "schema_sql", "migrate"]
__version__ = "0.1.0"

R = TypeVar("R")
ConnectionFactory = Callable[[], "psycopg.Connection[Any]"]


def schema_sql() -> str:
    return resources.files(__package__).joinpath("schema.sql").read_text()


def _factory(conninfo: Optional[str], connection_factory: Optional[ConnectionFactory]) -> ConnectionFactory:
    if connection_factory is not None:
        return connection_factory
    if conninfo is None:
        raise InvalidArgument("pass conninfo or connection_factory")
    return lambda: psycopg.connect(conninfo)


def migrate(conninfo: Optional[str] = None, *, connection_factory: Optional[ConnectionFactory] = None) -> None:
    """Create the oe_* tables if they don't exist."""
    with _factory(conninfo, connection_factory)() as conn:
        conn.execute(schema_sql())


class _Facts:
    """FactSource over one connection (one consistent read per resolution)."""

    def __init__(self, conn: "psycopg.Connection[Any]"):
        self.c = conn

    def assignment(self, organization_id: str) -> Optional[Assignment]:
        row = self.c.execute(
            "select organization_id, plan_id, channel from oe_assignment where organization_id = %s",
            (organization_id,),
        ).fetchone()
        return Assignment(*row) if row else None

    def plan(self, plan_id: str) -> Optional[Plan]:
        row = self.c.execute("select id, name, rank, public, variant_of from oe_plan where id = %s", (plan_id,)).fetchone()
        return Plan(*row) if row else None

    def plans(self) -> Sequence[Plan]:
        return [Plan(*r) for r in self.c.execute("select id, name, rank, public, variant_of from oe_plan").fetchall()]

    def plan_value(self, plan_id: str, privilege: str) -> tuple[bool, Any]:
        row = self.c.execute(
            "select value from oe_plan_value where plan_id = %s and privilege = %s", (plan_id, privilege)
        ).fetchone()
        return (True, decode_value(row[0])) if row else (False, None)

    def overrides(self, organization_id: str, privilege: str) -> Sequence[Override]:
        rows = self.c.execute(
            "select id, organization_id, subject_id, resource_id, privilege, value, plan_family, reason,"
            " starts_at, expires_at, created_by from oe_override where organization_id = %s and privilege = %s",
            (organization_id, privilege),
        ).fetchall()
        return [_override(r) for r in rows]

    def grants(self, organization_id: str, privilege: str) -> Sequence[Grant]:
        rows = self.c.execute(
            "select id, organization_id, subject_id, privilege, amount, reason, starts_at, expires_at, revoked_at,"
            " created_by from oe_grant where organization_id = %s and privilege = %s",
            (organization_id, privilege),
        ).fetchall()
        return [_grant(r) for r in rows]


def _override(r: Sequence[Any]) -> Override:
    return Override(
        id=r[0], scope=Scope(r[1], r[2], r[3]), privilege=r[4], value=decode_value(r[5]), plan_family=r[6],
        reason=r[7], starts_at=r[8], expires_at=r[9], created_by=r[10],
    )


def _grant(r: Sequence[Any]) -> Grant:
    return Grant(
        id=r[0], scope=Scope(r[1], r[2]), privilege=r[3], amount=int(r[4]), reason=r[5], starts_at=r[6],
        expires_at=r[7], revoked_at=r[8], created_by=r[9],
    )


class PostgresProvider(FactsProvider):
    """Reference Postgres provider. Full capabilities; durable audit in ``oe_audit``.

    ``connection_factory`` lets you plug a pool: ``connection_factory=pool.getconn`` is NOT enough
    (connections must be returned); prefer ``lambda: pool.connection()`` which is a context manager.
    """

    metadata = ProviderMetadata("postgres")
    capabilities = Capabilities(overrides=True, grants=True, mutations=True, plan_catalog=True)

    def __init__(
        self,
        conninfo: Optional[str] = None,
        *,
        connection_factory: Optional[ConnectionFactory] = None,
        auto_migrate: bool = False,
    ):
        self._connect = _factory(conninfo, connection_factory)
        self._auto_migrate = auto_migrate
        self.mutations = _Mutations(self._connect)

    def initialize(self) -> None:
        with self._connect() as conn:
            if self._auto_migrate:
                conn.execute(schema_sql())
            else:
                conn.execute("select 1 from oe_plan limit 1")

    def resolve(self, privilege, ctx):  # type: ignore[no-untyped-def]
        with self._connect() as conn:
            with conn.transaction():  # one snapshot for the whole resolution
                conn.execute("set transaction isolation level repeatable read")
                return resolve_from_facts(_Facts(conn), privilege, ctx)

    def suggest_plan(self, privilege, need, ctx):  # type: ignore[no-untyped-def]
        with self._connect() as conn:
            return suggest_plan_from_facts(_Facts(conn), privilege, need, ctx)


class _Mutations:
    def __init__(self, connect: ConnectionFactory):
        self._connect = connect

    def _tx(self, fn: Callable[["psycopg.Connection[Any]"], AuditEvent]) -> AuditEvent:
        with self._connect() as conn:
            with conn.transaction():
                event = fn(conn)
                conn.execute(
                    "insert into oe_audit (at, actor, reason, entity, entity_id, action, before, after)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        event.at, event.actor, event.reason, event.entity, event.entity_id, event.action,
                        Jsonb(encode_json(event.before)) if event.before is not None else None,
                        Jsonb(encode_json(event.after)) if event.after is not None else None,
                    ),
                )
                return event

    def upsert_plan(self, plan: Plan, meta: MutationMeta, at: datetime) -> AuditEvent:
        if not plan.id or not plan.name:
            raise InvalidArgument("plan needs an id and a name")

        def fn(c: "psycopg.Connection[Any]") -> AuditEvent:
            facts = _Facts(c)
            if plan.variant_of is not None:
                base = facts.plan(plan.variant_of)
                if base is None:
                    raise NotFound(f"plan {plan.variant_of!r} (variantOf) not found")
                if base.variant_of is not None:
                    raise InvalidArgument("variantOf must not chain (Requirement 1.3.2)")
            before = facts.plan(plan.id)
            c.execute(
                "insert into oe_plan (id, name, rank, public, variant_of) values (%s, %s, %s, %s, %s)"
                " on conflict (id) do update set name = excluded.name, rank = excluded.rank,"
                " public = excluded.public, variant_of = excluded.variant_of",
                (plan.id, plan.name, plan.rank, plan.public, plan.variant_of),
            )
            return AuditEvent(
                meta.actor, meta.reason, "plan", plan.id, "update" if before else "create",
                before.to_dict() if before else None, plan.to_dict(), at,
            )

        return self._tx(fn)

    def set_plan_value(
        self, plan_id: str, privilege: PrivilegeDefinition, value: Any, meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        validate_value(privilege, value)

        def fn(c: "psycopg.Connection[Any]") -> AuditEvent:
            if _Facts(c).plan(plan_id) is None:
                raise NotFound(f"plan {plan_id!r} not found")
            row = c.execute(
                "select value from oe_plan_value where plan_id = %s and privilege = %s for update",
                (plan_id, privilege.key),
            ).fetchone()
            c.execute(
                "insert into oe_plan_value (plan_id, privilege, value) values (%s, %s, %s)"
                " on conflict (plan_id, privilege) do update set value = excluded.value",
                (plan_id, privilege.key, Jsonb(encode_value(value))),
            )
            return AuditEvent(
                meta.actor, meta.reason, "planValue", f"{plan_id}:{privilege.key}",
                "update" if row else "create", decode_value(row[0]) if row else None, value, at,
            )

        return self._tx(fn)

    def assign_plan(
        self, organization_id: str, plan_id: Optional[str], channel: Optional[str], meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        if not organization_id:
            raise InvalidArgument("organization_id is required")

        def fn(c: "psycopg.Connection[Any]") -> AuditEvent:
            row = c.execute(
                "select organization_id, plan_id, channel from oe_assignment where organization_id = %s for update",
                (organization_id,),
            ).fetchone()
            before = Assignment(*row) if row else None
            if plan_id is None:
                if before is None:
                    raise NotFound(f"organization {organization_id!r} has no plan")
                c.execute("delete from oe_assignment where organization_id = %s", (organization_id,))
                return AuditEvent(meta.actor, meta.reason, "assignment", organization_id, "delete", before.to_dict(), None, at)
            if _Facts(c).plan(plan_id) is None:
                raise NotFound(f"plan {plan_id!r} not found")
            c.execute(
                "insert into oe_assignment (organization_id, plan_id, channel, assigned_at) values (%s, %s, %s, %s)"
                " on conflict (organization_id) do update set plan_id = excluded.plan_id,"
                " channel = excluded.channel, assigned_at = excluded.assigned_at",
                (organization_id, plan_id, channel, at),
            )
            after = Assignment(organization_id, plan_id, channel)
            return AuditEvent(
                meta.actor, meta.reason, "assignment", organization_id, "update" if before else "create",
                before.to_dict() if before else None, after.to_dict(), at,
            )

        return self._tx(fn)

    def create_override(
        self, data: OverrideInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        validate_scope(data.scope, allow_resource=True)
        validate_value(privilege, data.value)
        validate_interval(data.starts_at, data.expires_at)
        require_reason(data.reason, "an override")

        def fn(c: "psycopg.Connection[Any]") -> AuditEvent:
            org = data.scope.organization_id
            # serialize override creation per (org, privilege) so the conflict check is race-free (Req 1.5.7)
            c.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"oe:override:{org}:{data.privilege}",))
            facts = _Facts(c)
            family = data.plan_family
            if family is None:
                a = facts.assignment(org)
                plan = facts.plan(a.plan_id) if a else None
                if plan is None:
                    raise InvalidArgument("organization has no plan; pass plan_family explicitly (Requirement 1.5.3)")
                family = plan.family
            check_override_conflict(data, facts.overrides(org, data.privilege))
            oid = data.id or new_id("ovr")
            o = Override(
                id=oid, scope=data.scope, privilege=data.privilege, value=data.value, plan_family=family,
                reason=data.reason, starts_at=data.starts_at, expires_at=data.expires_at, created_by=meta.actor,
            )
            try:
                c.execute(
                    "insert into oe_override (id, organization_id, subject_id, resource_id, privilege, value,"
                    " plan_family, reason, starts_at, expires_at, created_by, created_at)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        oid, org, data.scope.subject_id, data.scope.resource_id, data.privilege,
                        Jsonb(encode_value(data.value)), family, data.reason, data.starts_at, data.expires_at,
                        meta.actor, at,
                    ),
                )
            except psycopg.errors.UniqueViolation as e:
                raise InvalidArgument(f"override id {oid!r} already exists") from e
            return AuditEvent(meta.actor, meta.reason, "override", oid, "create", None, o.to_dict(), at)

        return self._tx(fn)

    def delete_override(self, override_id: str, meta: MutationMeta, at: datetime) -> AuditEvent:
        def fn(c: "psycopg.Connection[Any]") -> AuditEvent:
            row = c.execute(
                "delete from oe_override where id = %s returning id, organization_id, subject_id, resource_id,"
                " privilege, value, plan_family, reason, starts_at, expires_at, created_by",
                (override_id,),
            ).fetchone()
            if row is None:
                raise NotFound(f"override {override_id!r} not found")
            return AuditEvent(meta.actor, meta.reason, "override", override_id, "delete", _override(row).to_dict(), None, at)

        return self._tx(fn)

    def create_grant(
        self, data: GrantInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: datetime
    ) -> AuditEvent:
        validate_scope(data.scope, allow_resource=False)
        validate_grant(privilege, data)
        validate_interval(data.starts_at, data.expires_at)
        require_reason(data.reason, "a grant")

        def fn(c: "psycopg.Connection[Any]") -> AuditEvent:
            gid = data.id or new_id("grt")
            g = Grant(
                id=gid, scope=data.scope, privilege=data.privilege, amount=data.amount, reason=data.reason,
                starts_at=data.starts_at, expires_at=data.expires_at, created_by=meta.actor,
            )
            try:
                c.execute(
                    "insert into oe_grant (id, organization_id, subject_id, privilege, amount, reason, starts_at,"
                    " expires_at, created_by, created_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        gid, data.scope.organization_id, data.scope.subject_id, data.privilege, data.amount,
                        data.reason, data.starts_at, data.expires_at, meta.actor, at,
                    ),
                )
            except psycopg.errors.UniqueViolation as e:
                raise InvalidArgument(f"grant id {gid!r} already exists") from e
            return AuditEvent(meta.actor, meta.reason, "grant", gid, "create", None, g.to_dict(), at)

        return self._tx(fn)

    def revoke_grant(self, grant_id: str, meta: MutationMeta, at: datetime) -> AuditEvent:
        def fn(c: "psycopg.Connection[Any]") -> AuditEvent:
            row = c.execute(
                "select id, organization_id, subject_id, privilege, amount, reason, starts_at, expires_at, revoked_at,"
                " created_by from oe_grant where id = %s and revoked_at is null for update",
                (grant_id,),
            ).fetchone()
            if row is None:
                raise NotFound(f"active grant {grant_id!r} not found")
            c.execute("update oe_grant set revoked_at = %s where id = %s", (at, grant_id))
            before = _grant(row)
            after = Grant(**{**before.__dict__, "revoked_at": at})
            return AuditEvent(meta.actor, meta.reason, "grant", grant_id, "revoke", before.to_dict(), after.to_dict(), at)

        return self._tx(fn)


class PostgresAdvisoryLock:
    """Transactional lock for ``guard`` (spec §5.4). ``count`` and ``act`` receive the connection.

    Both run in ONE transaction holding ``pg_advisory_xact_lock``; it commits after ``act``
    succeeds and rolls back if anything raises.
    """

    domain = "database"

    def __init__(self, conninfo: Optional[str] = None, *, connection_factory: Optional[ConnectionFactory] = None):
        self._connect = _factory(conninfo, connection_factory)

    def run(self, key: str, fn: Callable[[Any], R]) -> R:
        with self._connect() as conn:
            with conn.transaction():
                conn.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (key,))
                return fn(conn)

