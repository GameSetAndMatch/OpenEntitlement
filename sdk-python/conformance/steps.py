"""Step definitions for the OpenEntitlement conformance suite (spec/assets/gherkin)."""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional

from openentitlement import (
    UNLIMITED,
    AuditLog,
    Catalog,
    EntitlementClient,
    EntitlementDenied,
    EvaluationContext,
    FixedProvider,
    MutationHook,
    Plan,
    ResolutionDetails,
    create_client,
    encode_json,
    pool_usage,
    to_http_problem,
)
from openentitlement.values import decode_value

ACTOR, REASON = "conformance", "conformance setup"


class Vetoed(Exception):
    code = "VETOED"


class _VetoHook(MutationHook):
    def __init__(self) -> None:
        self.active = False

    def before(self, ctx):  # type: ignore[no-untyped-def]
        if self.active:
            raise Vetoed("vetoed by policy hook")


@dataclass
class World:
    target: Any
    catalog: Catalog
    plans_fixture: dict[str, Any]
    now: datetime = field(default_factory=lambda: datetime.fromisoformat("2026-06-15T12:00:00+00:00"))
    client: Optional[EntitlementClient] = None
    seeder: Any = None
    audit: AuditLog = field(default_factory=AuditLog)
    veto: _VetoHook = field(default_factory=_VetoHook)
    details: Optional[ResolutionDetails[Any]] = None
    denial: Optional[EntitlementDenied] = None
    check_ran: bool = False
    error: Optional[BaseException] = None
    error_consumed: bool = True
    when_started: bool = False
    event: Any = None
    pool: Optional[int] = None
    guard_results: list[Any] = field(default_factory=list)

    def make_client(self, provider: Any, lock: Any = None) -> None:
        self.client = create_client(
            provider,
            self.catalog,
            clock=lambda: self.now,
            mutation_hooks=[self.veto, self.audit],
            lock=lock,
        )


def parse_value(raw: str) -> Any:
    raw = raw.strip()
    if raw == "true":
        return True
    if raw == "false":
        return False
    if raw == "unlimited":
        return UNLIMITED
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    return int(raw)


def ts(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


SCOPE = r'(?P<scope>(?:subject "[^"]*" and resource "[^"]*"|subject "[^"]*"|resource "[^"]*") of organization "[^"]*"|organization "[^"]*")'
VALUE = r'(?P<value>true|false|unlimited|-?\d+|"[^"]*")'
DATES = r'(?: from "(?P<from>[^"]+)")?(?: until "(?P<until>[^"]+)")?'


def parse_scope(text: str) -> dict[str, Optional[str]]:
    org = re.search(r'organization "([^"]*)"', text)
    sub = re.search(r'subject "([^"]*)"', text)
    res = re.search(r'resource "([^"]*)"', text)
    return {
        "organization_id": org.group(1) if org else "",
        "subject_id": sub.group(1) if sub else None,
        "resource_id": res.group(1) if res else None,
    }


def ctx_of(scope_text: str, at: Optional[str] = None) -> EvaluationContext:
    s = parse_scope(scope_text)
    return EvaluationContext(
        organization_id=s["organization_id"] or "",
        subject_id=s["subject_id"],
        resource_id=s["resource_id"],
        now=ts(at) if at else None,
    )


STEPS: list[tuple[str, re.Pattern[str], Callable[..., None]]] = []


def step(keyword: str, pattern: str) -> Callable[[Callable[..., None]], Callable[..., None]]:
    def deco(fn: Callable[..., None]) -> Callable[..., None]:
        STEPS.append((keyword, re.compile("^" + pattern + "$"), fn))
        return fn

    return deco


def capture(world: World, fn: Callable[[], Any]) -> Any:
    """In When steps, capture non-denial errors for a later 'the operation fails with'."""
    try:
        return fn()
    except EntitlementDenied as d:
        world.denial = d
    except Exception as e:  # noqa: BLE001
        world.error, world.error_consumed = e, False
    return None


def code_of(e: BaseException) -> str:
    return getattr(e, "code", type(e).__name__)


# ---------------------------------------------------------------- Given


@step("Given", r"the standard plans")
def _standard_plans(w: World) -> None:
    w.target.setup(w)
    for p in w.plans_fixture["plans"]:
        w.seeder.upsert_plan(
            Plan(id=p["id"], name=p["name"], rank=p.get("rank"), public=p.get("public", True), variant_of=p.get("variantOf")),
            actor=ACTOR,
            reason=REASON,
        )
        for key, raw in p["values"].items():
            w.seeder.set_plan_value(p["id"], key, decode_value(raw), actor=ACTOR, reason=REASON)


@step("Given", r'the clock is "(?P<at>[^"]+)"')
def _clock(w: World, at: str) -> None:
    w.now = ts(at)


@step("Given", r'organization "(?P<org>[^"]*)" is on plan "(?P<plan>[^"]*)"(?: paid by "(?P<channel>[^"]*)")?')
def _on_plan(w: World, org: str, plan: str, channel: Optional[str]) -> None:
    w.seeder.assign_plan(org, plan, actor=ACTOR, reason=REASON, channel=channel)


@step("Given", r'organization "(?P<org>[^"]*)" has no plan')
def _no_plan(w: World, org: str) -> None:
    pass  # organizations start without a plan


@step("Given", r'an override "(?P<id>[^"]*)" sets "(?P<priv>[^"]*)" to ' + VALUE + " for " + SCOPE + DATES)
def _override(w: World, id: str, priv: str, value: str, scope: str, **dates: Optional[str]) -> None:
    s = parse_scope(scope)
    w.seeder.create_override(
        s["organization_id"], priv, parse_value(value), actor=ACTOR, reason="negotiated contract", id=id,
        subject_id=s["subject_id"], resource_id=s["resource_id"],
        starts_at=ts(dates["from"]) if dates.get("from") else None,
        expires_at=ts(dates["until"]) if dates.get("until") else None,
    )


@step("Given", r'a grant "(?P<id>[^"]*)" adds (?P<amount>\d+) "(?P<priv>[^"]*)" for ' + SCOPE + DATES)
def _grant(w: World, id: str, amount: str, priv: str, scope: str, **dates: Optional[str]) -> None:
    s = parse_scope(scope)
    w.seeder.create_grant(
        s["organization_id"], priv, int(amount), actor=ACTOR, reason="pack", id=id, subject_id=s["subject_id"],
        starts_at=ts(dates["from"]) if dates.get("from") else None,
        expires_at=ts(dates["until"]) if dates.get("until") else None,
    )


@step("Given", r"a fixed provider configured with (?P<raw>\{.*\})")
def _fixed(w: World, raw: str) -> None:
    w.make_client(FixedProvider(w.catalog, {k: decode_value(v) for k, v in json.loads(raw).items()}))


@step("Given", r"a mutation hook that vetoes every change")
def _veto(w: World) -> None:
    w.veto.active = True


# ---------------------------------------------------------------- When: mutations


@step("When", r'I try to make plan "(?P<plan>[^"]*)" a variant of "(?P<base>[^"]*)"')
def _reparent(w: World, plan: str, base: str) -> None:
    capture(w, lambda: w.client.admin.upsert_plan(Plan(id=plan, name=plan, variant_of=base), actor="pricing", reason="plan family update"))



@step("When", r'organization "(?P<org>[^"]*)" moves to plan "(?P<plan>[^"]*)"')
def _moves(w: World, org: str, plan: str) -> None:
    capture(w, lambda: w.seeder.assign_plan(org, plan, actor="billing", reason="plan change"))


@step("When", r'organization "(?P<org>[^"]*)" loses its plan')
def _loses(w: World, org: str) -> None:
    capture(w, lambda: w.seeder.assign_plan(org, None, actor="billing", reason="cancelled"))


@step("When", r'override "(?P<id>[^"]*)" is deleted')
def _delete_override(w: World, id: str) -> None:
    capture(w, lambda: w.client.admin.delete_override(id, actor="support", reason="contract ended"))


@step("When", r'grant "(?P<id>[^"]*)" is revoked')
def _revoke(w: World, id: str) -> None:
    capture(w, lambda: w.client.admin.revoke_grant(id, actor="support", reason="refund"))


@step("When", r'"(?P<actor>[^"]*)" sets plan "(?P<plan>[^"]*)" "(?P<priv>[^"]*)" to ' + VALUE + r' because "(?P<reason>[^"]*)"')
def _set_value(w: World, actor: str, plan: str, priv: str, value: str, reason: str) -> None:
    capture(w, lambda: w.client.admin.set_plan_value(plan, priv, parse_value(value), actor=actor, reason=reason))


@step("When", r'"(?P<actor>[^"]*)" sets plan "(?P<plan>[^"]*)" "(?P<priv>[^"]*)" to ' + VALUE + " without a reason")
def _set_value_no_reason(w: World, actor: str, plan: str, priv: str, value: str) -> None:
    capture(w, lambda: w.client.admin.set_plan_value(plan, priv, parse_value(value), actor=actor, reason=""))


@step("When", r'I try to create an override "(?P<id>[^"]*)" setting "(?P<priv>[^"]*)" to ' + VALUE + " for " + SCOPE + DATES)
def _try_override(w: World, id: str, priv: str, value: str, scope: str, **dates: Optional[str]) -> None:
    s = parse_scope(scope)
    capture(
        w,
        lambda: w.client.admin.create_override(
            s["organization_id"], priv, parse_value(value), actor="support", reason="negotiated contract", id=id,
            subject_id=s["subject_id"], resource_id=s["resource_id"],
            starts_at=ts(dates["from"]) if dates.get("from") else None,
            expires_at=ts(dates["until"]) if dates.get("until") else None,
        ),
    )


@step("When", r'I try to grant (?P<amount>-?\d+) "(?P<priv>[^"]*)" to organization "(?P<org>[^"]*)"(?: as "(?P<id>[^"]*)")?')
def _try_grant(w: World, amount: str, priv: str, org: str, id: Optional[str]) -> None:
    capture(w, lambda: w.client.admin.create_grant(org, priv, int(amount), actor="support", reason="pack", id=id))


@step("When", r"I create a fixed provider configured with (?P<raw>\{.*\})")
def _fixed_create(w: World, raw: str) -> None:
    capture(w, lambda: FixedProvider(w.catalog, {k: decode_value(v) for k, v in json.loads(raw).items()}))


# ---------------------------------------------------------------- When: evaluation


@step("When", r'I resolve "(?P<priv>[^"]*)" for ' + SCOPE + r'(?: at "(?P<at>[^"]+)")?')
def _resolve(w: World, priv: str, scope: str, at: Optional[str]) -> None:
    w.details = w.client.get_details(priv, ctx_of(scope, at))


@step("When", r'I read the limit of "(?P<priv>[^"]*)" for ' + SCOPE)
def _read_limit(w: World, priv: str, scope: str) -> None:
    w.details = w.client.get_limit_details(priv, ctx_of(scope))


@step("When", r'I read the option of "(?P<priv>[^"]*)" for ' + SCOPE)
def _read_option(w: World, priv: str, scope: str) -> None:
    w.details = w.client.get_enum_details(priv, ctx_of(scope))


@step("When", r'I check feature "(?P<feature>[^"]*)" for ' + SCOPE)
def _check_feature(w: World, feature: str, scope: str) -> None:
    w.details = w.client.is_enabled_details(feature, ctx_of(scope))


@step("When", r'I require feature "(?P<feature>[^"]*)" for ' + SCOPE)
def _require_feature(w: World, feature: str, scope: str) -> None:
    w.check_ran = True
    w.details = capture(w, lambda: w.client.require_enabled(feature, ctx_of(scope)))


@step("When", r'I require (?P<req>-?\d+) more "(?P<priv>[^"]*)" with current (?P<cur>-?\d+) for ' + SCOPE)
def _require_within(w: World, req: str, priv: str, cur: str, scope: str) -> None:
    w.check_ran = True
    w.details = capture(w, lambda: w.client.require_within(priv, int(cur), int(req), ctx_of(scope)))


@step(
    "When",
    r'I require (?P<req>-?\d+) more "(?P<priv>[^"]*)" with pool usage (?P<pool>\d+) and subject usage (?P<sub>\d+) for ' + SCOPE,
)
def _require_within_pool(w: World, req: str, priv: str, pool: str, sub: str, scope: str) -> None:
    w.check_ran = True
    usage = {"pool": int(pool), "subject": int(sub)}
    w.details = capture(w, lambda: w.client.require_within(priv, usage, int(req), ctx_of(scope)))


@step("When", r"I compute the pool usage of (?P<usage>\{.*?\}) with allowances (?P<allow>\{.*?\})(?: and (?P<un>\d+) unattributed)?")
def _pool_usage(w: World, usage: str, allow: str, un: Optional[str]) -> None:
    w.pool = pool_usage(json.loads(usage), json.loads(allow), int(un or 0))


@step("When", r'(?P<n>\d+) concurrent guarded requests each add (?P<k>\d+) "(?P<priv>[^"]*)" for organization "(?P<org>[^"]*)"')
def _concurrent(w: World, n: str, k: str, priv: str, org: str) -> None:
    counter = w.target.counter(org)
    results: list[Any] = []
    lock = threading.Lock()
    start = threading.Barrier(int(n))

    def worker() -> None:
        start.wait()
        try:
            r = w.client.guard(priv, int(k), {"organizationId": org}, count=counter.count, act=counter.increment)
            out: Any = r
        except EntitlementDenied:
            out = None
        except Exception as e:  # noqa: BLE001
            out = e
        with lock:
            results.append(out)

    threads = [threading.Thread(target=worker) for _ in range(int(n))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    errors = [r for r in results if isinstance(r, BaseException)]
    if errors:
        raise errors[0]
    w.guard_results = results
    w.target.last_counter = counter


# ---------------------------------------------------------------- Then


def _encoded(value: Any) -> Any:
    return encode_json(value)


@step("Then", r"the value is " + VALUE)
def _value(w: World, value: str) -> None:
    expected = parse_value(value)
    assert w.details is not None, "nothing was resolved"
    assert _encoded(w.details.value) == _encoded(expected) and type(w.details.value) is type(expected), (
        f"value {w.details.value!r} != {expected!r} ({w.details.to_dict()})"
    )


@step("Then", r"there is no value")
def _no_value(w: World) -> None:
    assert w.details is not None and w.details.value is None, w.details and w.details.to_dict()


@step("Then", r'the reason is "(?P<reason>[A-Z_]+)"')
def _reason(w: World, reason: str) -> None:
    assert w.details is not None and w.details.reason.value == reason, w.details and w.details.to_dict()


@step("Then", r"the plan value is " + VALUE)
def _plan_value(w: World, value: str) -> None:
    assert w.details is not None and w.details.has_plan_value, w.details and w.details.to_dict()
    assert _encoded(w.details.plan_value) == _encoded(parse_value(value)), w.details.to_dict()


@step("Then", r"there is no plan value")
def _no_plan_value(w: World) -> None:
    assert w.details is not None and not w.details.has_plan_value, w.details and w.details.to_dict()


@step("Then", r'the override is "(?P<id>[^"]*)"')
def _override_is(w: World, id: str) -> None:
    assert w.details is not None and w.details.override_id == id, w.details and w.details.to_dict()


@step("Then", r"no override applies")
def _no_override(w: World) -> None:
    assert w.details is not None and w.details.override_id is None, w.details and w.details.to_dict()


@step("Then", r'the grants are "(?P<ids>[^"]*)"')
def _grants_are(w: World, ids: str) -> None:
    assert w.details is not None
    assert sorted(g.id for g in w.details.grants) == sorted(i.strip() for i in ids.split(",")), w.details.to_dict()


@step("Then", r"no grants apply")
def _no_grants(w: World) -> None:
    assert w.details is not None and not w.details.grants, w.details and w.details.to_dict()


@step("Then", r'the stale overrides are "(?P<ids>[^"]*)"')
def _stale(w: World, ids: str) -> None:
    assert w.details is not None
    assert sorted(w.details.stale_overrides) == sorted(i.strip() for i in ids.split(",")), w.details.to_dict()


@step("Then", r"there are no stale overrides")
def _no_stale(w: World) -> None:
    assert w.details is not None and not w.details.stale_overrides, w.details and w.details.to_dict()


@step("Then", r'the error code is "(?P<code>[A-Z_]+)"')
def _error_code(w: World, code: str) -> None:
    assert w.details is not None and w.details.error_code is not None and w.details.error_code.value == code, (
        w.details and w.details.to_dict()
    )


@step("Then", r'the required plan is "(?P<plan>[^"]*)"')
def _required_plan(w: World, plan: str) -> None:
    got = w.denial.required_plan if w.denial is not None else (w.details.required_plan if w.details else None)
    assert got == plan, f"required plan {got!r} != {plan!r}"
    if w.denial is not None:
        assert w.denial.details.required_plan == plan


@step("Then", r"there is no required plan")
def _no_required_plan(w: World) -> None:
    got = w.denial.required_plan if w.denial is not None else (w.details.required_plan if w.details else None)
    assert got is None, f"unexpected required plan {got!r}"


@step("Then", r"the check passes")
def _passes(w: World) -> None:
    assert w.check_ran and w.denial is None and w.error is None, f"denied: {w.denial} / error: {w.error}"


@step("Then", r"the check fails")
def _fails(w: World) -> None:
    assert w.denial is not None, f"expected a denial (error: {w.error!r})"


@step("Then", r'the denial code is "(?P<code>[a-z_]+)"')
def _denial_code(w: World, code: str) -> None:
    assert w.denial is not None and w.denial.code == code


@step("Then", r"the denial reports limit " + VALUE + r", current (?P<cur>\d+) and requested (?P<req>-?\d+)")
def _denial_reports(w: World, value: str, cur: str, req: str) -> None:
    d = w.denial
    assert d is not None and hasattr(d, "limit")
    assert _encoded(d.limit) == _encoded(parse_value(value)) and d.current == int(cur) and d.requested == int(req)  # type: ignore[attr-defined]


@step("Then", r'the operation fails with "(?P<code>[A-Za-z_]+)"')
def _op_fails(w: World, code: str) -> None:
    assert w.error is not None, "expected the operation to fail"
    assert code_of(w.error) == code, f"error {w.error!r} has code {code_of(w.error)!r}, expected {code!r}"
    w.error_consumed = True


@step("Then", r"the operation succeeds")
def _op_succeeds(w: World) -> None:
    assert w.error is None, f"unexpected error {w.error!r}"


@step("Then", r"an audit event records (?P<action>\w+) of (?P<entity>\w+) \"(?P<id>[^\"]*)\"")
def _audit(w: World, action: str, entity: str, id: str) -> None:
    matches = [e for e in w.audit.events if e.action == action and e.entity == entity and e.entity_id == id]
    assert matches, f"no {action} {entity} {id}: {[e.to_dict() for e in w.audit.events]}"
    w.event = matches[-1]


@step("Then", r"its (?P<which>before|after) is (?P<raw>.+)")
def _its_is(w: World, which: str, raw: str) -> None:
    assert w.event is not None
    got = w.event.to_dict()[which]
    assert got == json.loads(raw), f"{which}: {got!r} != {raw}"


@step("Then", r"its (?P<which>before|after) includes (?P<raw>\{.+\})")
def _its_includes(w: World, which: str, raw: str) -> None:
    got = w.event.to_dict()[which]
    want = json.loads(raw)
    assert isinstance(got, dict) and all(got.get(k) == v for k, v in want.items()), f"{which}: {got!r} lacks {want!r}"


@step("Then", r'its after marks it revoked at "(?P<at>[^"]+)"')
def _its_revoked(w: World, at: str) -> None:
    got = w.event.to_dict()["after"]
    assert got and got.get("revokedAt") and ts(got["revokedAt"]) == ts(at), got


@step("Then", r'its (?P<field>actor|reason) is "(?P<v>[^"]*)"')
def _its_field(w: World, field: str, v: str) -> None:
    assert getattr(w.event, field) == v


@step("Then", r'its time is "(?P<at>[^"]+)"')
def _its_time(w: World, at: str) -> None:
    assert w.event.at == ts(at), w.event.at


@step("Then", r"no audit event was recorded")
def _no_audit(w: World) -> None:
    assert not w.audit.events, [e.to_dict() for e in w.audit.events]


@step("Then", r"the pool usage is (?P<n>\d+)")
def _pool_is(w: World, n: str) -> None:
    assert w.pool == int(n), w.pool


@step("Then", r"exactly (?P<n>\d+) succeed")
def _exactly(w: World, n: str) -> None:
    ok = [r for r in w.guard_results if r is not None]
    assert len(ok) == int(n), f"{len(ok)} succeeded, expected {n}"


@step("Then", r"the usage counter is (?P<n>\d+)")
def _counter(w: World, n: str) -> None:
    assert w.target.last_counter.value() == int(n), w.target.last_counter.value()


@step("Then", r"the lock domain is reported")
def _lock_domain(w: World) -> None:
    ok = [r for r in w.guard_results if r is not None]
    assert ok and ok[0].details.lock_domain, "no lock domain on guard details"


@step("Then", r"the details encode the value as (?P<raw>.+)")
def _encodes(w: World, raw: str) -> None:
    assert w.details is not None and w.details.to_dict()["value"] == json.loads(raw)


@step("Then", r"the HTTP status is (?P<status>\d+)")
def _http_status(w: World, status: str) -> None:
    assert w.denial is not None
    assert to_http_problem(w.denial)[0] == int(status)


@step("Then", r"the HTTP problem includes (?P<raw>\{.+\})")
def _http_includes(w: World, raw: str) -> None:
    assert w.denial is not None
    body = to_http_problem(w.denial)[1]
    want = json.loads(raw)
    assert all(body.get(k) == v for k, v in want.items()), f"{body} lacks {want}"


@step("Then", r'the HTTP problem has no "(?P<key>[^"]+)"')
def _http_lacks(w: World, key: str) -> None:
    assert w.denial is not None and key not in to_http_problem(w.denial)[1]


def run_step(w: World, keyword: str, text: str) -> None:
    if keyword == "When" and not w.when_started:
        w.when_started = True
        w.audit.events.clear()
    if keyword == "When":
        w.denial, w.check_ran = None, False
    for kw, pattern, fn in STEPS:
        if kw != keyword:
            continue
        m = pattern.match(text)
        if m:
            fn(w, **m.groupdict())
            return
    raise LookupError(f"undefined step: {keyword} {text}")
