from __future__ import annotations

import copy
import pickle
import threading
import time
from datetime import datetime, timezone
from typing import Any

import pytest

from openentitlement import (
    UNLIMITED,
    Catalog,
    EntitlementLimitExceeded,
    ErrorCode,
    FixedProvider,
    Hook,
    InMemoryProvider,
    InvalidArgument,
    NotSupported,
    Plan,
    ProviderNotReady,
    Reason,
    ResolutionDetails,
    TypeMismatch,
    boolean,
    create_client,
    decode_value,
    encode_value,
    enum,
    feature,
    fits,
    integer,
    is_unlimited,
    to_http_problem,
)
from openentitlement.provider import AbstractProvider, ProviderMetadata

T0 = datetime(2026, 6, 15, 12, tzinfo=timezone.utc)

CATALOG = Catalog(
    [
        feature("seats", "Seats", [integer("seat_max", default=1, unlimited_allowed=True)]),
        feature("projects", "Projects", [integer("project_max")]),
        feature("sso", "SSO", [boolean("sso_enabled"), integer("sso_connection_max")], gate="sso_enabled"),
        feature("reports", "Reports", [boolean("reports_enabled"), enum("report_retention", ["7d", "90d"])], gate="reports_enabled"),
    ]
)


def provider() -> InMemoryProvider:
    return InMemoryProvider(
        plans=[Plan("free", "Free", rank=0), Plan("pro", "Pro", rank=1)],
        values={
            "free": {"seat_max": 3, "project_max": 1, "sso_enabled": False},
            "pro": {"seat_max": UNLIMITED, "project_max": 5, "sso_enabled": True},
        },
        assignments={"acme": "free"},
    )


# --- values ---------------------------------------------------------------------------------------


def test_unlimited_is_distinct_and_unordered() -> None:
    assert is_unlimited(UNLIMITED) and not is_unlimited(2**63)
    assert UNLIMITED != 0 and UNLIMITED is not None and not isinstance(UNLIMITED, int)
    with pytest.raises(TypeError):
        _ = UNLIMITED > 5  # noqa: B015
    assert fits(10**18, UNLIMITED) and fits(3, 3) and not fits(4, 3)
    assert copy.deepcopy(UNLIMITED) is UNLIMITED and pickle.loads(pickle.dumps(UNLIMITED)) is UNLIMITED
    assert encode_value(UNLIMITED) == {"unlimited": True} and decode_value({"unlimited": True}) is UNLIMITED
    with pytest.raises(ValueError):
        decode_value({"unlimited": False})


# --- catalog --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "features",
    [
        [feature("Bad", "x", [boolean("a")])],
        [feature("a", "A", [boolean("a_x"), boolean("a_y")])],  # no gate
        [feature("a", "A", [enum("a_tier", ["x"])])],  # enum gate
        [feature("a", "A", [boolean("a_x")]), feature("b", "B", [boolean("a_x")])],  # dup key
        [feature("a", "A", [integer("a_max", default=-1)])],
        [feature("a", "A", [integer("a_max", default=UNLIMITED)])],  # unlimited not allowed
        [feature("a", "A", [])],
        [feature("a", "A", [boolean("a_x")], gate="b_y")],
    ],
)
def test_invalid_catalogs_fail_eagerly(features: list[Any]) -> None:
    with pytest.raises(InvalidArgument):
        Catalog(features)


# --- context, errors, providers --------------------------------------------------------------------


def test_default_context_merges_with_invocation() -> None:
    c = create_client(provider(), CATALOG, context={"organizationId": "acme"}, clock=lambda: T0)
    assert c.get_limit("seat_max") == 3
    assert c.get_limit("seat_max", {"organizationId": "nobody"}) == 1  # DEFAULT for unknown org


class Boom(AbstractProvider):
    metadata = ProviderMetadata("boom")

    def resolve(self, privilege, ctx):  # type: ignore[no-untyped-def]
        raise RuntimeError("db down")


class NotReady(AbstractProvider):
    metadata = ProviderMetadata("not-ready")

    def initialize(self) -> None:
        raise ConnectionError("cannot connect")


class Signals(AbstractProvider):
    metadata = ProviderMetadata("signals")

    def resolve(self, privilege, ctx):  # type: ignore[no-untyped-def]
        raise ProviderNotReady("warming up")


class Garbage(AbstractProvider):
    metadata = ProviderMetadata("garbage")

    def resolve(self, privilege, ctx):  # type: ignore[no-untyped-def]
        return ResolutionDetails(privilege=privilege.key, value="lots", reason=Reason.PLAN)


@pytest.mark.parametrize(
    "prov,code",
    [(Boom(), ErrorCode.GENERAL), (NotReady(), ErrorCode.PROVIDER_NOT_READY), (Signals(), ErrorCode.PROVIDER_NOT_READY), (Garbage(), ErrorCode.GENERAL)],
)
def test_provider_failures_never_throw_and_fail_closed(prov: Any, code: ErrorCode) -> None:
    c = create_client(prov, CATALOG, context={"organizationId": "acme"})
    d = c.get_limit_details("seat_max")
    assert d.reason is Reason.ERROR and d.error_code is code and d.value == 1
    assert c.is_enabled("sso") is False
    with pytest.raises(EntitlementLimitExceeded) as e:
        c.require_within("seat_max", 1, 1)
    assert e.value.required_plan is None  # no upsell on ERROR (spec §8.3)


def test_type_mismatches() -> None:
    c = create_client(provider(), CATALOG, context={"organizationId": "acme"})
    with pytest.raises(TypeMismatch):
        c.require_within("sso_enabled", 0, 1)
    assert c.get_enum_details("seat_max").error_code is ErrorCode.TYPE_MISMATCH
    with pytest.raises(InvalidArgument):
        c.require_within("seat_max", 0, 1.5)  # type: ignore[arg-type]


def test_http_problem_encodes_unlimited_and_breakdown() -> None:
    c = create_client(provider(), CATALOG, context={"organizationId": "acme"})
    with pytest.raises(EntitlementLimitExceeded) as e:
        c.require_within("seat_max", {"pool": 3, "subject": 0}, 1)
    status, body = to_http_problem(e.value)
    assert status == 403 and body["current"] == {"pool": 3, "subject": 0} and body["requiredPlan"] == "pro"


def test_admin_on_read_only_provider_is_not_supported() -> None:
    c = create_client(FixedProvider(CATALOG, {"project_max": 9, "sso_connection_max": 1}), CATALOG)
    with pytest.raises(NotSupported):
        c.admin.set_plan_value("pro", "seat_max", 1, actor="a", reason="b")


# --- hooks ----------------------------------------------------------------------------------------


class Recorder(Hook):
    def __init__(self, name: str, log: list[str], fail_before: bool = False, fail_after: bool = False):
        self.name, self.log, self.fail_before, self.fail_after = name, log, fail_before, fail_after

    def before(self, ctx):  # type: ignore[no-untyped-def]
        self.log.append(f"{self.name}.before")
        if self.fail_before:
            raise RuntimeError("nope")

    def after(self, ctx, details):  # type: ignore[no-untyped-def]
        self.log.append(f"{self.name}.after:{details.reason.value}")
        if self.fail_after:
            raise RuntimeError("ignored")

    def error(self, ctx, err):  # type: ignore[no-untyped-def]
        self.log.append(f"{self.name}.error")

    def finally_after(self, ctx, details):  # type: ignore[no-untyped-def]
        self.log.append(f"{self.name}.finally")


def test_hook_order_and_isolation() -> None:
    log: list[str] = []
    c = create_client(provider(), CATALOG, context={"organizationId": "acme"},
                      hooks=[Recorder("a", log), Recorder("b", log, fail_after=True)])
    assert c.get_limit("seat_max") == 3  # an after-hook failure does not change the result
    assert log == ["a.before", "b.before", "b.after:PLAN", "a.after:PLAN", "b.finally", "a.finally"]


def test_before_hook_failure_short_circuits_to_error() -> None:
    log: list[str] = []
    c = create_client(provider(), CATALOG, context={"organizationId": "acme"}, hooks=[Recorder("a", log, fail_before=True)])
    d = c.get_limit_details("seat_max")
    assert d.reason is Reason.ERROR and log == ["a.before", "a.error", "a.finally"]


def test_denial_runs_after_hooks_not_error() -> None:
    log: list[str] = []
    c = create_client(provider(), CATALOG, context={"organizationId": "acme"}, hooks=[Recorder("a", log)])
    with pytest.raises(EntitlementLimitExceeded):
        c.require_within("project_max", 1, 1)
    assert log == ["a.before", "a.after:PLAN", "a.finally"]


# --- guard ----------------------------------------------------------------------------------------


class NoLock:
    domain = "none"

    def run(self, key, fn):  # type: ignore[no-untyped-def]
        return fn(None)


def _race(lock: Any) -> int:
    c = create_client(provider(), CATALOG, lock=lock)
    state = {"n": 0}
    inc = threading.Lock()
    barrier = threading.Barrier(20)

    def count(tx: Any) -> int:
        n = state["n"]
        time.sleep(0.003)
        return n

    def act(tx: Any) -> None:
        with inc:  # the act itself is atomic; only check-then-act can race
            state["n"] += 1

    def worker() -> None:
        barrier.wait()
        try:
            c.guard("project_max", 1, {"organizationId": "acme", "now": T0}, count=count, act=act)
        except EntitlementLimitExceeded:
            pass

    ts = [threading.Thread(target=worker) for _ in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return state["n"]


def test_guard_serializes_and_the_test_has_teeth() -> None:
    from openentitlement import InProcessLock

    # free plan: project_max = 1
    assert _race(InProcessLock()) == 1
    assert _race(NoLock()) > 1  # without a lock, the check-then-act race overshoots


def test_guard_releases_lock_on_error() -> None:
    c = create_client(provider(), CATALOG)
    with pytest.raises(ZeroDivisionError):
        c.guard("project_max", 1, {"organizationId": "acme"}, count=lambda tx: 0, act=lambda tx: 1 / 0)
    r = c.guard("project_max", 1, {"organizationId": "acme"}, count=lambda tx: 0, act=lambda tx: "ok")
    assert r.result == "ok" and r.details.lock_domain == "process"


def test_invalid_invocation_tenant_does_not_inherit_default():
    from openentitlement import EvaluationContext
    c = create_client(catalog=CATALOG, provider=InMemoryProvider(), context={"organization_id": "acme"})
    assert c.get_details("seat_max", {"subject_id": "alice"}).reason is not Reason.ERROR
    assert c.get_details("seat_max", EvaluationContext(subject_id="alice")).reason is not Reason.ERROR
    for organization_id in ("", None, False, 0):
        for ctx in ({"organization_id": organization_id}, EvaluationContext(organization_id=organization_id)):
            d = c.get_details("seat_max", ctx)
            assert d.reason is Reason.ERROR
            assert d.error_code is ErrorCode.INVALID_CONTEXT


def test_missing_or_null_pool_usage_is_not_assumed_zero():
    c = create_client(catalog=CATALOG, provider=InMemoryProvider(), context={"organization_id": "acme"})
    for usage in ({}, [], {"subject": 1}, {"pool": None}, {"pool": 0, "subject": None}):
        with pytest.raises(InvalidArgument):
            c.require_within("seat_max", usage, 1)
    c.require_within("seat_max", {"pool": 0}, 1)


def test_guard_resolves_once_before_count_and_checks_same_snapshot():
    order = []

    class ChangingProvider(AbstractProvider):
        limit = 1

        def resolve(self, privilege, ctx):
            order.append("resolve")
            return ResolutionDetails(privilege=privilege.key, value=self.limit, reason=Reason.PLAN)

    provider = ChangingProvider()
    c = create_client(catalog=CATALOG, provider=provider)

    def count(tx):
        order.append("count")
        provider.limit = 10
        return 0

    with pytest.raises(EntitlementLimitExceeded):
        c.guard("project_max", 2, {"organization_id": "acme"}, count=count, act=lambda tx: order.append("act"))
    assert order == ["resolve", "count"]


def test_keys_are_flat_dotted_keys_are_rejected():
    with pytest.raises(InvalidArgument, match="seat.max"):
        Catalog([feature("seats", "Seats", [integer("seat.max")])])
    assert Catalog([feature("seats", "Seats", [integer("seat_max")])]).privilege("seat_max").key == "seat_max"


@pytest.mark.parametrize("invalid", ["seat\n", "seat\nmax", " seat", "seat ", "seat.max"])
def test_identifiers_match_the_entire_string(invalid):
    with pytest.raises(InvalidArgument):
        Catalog([feature(invalid, "Seats", [integer("seat_max")])])
    with pytest.raises(InvalidArgument):
        Catalog([feature("seats", "Seats", [integer(invalid)])])
