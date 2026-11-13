"""Python SDK against the same real Node OEREP server used by the TS SDK."""
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest
from openentitlement import Catalog, RemoteProvider, Reason, UNLIMITED, create_client, EntitlementLimitExceeded
from openentitlement.remote import OerepProblem, decode_remote_details

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def remote():
    if not shutil.which("node") or not (ROOT / "console/node_modules").exists():
        pytest.skip("cross-language tests require Node >=22.18 and npm ci in console/")
    proc = subprocess.Popen(["node", "--conditions=source", "test/fixture.ts"], cwd=ROOT / "console", stdout=subprocess.PIPE, text=True)
    try:
        url = proc.stdout.readline().strip()
        assert url.startswith("http://localhost:"), "OEREP fixture failed to start"
        catalog = Catalog.from_dict(json.loads((ROOT / "spec/assets/catalog.json").read_text()))
        yield create_client(provider=RemoteProvider(url, token="eval-test", product="demo"), catalog=catalog), url, catalog
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_python_reads_own_server(remote):
    c, _, _ = remote
    assert c.get_limit("seat_max", {"organization_id": "hooli"}) == 3
    d = c.get_details("seat_max", {"organization_id": "acme"})
    assert d.reason == Reason.OVERRIDE and d.value == 250 and d.plan_value == 100
    assert c.get_limit("api_calls_monthly", {"organization_id": "acme"}) is UNLIMITED
    d = c.get_details("api_calls_monthly", {"organization_id": "globex", "subject_id": "hank"})
    assert d.reason == Reason.GRANT and d.value == 155000 and len(d.grants) == 2
    assert c.get_enum("report_retention", {"organization_id": "globex"}) == "90d"
    assert c.is_enabled("sso", {"organization_id": "acme"})
    assert not c.is_enabled("sso", {"organization_id": "hooli"})
    with pytest.raises(EntitlementLimitExceeded) as exc:
        c.require_within("project_max", 1, 1, {"organization_id": "hooli"})
    assert exc.value.required_plan == "pro"
    assert c.required_plan("report_retention", "365d", {"organization_id": "globex"}) == "business"
    d = c.get_details("project_max", {"organization_id": "umbrella", "now": datetime(2026, 11, 3, tzinfo=timezone.utc)})
    assert d.value == 50 and len(d.stale_overrides) == 1


def test_auth_and_bad_responses_fail_closed(remote):
    _, url, catalog = remote
    c = create_client(provider=RemoteProvider(url, token="bad", product="demo"), catalog=catalog)
    d = c.get_details("seat_max", {"organization_id": "acme"})
    assert d.reason == Reason.ERROR and d.required_plan is None
    p = catalog.privilege("seat_max")
    for bad in [None, {}, {"privilege": "seat_max", "value": 9, "reason": "PLAN", "grants": [{"id": "x", "amount": -1}], "staleOverrides": []}]:
        with pytest.raises((ValueError, KeyError)):
            decode_remote_details(bad, p)


def test_invalid_remote_grants_and_unlimited_never_inflate_quota():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread
    payload = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        catalog = Catalog.from_dict(json.loads((ROOT / "spec/assets/catalog.json").read_text()))
        c = create_client(catalog=catalog, provider=RemoteProvider(f"http://127.0.0.1:{server.server_port}", product="demo"))
        ctx = {"organization_id": "acme", "subject_id": "alice"}
        for grants in ([{"id": "g", "amount": 100, "subjectId": "bob"}],
                       [{"id": "g", "amount": 5}, {"id": "g", "amount": 5}]):
            payload.update(privilege="seat_max", value=10, reason="GRANT", grants=grants, staleOverrides=[])
            assert c.get_details("seat_max", ctx).reason is Reason.ERROR
            with pytest.raises(EntitlementLimitExceeded):
                c.require_within("seat_max", 0, 100, ctx)
        # A personal grant above the resolved value is consistent (the base may be negative), but it
        # still never allows more than the resolved value.
        payload.update(value=10, grants=[{"id": "g", "amount": 100, "subjectId": "alice"}])
        assert c.get_details("seat_max", ctx).value == 10
        with pytest.raises(EntitlementLimitExceeded):
            c.require_within("seat_max", 0, 11, ctx)
        payload.update(value={"unlimited": 1}, grants=[])
        assert c.get_details("seat_max", ctx).reason is Reason.ERROR
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


# -- opt-in decision cache -------------------------------------------------------------------------

class _FakeOEREP:
    """A tiny OEREP server that records requests; ``fail`` makes it return HTTP 500."""

    def __init__(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from threading import Thread
        self.requests: list[tuple[str, dict]] = []
        self.fail = False
        self.seat_value = 10
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fake.requests.append((self.path, body))
                if fake.fail:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(b'{"error":"internal","message":"down"}')
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(fake.response(self.path)).encode())

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    @staticmethod
    def details(key, value):
        return {"privilege": key, "value": value, "reason": "PLAN", "planId": "pro", "grants": [], "staleOverrides": []}

    def response(self, path):
        values = {"seat_max": self.seat_value, "project_max": 5, "api_calls_monthly": 100, "sso_enabled": True,
                  "sso_connection_max": 1, "reports_enabled": True, "report_retention": "90d"}
        if path == "/oerep/v1/products/demo/privileges/resolve":
            return {"privileges": [self.details(k, v) for k, v in values.items()]}
        if path.endswith("/upgrade"):
            return {"requiredPlan": "pro"}
        return self.details(path.split("/")[-2], values[path.split("/")[-2]])

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


@pytest.fixture
def fake():
    f = _FakeOEREP()
    try:
        yield f
    finally:
        f.close()


def _catalog():
    return Catalog.from_dict(json.loads((ROOT / "spec/assets/catalog.json").read_text()))


def _cached(fake, ttl=10.0, **kw):
    provider = RemoteProvider(fake.url, product="demo", cache_ttl=ttl, **kw)
    clock = [0.0]
    provider._monotonic = lambda: clock[0]
    return provider, create_client(provider=provider, catalog=_catalog()), clock


def test_cache_default_off_calls_server_every_time(fake):
    c = create_client(provider=RemoteProvider(fake.url, product="demo"), catalog=_catalog())
    for _ in range(3):
        assert c.get_limit("seat_max", {"organization_id": "acme"}) == 10
    assert len(fake.requests) == 3


def test_cache_hit_within_ttl_and_expiry(fake):
    provider, c, clock = _cached(fake)
    for _ in range(3):
        assert c.get_limit("seat_max", {"organization_id": "acme"}) == 10
    assert len(fake.requests) == 1
    fake.seat_value = 20
    clock[0] = 9.9
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 10  # stale within TTL
    clock[0] = 10.0
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 20
    assert len(fake.requests) == 2


def test_cache_separates_contexts_and_privileges(fake):
    _, c, _ = _cached(fake)
    ctxs = [{"organization_id": "acme"}, {"organization_id": "globex"}, {"organization_id": "acme", "subject_id": "alice"},
            {"organization_id": "acme", "resource_id": "r1"}, {"organization_id": "acme", "subject_id": "alice", "resource_id": "r1"}]
    for _ in range(2):
        for ctx in ctxs:
            c.get_limit("seat_max", ctx)
        c.get_limit("project_max", {"organization_id": "acme"})
    assert len(fake.requests) == len(ctxs) + 1


def test_explicit_now_bypasses_cache(fake):
    provider, c, _ = _cached(fake)
    past = {"organization_id": "acme", "now": datetime(2026, 11, 3, tzinfo=timezone.utc)}
    c.get_limit("seat_max", past)
    c.get_limit("seat_max", past)
    assert len(fake.requests) == 2 and not provider._cache
    assert fake.requests[0][1]["context"]["now"].startswith("2026-11-03")


def test_caller_supplied_now_is_explicit_even_when_current(fake):
    provider, c, _ = _cached(fake)
    nowish = {"organization_id": "acme", "now": datetime.now(timezone.utc)}
    c.get_limit("seat_max", nowish)
    c.get_limit("seat_max", nowish)
    assert len(fake.requests) == 2 and not provider._cache


def test_cache_works_with_a_client_clock_that_is_not_wall_time(fake):
    provider = RemoteProvider(fake.url, cache_ttl=10.0, product="demo")
    provider._monotonic = lambda: 0.0
    c = create_client(provider=provider, catalog=_catalog(), clock=lambda: datetime(2020, 1, 1, tzinfo=timezone.utc))
    c.get_limit("seat_max", {"organization_id": "acme"})
    c.get_limit("seat_max", {"organization_id": "acme"})
    assert len(fake.requests) == 1


def test_errors_and_error_reasons_are_not_cached(fake):
    provider, c, _ = _cached(fake)
    fake.fail = True
    assert c.get_details("seat_max", {"organization_id": "acme"}).reason is Reason.ERROR
    assert c.get_details("seat_max", {"organization_id": "acme"}).reason is Reason.ERROR
    assert len(fake.requests) == 2 and not provider._cache
    fake.fail = False
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 10
    p = _catalog().privilege("seat_max")
    from openentitlement.details import ErrorCode, EvaluationContext, ResolutionDetails
    provider._cache_put([(("seat_max", "x", None, None), ResolutionDetails(
        privilege="seat_max", value=1, reason=Reason.ERROR, error_code=ErrorCode.GENERAL))])
    assert provider.resolve(p, EvaluationContext(organization_id="x")).reason is Reason.PLAN


def test_invalid_responses_are_not_cached(fake):
    provider, c, _ = _cached(fake)
    fake.seat_value = "not-an-int"
    assert c.get_details("seat_max", {"organization_id": "acme"}).reason is Reason.ERROR
    assert not provider._cache


def test_bulk_fills_single_entries(fake):
    from openentitlement.details import EvaluationContext
    provider, c, _ = _cached(fake)
    catalog = _catalog()
    out = provider.resolve_all(catalog.privileges, EvaluationContext(organization_id="acme"))
    assert set(out) == {p.key for p in catalog.privileges} and out["seat_max"].value == 10
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 10
    assert c.get_enum("report_retention", {"organization_id": "acme"}) == "90d"
    assert c.is_enabled("sso", {"organization_id": "acme"})
    assert [path for path, _ in fake.requests] == ["/oerep/v1/products/demo/privileges/resolve"]
    c.get_limit("seat_max", {"organization_id": "globex"})
    assert len(fake.requests) == 2


def test_bulk_without_cache_and_invalid_bulk(fake):
    from openentitlement.details import EvaluationContext
    provider = RemoteProvider(fake.url, product="demo")
    assert provider.resolve_all(_catalog().privileges, EvaluationContext(organization_id="acme"))["project_max"].value == 5
    fake.seat_value = 1.5  # not an integer
    cached = RemoteProvider(fake.url, cache_ttl=10, product="demo")
    with pytest.raises(ValueError):
        cached.resolve_all(_catalog().privileges, EvaluationContext(organization_id="acme"))
    assert not cached._cache


def test_lru_eviction_and_clear_cache(fake):
    provider, c, _ = _cached(fake, cache_max_entries=2)
    for org in ("a", "b"):
        c.get_limit("seat_max", {"organization_id": org})
    c.get_limit("seat_max", {"organization_id": "a"})  # a is now most recently used
    c.get_limit("seat_max", {"organization_id": "c"})  # evicts b
    assert len(fake.requests) == 3 and len(provider._cache) == 2
    c.get_limit("seat_max", {"organization_id": "a"})
    assert len(fake.requests) == 3
    c.get_limit("seat_max", {"organization_id": "b"})
    assert len(fake.requests) == 4
    provider.clear_cache()
    c.get_limit("seat_max", {"organization_id": "a"})
    assert len(fake.requests) == 5


def test_suggestions_are_not_cached(fake):
    _, c, _ = _cached(fake)
    for _ in range(2):
        assert c.required_plan("report_retention", "365d", {"organization_id": "acme"}) == "pro"
    assert sum(path.endswith("/upgrade") for path, _ in fake.requests) == 2


@pytest.mark.parametrize("kw", [{"cache_ttl": 0}, {"cache_ttl": -1}, {"cache_ttl": float("inf")}, {"cache_ttl": float("nan")},
                                {"cache_ttl": True}, {"cache_ttl": "5"}, {"cache_max_entries": 0},
                                {"cache_max_entries": 1.5}, {"cache_max_entries": True}, {"cache_max_entries": -3}])
def test_invalid_cache_options_rejected(kw):
    with pytest.raises(ValueError):
        RemoteProvider("http://localhost:1", **kw, product="demo")


def test_cache_is_thread_safe(fake):
    from concurrent.futures import ThreadPoolExecutor
    provider, c, _ = _cached(fake, cache_max_entries=5)
    with ThreadPoolExecutor(8) as pool:
        values = list(pool.map(lambda i: c.get_limit("seat_max", {"organization_id": f"o{i % 10}"}), range(200)))
    assert values == [10] * 200 and len(provider._cache) <= 5


def test_check_and_act_paths_always_fetch_and_refresh(fake):
    _, c, _ = _cached(fake)
    ctx = {"organization_id": "acme"}
    assert c.get_limit("seat_max", ctx) == 10 and len(fake.requests) == 1
    fake.seat_value = 3  # an administrator lowered the limit; the cached entry is still fresh
    assert c.get_limit("seat_max", ctx) == 10 and len(fake.requests) == 1
    with pytest.raises(EntitlementLimitExceeded):
        c.require_within("seat_max", 3, 1, ctx)
    assert len(fake.requests) >= 2
    n = len(fake.requests)
    with pytest.raises(EntitlementLimitExceeded):
        c.guard("seat_max", 1, ctx, count=lambda tx: 3, act=lambda tx: "created")
    assert [p for p, _ in fake.requests[n:]][0] == "/oerep/v1/products/demo/privileges/seat_max/resolve"
    n = len(fake.requests)
    assert c.guard("seat_max", 1, ctx, count=lambda tx: 2, act=lambda tx: "ok").result == "ok"
    assert len(fake.requests) == n + 1
    assert c.get_limit("seat_max", ctx) == 3 and len(fake.requests) == n + 1  # fresh fetch refreshed the entry
    n = len(fake.requests)
    c.is_enabled("sso", ctx)
    c.is_enabled("sso", ctx)
    assert len(fake.requests) == n + 1
    c.require_enabled("sso", ctx)
    assert len(fake.requests) == n + 2


def test_non_caching_providers_keep_two_argument_resolve():
    from openentitlement import InMemoryProvider
    c = create_client(provider=InMemoryProvider(), catalog=_catalog())
    assert c.guard("project_max", 0, {"organization_id": "x"}, count=lambda tx: 0, act=lambda tx: 1).result == 1


def test_direct_provider_time_provenance_neither_reads_nor_poisons(fake):
    from openentitlement.details import EvaluationContext
    provider, c, _ = _cached(fake)
    p = _catalog().privilege("seat_max")
    past = EvaluationContext(organization_id="acme", now=datetime(2020, 1, 1, tzinfo=timezone.utc))
    assert provider.resolve(p, past).value == 10
    fake.seat_value = 20
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 20
    fake.seat_value = 30
    assert provider.resolve(p, past).value == 30
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 20
    assert len(fake.requests) == 3
    assert provider.resolve(p, past, fresh=True, explicit_time=False).value == 30
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 30
    assert len(fake.requests) == 4


@pytest.mark.parametrize("explicit", [False, True])
def test_guard_preserves_time_provenance_and_refreshes_reads(fake, explicit):
    _, c, _ = _cached(fake)
    ordinary = {"organization_id": "acme"}
    ctx = {**ordinary, "now": datetime(2020, 1, 1, tzinfo=timezone.utc)} if explicit else ordinary
    assert c.get_limit("seat_max", ordinary) == 10
    fake.seat_value = 20
    assert c.guard("seat_max", 1, ctx, count=lambda tx: 0, act=lambda tx: "ok").details.value == 20
    assert c.get_limit("seat_max", ordinary) == (10 if explicit else 20)
    assert len(fake.requests) == 2


@pytest.mark.parametrize("bulk", [False, True])
@pytest.mark.parametrize("failure", ["transport", "invalid", "error"])
def test_failed_refresh_evicts_previous_success(fake, monkeypatch, bulk, failure):
    from openentitlement.details import EvaluationContext
    provider, c, _ = _cached(fake)
    ctx = {"organization_id": "acme"}
    c.get_limit("seat_max", ctx)
    c.get_limit("project_max", ctx)
    response = fake.response
    if failure == "transport":
        fake.fail = True
    elif failure == "invalid":
        fake.seat_value = "invalid"
    else:
        def error_response(path):
            data = response(path)
            for entry in data.get("privileges", [data]):
                if entry["privilege"] == "seat_max":
                    entry.update(reason="ERROR", errorCode="GENERAL")
            return data
        monkeypatch.setattr(fake, "response", error_response)
    if bulk:
        if failure == "error":
            assert provider.resolve_all(_catalog().privileges, EvaluationContext(organization_id="acme"))["seat_max"].reason is Reason.ERROR
        else:
            with pytest.raises(ValueError if failure == "invalid" else OerepProblem):
                provider.resolve_all(_catalog().privileges, EvaluationContext(organization_id="acme"))
    else:
        with pytest.raises(EntitlementLimitExceeded):
            c.require_within("seat_max", 0, 100, ctx)
    fake.fail = False
    fake.seat_value = 30
    monkeypatch.setattr(fake, "response", response)
    n = len(fake.requests)
    assert c.get_limit("seat_max", ctx) == 30
    assert len(fake.requests) == n + 1
    n = len(fake.requests)
    assert c.get_limit("project_max", ctx) == 5
    assert len(fake.requests) == n + (1 if bulk and failure != "error" else 0)


def test_transport_identity_is_read_only(fake):
    provider, c, _ = _cached(fake, token="authority-a")
    c.get_limit("seat_max", {"organization_id": "acme"})
    with pytest.raises(AttributeError):
        provider.base_url = "http://other.test"
    with pytest.raises(AttributeError):
        provider.token = "authority-b"
    assert provider.base_url == fake.url and provider.token == "authority-a"
    fake.seat_value = 20
    c.require_within("seat_max", 0, 1, {"organization_id": "acme"})
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 20
    assert len(fake.requests) == 2


def test_historical_bulk_neither_seeds_nor_evicts_current_cache(fake):
    from openentitlement.details import EvaluationContext
    provider, c, _ = _cached(fake)
    past = EvaluationContext(organization_id="acme", now=datetime(2020, 1, 1, tzinfo=timezone.utc))
    provider.resolve_all(_catalog().privileges, past)
    fake.seat_value = 20
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 20
    fake.seat_value = 30
    assert provider.resolve_all(_catalog().privileges, past)["seat_max"].value == 30
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 20
    fake.fail = True
    with pytest.raises(OerepProblem):
        provider.resolve_all(_catalog().privileges, past)
    assert c.get_limit("seat_max", {"organization_id": "acme"}) == 20
    assert len(fake.requests) == 4


# -- negative integer values -----------------------------------------------------------------------

def _offset():
    from openentitlement import Catalog, feature, integer
    return Catalog([feature("climate", "Climate", [integer("temperature_offset", default=0)])]).privilege("temperature_offset")


def _details(value, grants=()):
    return decode_remote_details({"privilege": "temperature_offset", "value": value, "reason": "PLAN",
                                  "grants": list(grants), "staleOverrides": []}, _offset(), None)


def test_negative_remote_values_decode_with_and_without_grants():
    assert _details(-5).value == -5
    assert _details(5, [{"id": "g", "amount": 10}]).value == 5  # base -5 plus a grant of 10
    assert _details(-(2**53 - 1)).value == -(2**53 - 1)
    with pytest.raises(ValueError):
        _details(-(2**53))
    with pytest.raises(ValueError):
        decode_remote_details({"privilege": "temperature_offset", "value": 5, "reason": "PLAN", "grants": [],
                               "staleOverrides": [], "planValue": -(2**53)}, _offset(), None)


def test_python_runtime_validation_matches_the_safe_integer_range():
    p = _offset()
    assert p.validate_value(-(2**53 - 1)) is None and p.validate_value(2**53 - 1) is None
    assert p.validate_value(-(2**53)) and p.validate_value(2**53)


def test_personal_grants_never_allow_more_than_the_resolved_value():
    from openentitlement.details import GrantApplied, ResolutionDetails
    from openentitlement.resolver import check_within
    d = ResolutionDetails(privilege="temperature_offset", value=10, reason=Reason.GRANT,
                          grants=(GrantApplied(id="g", amount=100, subject_id="alice"),))  # base -90
    assert check_within(d, 0, 10).passed and not check_within(d, 0, 11).passed
