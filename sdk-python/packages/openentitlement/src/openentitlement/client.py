"""The evaluation client (spec §4), guard (spec §5) and admin interface (spec §6.3, §7.2)."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Generic, Iterable, Mapping, Optional, Sequence, TypeVar, Union

from .catalog import Catalog, PrivilegeDefinition, ValueType
from .details import (
    ErrorCode,
    EvaluationContext,
    Reason,
    ResolutionDetails,
    Usage,
    error_details,
    normalize_usage,
)
from .errors import (
    EntitlementLimitExceeded,
    FeatureNotEntitled,
    InvalidArgument,
    NotFound,
    NotSupported,
    ProviderNotReady,
    TypeMismatch,
)
from .facts import Plan, Scope
from .hooks import Hook, HookContext, MutationContext, MutationHook
from .lock import InProcessLock, Lock, lock_key
from .provider import AuditEvent, GrantInput, MutationMeta, OverrideInput, Provider
from .resolver import Need, check_within
from .values import Limit, is_int, is_unlimited

log = logging.getLogger("openentitlement")

R = TypeVar("R")
Clock = Callable[[], datetime]

SPEC_VERSION = "0.1.0"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Treat naive datetimes as UTC so comparisons never mix naive and aware values."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class EvaluationError(Exception):
    """Passed to ``error`` hooks when resolution returns reason ERROR."""

    def __init__(self, details: ResolutionDetails[Any]):
        super().__init__(f"{details.error_code.value if details.error_code else 'ERROR'}: {details.error_message}")
        self.details = details


@dataclass(frozen=True)
class GuardResult(Generic[R]):
    result: R
    details: ResolutionDetails[Any]


ContextArg = Union[EvaluationContext, Mapping[str, Any], None]


def to_context(ctx: ContextArg) -> Optional[EvaluationContext]:
    """Accept an EvaluationContext or a dict with spec (camelCase) or Python (snake_case) names."""
    if ctx is None or isinstance(ctx, EvaluationContext):
        return ctx
    get = lambda *names: next((ctx[n] for n in names if n in ctx), None)  # noqa: E731
    return EvaluationContext(
        **({"organization_id": get("organization_id", "organizationId")}
           if "organization_id" in ctx or "organizationId" in ctx else {}),
        subject_id=get("subject_id", "subjectId"),
        resource_id=get("resource_id", "resourceId"),
        now=get("now"),
    )


class EntitlementClient:
    def __init__(
        self,
        provider: Provider,
        catalog: Catalog,
        *,
        context: ContextArg = None,
        hooks: Iterable[Hook] = (),
        mutation_hooks: Iterable[MutationHook] = (),
        clock: Clock = utc_now,
        lock: Optional[Lock] = None,
    ):
        if not isinstance(catalog, Catalog):
            raise InvalidArgument("catalog must be an openentitlement.Catalog")
        self.provider = provider
        self.catalog = catalog
        self.context = to_context(context) or EvaluationContext()
        self.hooks: list[Hook] = list(hooks)
        self.mutation_hooks: list[MutationHook] = list(mutation_hooks)
        self.clock = clock
        self.lock: Lock = lock or InProcessLock()
        self.admin = AdminClient(self)
        self._init_lock = threading.Lock()
        self._init_state: Optional[BaseException | bool] = None

    # -- metadata ---------------------------------------------------------------------------------

    @property
    def provider_metadata(self):  # type: ignore[no-untyped-def]
        """Requirement 4.1.2."""
        return self.provider.metadata

    # -- internals --------------------------------------------------------------------------------

    def _ensure_initialized(self) -> Optional[BaseException]:
        """Requirement 6.1.6: initialize once, before the first resolve."""
        if self._init_state is True:
            return None
        with self._init_lock:
            if self._init_state is None:
                try:
                    init = getattr(self.provider, "initialize", None)
                    if init is not None:
                        init()
                    self._init_state = True
                except Exception as e:  # noqa: BLE001
                    self._init_state = e
        return None if self._init_state is True else self._init_state  # type: ignore[return-value]

    def _merge(self, ctx: ContextArg) -> EvaluationContext:
        merged = self.context.merged_with(to_context(ctx))
        now = aware(merged.now) or aware(self.clock())
        return EvaluationContext(merged.organization_id, merged.subject_id, merged.resource_id, now)

    def _evaluate(
        self,
        key: str,
        ctx: ContextArg,
        *,
        expect: Optional[ValueType] = None,
        fallback: Any = None,
        feature: Optional[str] = None,
    ) -> ResolutionDetails[Any]:
        merged = self._merge(ctx)
        priv = self.catalog.privilege(key)
        hctx = HookContext(
            privilege=key,
            value_type=priv.value_type if priv else None,
            context=merged,
            provider_metadata=self.provider.metadata,
            feature=feature,
        )
        details: Optional[ResolutionDetails[Any]] = None
        try:
            for h in self.hooks:
                h.before(hctx)
        except Exception as e:  # noqa: BLE001 - Requirement 7.1.5
            details = error_details(key, fallback if priv is None else priv.default, ErrorCode.GENERAL, f"before hook: {e}")
            self._run_error_hooks(hctx, e)
            self._run_finally_hooks(hctx, details)
            return details.with_(feature=feature)

        details = self._resolve(key, priv, merged, expect=expect, fallback=fallback).with_(feature=feature)
        if details.reason is Reason.ERROR:
            self._run_error_hooks(hctx, EvaluationError(details))
        else:
            for h in reversed(self.hooks):
                try:
                    h.after(hctx, details)
                except Exception:  # noqa: BLE001
                    log.exception("after hook failed")
        self._run_finally_hooks(hctx, details)
        return details

    def _resolve(
        self,
        key: str,
        priv: Optional[PrivilegeDefinition],
        ctx: EvaluationContext,
        *,
        expect: Optional[ValueType],
        fallback: Any,
    ) -> ResolutionDetails[Any]:
        if priv is None:
            return error_details(key, fallback, ErrorCode.PRIVILEGE_NOT_FOUND, f"{key!r} is not in the catalog")
        if expect is not None and priv.value_type is not expect:
            return error_details(
                key, fallback, ErrorCode.TYPE_MISMATCH, f"{key} is {priv.value_type.value}, not {expect.value}"
            )
        problem = ctx.validation_error()
        if problem:
            return error_details(key, priv.default, ErrorCode.INVALID_CONTEXT, problem)
        init_error = self._ensure_initialized()
        if init_error is not None:
            return error_details(key, priv.default, ErrorCode.PROVIDER_NOT_READY, f"initialize failed: {init_error}")
        try:
            details = self.provider.resolve(priv, ctx)
        except ProviderNotReady as e:
            return error_details(key, priv.default, ErrorCode.PROVIDER_NOT_READY, str(e))
        except Exception as e:  # noqa: BLE001 - Requirement 6.1.5
            return error_details(key, priv.default, ErrorCode.GENERAL, f"provider error: {e}")
        if not isinstance(details, ResolutionDetails):
            return error_details(key, priv.default, ErrorCode.GENERAL, "provider returned no resolution details")
        if details.reason is Reason.ERROR:
            return details.with_(value=priv.default, grants=())
        problem = priv.validate_value(details.value)
        if problem:
            return error_details(key, priv.default, ErrorCode.GENERAL, f"provider returned an invalid value: {problem}")
        return details

    def _run_error_hooks(self, hctx: HookContext, err: BaseException) -> None:
        for h in reversed(self.hooks):
            try:
                h.error(hctx, err)
            except Exception:  # noqa: BLE001
                log.exception("error hook failed")

    def _run_finally_hooks(self, hctx: HookContext, details: Optional[ResolutionDetails[Any]]) -> None:
        for h in reversed(self.hooks):
            try:
                h.finally_after(hctx, details)
            except Exception:  # noqa: BLE001
                log.exception("finally hook failed")

    def _suggest(self, priv: PrivilegeDefinition, need: Need, ctx: ContextArg) -> Optional[str]:
        if not self.provider.capabilities.plan_catalog:
            return None
        suggest = getattr(self.provider, "suggest_plan", None)
        if suggest is None:
            return None
        merged = self._merge(ctx)
        if merged.validation_error():
            return None
        try:
            return suggest(priv, need, merged)
        except Exception:  # noqa: BLE001
            log.exception("suggest_plan failed")
            return None

    # -- generic (Requirement 4.2.7) --------------------------------------------------------------

    def get_details(self, privilege: str, ctx: ContextArg = None) -> ResolutionDetails[Any]:
        """Resolve any privilege with no type expectation; never raises."""
        return self._evaluate(privilege, ctx, fallback=None)

    # -- features (Requirements 4.2.1, 4.2.2, 3.2.x) ---------------------------------------------

    def is_enabled_details(self, feature: str, ctx: ContextArg = None) -> ResolutionDetails[bool]:
        f = self.catalog.feature(feature)
        if f is None:
            return error_details("", False, ErrorCode.FEATURE_NOT_FOUND, f"feature {feature!r} is not in the catalog", feature)
        gate = self.catalog.privilege(f.gate_key)
        assert gate is not None
        d = self._evaluate(gate.key, ctx, feature=feature, fallback=gate.default)
        v = d.value
        enabled = (v is True) if gate.value_type is ValueType.BOOLEAN else (is_unlimited(v) or (is_int(v) and v > 0))
        out = d.with_(value=enabled)
        if not enabled and d.reason is not Reason.ERROR:
            need: Need = True if gate.value_type is ValueType.BOOLEAN else 1
            required = self._suggest(gate, need, ctx)
            if required is not None:
                out = out.with_(required_plan=required)
        return out

    def is_enabled(self, feature: str, ctx: ContextArg = None) -> bool:
        return bool(self.is_enabled_details(feature, ctx).value)

    def require_enabled(self, feature: str, ctx: ContextArg = None) -> ResolutionDetails[bool]:
        d = self.is_enabled_details(feature, ctx)
        if not d.value:
            f = self.catalog.feature(feature)
            raise FeatureNotEntitled(
                feature=feature,
                privilege=f.gate_key if f else d.privilege,
                details=d,
                required_plan=d.required_plan,
            )
        return d

    # -- limits (Requirements 4.2.3, 4.2.4) -------------------------------------------------------

    def get_limit_details(self, privilege: str, ctx: ContextArg = None) -> ResolutionDetails[Limit]:
        return self._evaluate(privilege, ctx, expect=ValueType.INTEGER, fallback=0)

    def get_limit(self, privilege: str, ctx: ContextArg = None) -> Limit:
        return self.get_limit_details(privilege, ctx).value

    def require_within(
        self, privilege: str, current: Usage, requested: int, ctx: ContextArg = None
    ) -> ResolutionDetails[Limit]:
        """Check-only: NOT atomic with whatever you do next. Use :meth:`guard` for that (Requirement 5.1.1)."""
        if not is_int(requested):
            raise InvalidArgument(f"requested must be an integer, got {requested!r}")
        normalize_usage(current)  # validates (Requirement 3.3.2)
        priv = self.catalog.privilege(privilege)
        if priv is not None and priv.value_type is not ValueType.INTEGER:
            raise TypeMismatch(f"require_within needs an integer privilege; {privilege} is {priv.value_type.value}")
        d = self._evaluate(privilege, ctx, expect=ValueType.INTEGER, fallback=0)
        return self._check_resolved_limit(privilege, d, current, requested, ctx)

    def _check_resolved_limit(
        self, privilege: str, d: ResolutionDetails[Limit], current: Usage, requested: int, ctx: ContextArg
    ) -> ResolutionDetails[Limit]:
        priv = self.catalog.privilege(privilege)
        if priv is not None and priv.value_type is not ValueType.INTEGER:
            raise TypeMismatch(f"require_within needs an integer privilege; {privilege} is {priv.value_type.value}")
        result = check_within(d, current, requested)
        if result.passed:
            return d
        required = None
        if priv is not None and d.reason is not Reason.ERROR:
            required = self._suggest(priv, result.needed_plan_value, ctx)
        if required is not None:
            d = d.with_(required_plan=required)
        raise EntitlementLimitExceeded(
            feature=priv.feature if priv else "",
            privilege=privilege,
            limit=d.value,
            current=current,
            requested=requested,
            details=d,
            required_plan=required,
        )

    # -- enums (Requirement 4.2.5) ----------------------------------------------------------------

    def get_enum_details(self, privilege: str, ctx: ContextArg = None) -> ResolutionDetails[str]:
        return self._evaluate(privilege, ctx, expect=ValueType.ENUM, fallback="")

    def get_enum(self, privilege: str, ctx: ContextArg = None) -> str:
        return self.get_enum_details(privilege, ctx).value

    # -- required plan (Requirement 4.2.6) --------------------------------------------------------

    def required_plan(self, privilege: str, need: Any, ctx: ContextArg = None) -> Optional[str]:
        """``need``: True (boolean), {"current": c, "requested": r} (integer), or an option (enum)."""
        priv = self.catalog.privilege(privilege)
        if priv is None:
            return None
        if priv.value_type is ValueType.INTEGER:
            if not isinstance(need, Mapping):
                raise InvalidArgument('integer need must be {"current": ..., "requested": ...}')
            d = self._evaluate(privilege, ctx, expect=ValueType.INTEGER, fallback=0)
            if d.reason is Reason.ERROR:
                return None
            need = check_within(d, need.get("current", 0), need.get("requested", 1)).needed_plan_value
        return self._suggest(priv, need, ctx)

    # -- guard (spec §5) --------------------------------------------------------------------------

    def guard(
        self,
        privilege: str,
        requested: int,
        ctx: ContextArg,
        *,
        count: Callable[[Any], Usage],
        act: Callable[[Any], R],
    ) -> GuardResult[R]:
        """Serialized check-then-act (Requirement 5.2.1)."""
        merged = self._merge(ctx)
        problem = merged.validation_error()
        if problem:
            raise InvalidArgument(problem)
        domain = getattr(self.lock, "domain", "unknown")

        def run(tx: Any) -> GuardResult[R]:
            resolved = self.get_limit_details(privilege, merged)
            current = count(tx)
            details = self._check_resolved_limit(privilege, resolved, current, requested, merged)
            return GuardResult(act(tx), details.with_(lock_domain=domain))

        return self.lock.run(lock_key(merged.organization_id, privilege), run)


class AdminClient:
    """Mutations with hooks and audit (spec §6.3, §7.2). Access via ``client.admin``."""

    def __init__(self, client: EntitlementClient):
        self._c = client

    def _privilege(self, key: str) -> PrivilegeDefinition:
        p = self._c.catalog.privilege(key)
        if p is None:
            raise NotFound(f"privilege {key!r} is not in the catalog")
        return p

    def _mutate(self, operation: str, arguments: dict[str, Any], actor: str, reason: str, fn: Callable[..., AuditEvent]) -> AuditEvent:
        meta = MutationMeta(actor, reason)
        meta.check()
        mutations = getattr(self._c.provider, "mutations", None)
        if mutations is None or not self._c.provider.capabilities.mutations:
            raise NotSupported(f"provider {self._c.provider.metadata.name!r} does not support mutations")
        mctx = MutationContext(operation, arguments, actor, reason, self._c.provider.metadata)
        hooks = self._c.mutation_hooks
        try:
            for h in hooks:
                h.before(mctx)
            event = fn(mutations, meta, aware(self._c.clock()))
        except Exception as e:
            for h in reversed(hooks):
                try:
                    h.error(mctx, e)
                except Exception:  # noqa: BLE001
                    log.exception("mutation error hook failed")
            self._finally(mctx)
            raise
        for h in reversed(hooks):
            try:
                h.after(mctx, event)
            except Exception:  # noqa: BLE001 - Requirement 7.2.4
                log.exception("mutation after hook failed")
        self._finally(mctx)
        return event

    def _finally(self, mctx: MutationContext) -> None:
        for h in reversed(self._c.mutation_hooks):
            try:
                h.finally_after(mctx)
            except Exception:  # noqa: BLE001
                log.exception("mutation finally hook failed")

    def upsert_plan(self, plan: Plan, *, actor: str, reason: str) -> AuditEvent:
        return self._mutate("upsertPlan", {"plan": plan}, actor, reason, lambda m, meta, at: m.upsert_plan(plan, meta, at))

    def set_plan_value(self, plan_id: str, privilege: str, value: Any, *, actor: str, reason: str) -> AuditEvent:
        p = self._privilege(privilege)
        return self._mutate(
            "setPlanValue",
            {"planId": plan_id, "privilege": privilege, "value": value},
            actor,
            reason,
            lambda m, meta, at: m.set_plan_value(plan_id, p, value, meta, at),
        )

    def assign_plan(
        self, organization_id: str, plan_id: Optional[str], *, actor: str, reason: str, channel: Optional[str] = None
    ) -> AuditEvent:
        """Pass ``plan_id=None`` to remove the assignment."""
        return self._mutate(
            "assignPlan",
            {"organizationId": organization_id, "planId": plan_id, "channel": channel},
            actor,
            reason,
            lambda m, meta, at: m.assign_plan(organization_id, plan_id, channel, meta, at),
        )

    def create_override(
        self,
        organization_id: str,
        privilege: str,
        value: Any,
        *,
        actor: str,
        reason: str,
        subject_id: Optional[str] = None,
        resource_id: Optional[str] = None,
        starts_at: Optional[datetime] = None,
        expires_at: Optional[datetime] = None,
        plan_family: Optional[str] = None,
        id: Optional[str] = None,
    ) -> AuditEvent:
        p = self._privilege(privilege)
        data = OverrideInput(
            scope=Scope(organization_id, subject_id, resource_id),
            privilege=privilege,
            value=value,
            reason=reason,
            starts_at=aware(starts_at),
            expires_at=aware(expires_at),
            plan_family=plan_family,
            id=id,
        )
        return self._mutate("createOverride", {"override": data}, actor, reason, lambda m, meta, at: m.create_override(data, p, meta, at))

    def delete_override(self, override_id: str, *, actor: str, reason: str) -> AuditEvent:
        return self._mutate(
            "deleteOverride", {"overrideId": override_id}, actor, reason, lambda m, meta, at: m.delete_override(override_id, meta, at)
        )

    def create_grant(
        self,
        organization_id: str,
        privilege: str,
        amount: int,
        *,
        actor: str,
        reason: str,
        subject_id: Optional[str] = None,
        starts_at: Optional[datetime] = None,
        expires_at: Optional[datetime] = None,
        id: Optional[str] = None,
    ) -> AuditEvent:
        p = self._privilege(privilege)
        data = GrantInput(
            scope=Scope(organization_id, subject_id),
            privilege=privilege,
            amount=amount,
            reason=reason,
            starts_at=aware(starts_at),
            expires_at=aware(expires_at),
            id=id,
        )
        return self._mutate("createGrant", {"grant": data}, actor, reason, lambda m, meta, at: m.create_grant(data, p, meta, at))

    def revoke_grant(self, grant_id: str, *, actor: str, reason: str) -> AuditEvent:
        return self._mutate(
            "revokeGrant", {"grantId": grant_id}, actor, reason, lambda m, meta, at: m.revoke_grant(grant_id, meta, at)
        )


def create_client(
    provider: Provider,
    catalog: Union[Catalog, Sequence[Any]],
    **kwargs: Any,
) -> EntitlementClient:
    """Requirement 4.1.1. ``catalog`` may be a Catalog or a list of FeatureDefinitions."""
    cat = catalog if isinstance(catalog, Catalog) else Catalog(catalog)
    return EntitlementClient(provider, cat, **kwargs)
