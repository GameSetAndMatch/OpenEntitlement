"""The normative resolution algorithm (spec §3), as pure functions.

Facts-based providers reuse :func:`resolve_from_facts` and :func:`suggest_plan_from_facts`
so that every provider derives identical results from identical facts (Requirement 3.1.10).
"""

from __future__ import annotations

from typing import Any, Optional, Union, cast

from .catalog import PrivilegeDefinition, ValueType
from .details import (
    ErrorCode,
    EvaluationContext,
    GrantApplied,
    Reason,
    ResolutionDetails,
    Usage,
    error_details,
    normalize_usage,
)
from .facts import FactSource, Override, Scope, within
from .model import OpenEntitlementModel
from .values import UNLIMITED, Limit, add_limit, is_int, is_unlimited


def _scope_matches(scope: Scope, ctx: EvaluationContext) -> bool:
    """Requirement 3.1.5 (organization equality is guaranteed by the fact query)."""
    if scope.organization_id != ctx.organization_id:
        return False
    if scope.subject_id is not None and scope.subject_id != ctx.subject_id:
        return False
    if scope.resource_id is not None and scope.resource_id != ctx.resource_id:
        return False
    return True


def _specificity(o: Override) -> int:
    """Requirement 3.1.6: subject+resource > resource > subject > organization."""
    s, r = o.scope.subject_id is not None, o.scope.resource_id is not None
    return 3 if (s and r) else 2 if r else 1 if s else 0


def resolve_from_facts(
    facts: FactSource, privilege: PrivilegeDefinition, ctx: EvaluationContext
) -> ResolutionDetails[Any]:
    """Resolve one privilege for one context at ``ctx.now`` (spec §3.1)."""
    assert ctx.now is not None, "the client sets ctx.now before calling providers"
    now = ctx.now
    key = privilege.key
    organization_id = cast(str, ctx.organization_id)  # the client validated the context

    assignment = facts.assignment(organization_id)
    plan = facts.plan(assignment.plan_id) if assignment is not None else None
    if assignment is not None and plan is None:
        return error_details(
            key, privilege.default, ErrorCode.GENERAL, f"assigned plan {assignment.plan_id!r} not found"
        )
    family = plan.family if plan is not None else None

    # 3.1.3 / 3.1.4: base value
    base: Any = privilege.default
    reason = Reason.DEFAULT
    has_plan_value, plan_value = False, None
    if plan is not None:
        found, value = facts.plan_value(plan.id, key)
        if found:
            problem = privilege.validate_value(value)
            if problem:
                return error_details(key, privilege.default, ErrorCode.GENERAL, f"stored plan value: {problem}")
            base, reason, has_plan_value, plan_value = value, Reason.PLAN, True, value

    # 3.1.5 / 3.1.6 / 3.1.9: overrides
    matching = [
        o
        for o in facts.overrides(organization_id, key)
        if _scope_matches(o.scope, ctx) and within(now, o.starts_at, o.expires_at)
    ]
    active = [o for o in matching if family is not None and o.plan_family == family]
    stale = tuple(sorted(o.id for o in matching if not (family is not None and o.plan_family == family)))
    override_id: Optional[str] = None
    if active:
        chosen = sorted(active, key=lambda o: (-_specificity(o), o.id))[0]
        problem = privilege.validate_value(chosen.value)
        if problem:
            return error_details(key, privilege.default, ErrorCode.GENERAL, f"stored override: {problem}")
        base, reason, override_id = chosen.value, Reason.OVERRIDE, chosen.id

    # 3.1.7: grants
    applied: tuple[GrantApplied, ...] = ()
    value = base
    if privilege.value_type is ValueType.INTEGER:
        grants = [
            g
            for g in facts.grants(organization_id, key)
            if (g.revoked_at is None or g.revoked_at > now)
            and within(now, g.starts_at, g.expires_at)
            and (g.scope.subject_id is None or g.scope.subject_id == ctx.subject_id)
        ]
        grants.sort(
            key=lambda g: (
                g.scope.subject_id is None,  # subject allowance first: the draw order of 3.3.3
                g.expires_at is None,  # then earliest expiry first
                g.expires_at.timestamp() if g.expires_at else 0.0,
                g.id,
            )
        )
        applied = tuple(GrantApplied(id=g.id, amount=g.amount, subject_id=g.scope.subject_id) for g in grants)
        if applied:
            value = add_limit(base, sum(g.amount for g in applied))
            if not is_unlimited(base):
                reason = Reason.GRANT

    return ResolutionDetails(
        privilege=key,
        value=value,
        reason=reason,
        grants=applied,
        stale_overrides=stale,
        feature=None,
        plan_id=plan.id if plan is not None else None,
        plan_value=plan_value,
        has_plan_value=has_plan_value,
        override_id=override_id,
    )


# ---------------------------------------------------------------------------
# Limit checks (spec §3.3)


class CheckResult(OpenEntitlementModel):
    passed: bool
    limit: Any
    available: Optional[Limit]
    needed_plan_value: int


def check_within(details: ResolutionDetails[Any], current: Usage, requested: int) -> CheckResult:
    """Apply Requirements 3.3.1 and 3.3.3 to resolved details."""
    if not is_int(requested):
        from .errors import InvalidArgument

        raise InvalidArgument(f"requested must be an integer, got {requested!r}")
    usage = normalize_usage(current)
    value = details.value
    subject_allowance = sum(g.amount for g in details.grants if g.subject_id is not None)
    org_grants = sum(g.amount for g in details.grants if g.subject_id is None)
    remaining_subject = max(0, subject_allowance - usage.subject)
    needed = max(1, usage.pool + requested - remaining_subject - org_grants)
    if requested <= 0:
        return CheckResult(passed=True, limit=value, available=UNLIMITED if is_unlimited(value) else None, needed_plan_value=needed)
    if is_unlimited(value):
        return CheckResult(passed=True, limit=value, available=UNLIMITED, needed_plan_value=needed)
    pool_limit = value - subject_allowance
    available = remaining_subject + max(0, pool_limit - usage.pool)
    return CheckResult(passed=requested <= available, limit=value, available=available, needed_plan_value=needed)


# ---------------------------------------------------------------------------
# Required plan (spec §3.4)

Need = Union[bool, int, str]
"""True for a boolean gate, the needed plan value for integers, the target option for enums."""


def satisfies(privilege: PrivilegeDefinition, value: Any, need: Need) -> bool:
    """Requirement 3.4.3."""
    if privilege.value_type is ValueType.BOOLEAN:
        return value is True
    if privilege.value_type is ValueType.INTEGER:
        return is_unlimited(value) or (is_int(value) and value >= need)
    if value not in privilege.options or need not in privilege.options:
        return False
    return privilege.options.index(value) >= privilege.options.index(need)  # type: ignore[arg-type]


def suggest_plan_from_facts(
    facts: FactSource, privilege: PrivilegeDefinition, need: Need, ctx: EvaluationContext
) -> Optional[str]:
    """Requirement 3.4.2: lowest-ranked public base plan above the current one that satisfies ``need``."""
    assignment = facts.assignment(cast(str, ctx.organization_id))
    current = facts.plan(assignment.plan_id) if assignment else None
    candidates = [
        p
        for p in facts.plans()
        if p.public
        and p.variant_of is None
        and p.rank is not None
        and (current is None or p.family != current.family)
        and (current is None or current.rank is None or p.rank > current.rank)
    ]
    candidates.sort(key=lambda p: (p.rank, p.id))
    for p in candidates:
        found, value = facts.plan_value(p.id, privilege.key)
        if found and satisfies(privilege, value, need):
            return p.id
    return None
