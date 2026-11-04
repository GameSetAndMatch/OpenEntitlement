"""Python SDK against the same real Node OEREP server used by the TS SDK."""
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest
from openentitlement import Catalog, RemoteProvider, Reason, UNLIMITED, create_client, EntitlementLimitExceeded
from openentitlement.remote import decode_remote_details

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
        yield create_client(provider=RemoteProvider(url, token="eval-test"), catalog=catalog), url, catalog
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_python_reads_own_server(remote):
    c, _, _ = remote
    assert c.get_limit("seats.max", {"organization_id": "hooli"}) == 3
    d = c.get_details("seats.max", {"organization_id": "acme"})
    assert d.reason == Reason.OVERRIDE and d.value == 250 and d.plan_value == 100
    assert c.get_limit("api_calls.monthly", {"organization_id": "acme"}) is UNLIMITED
    d = c.get_details("api_calls.monthly", {"organization_id": "globex", "subject_id": "hank"})
    assert d.reason == Reason.GRANT and d.value == 155000 and len(d.grants) == 2
    assert c.get_enum("reports.retention", {"organization_id": "globex"}) == "90d"
    assert c.is_enabled("sso", {"organization_id": "acme"})
    assert not c.is_enabled("sso", {"organization_id": "hooli"})
    with pytest.raises(EntitlementLimitExceeded) as exc:
        c.require_within("projects.max", 1, 1, {"organization_id": "hooli"})
    assert exc.value.required_plan == "pro"
    assert c.required_plan("reports.retention", "365d", {"organization_id": "globex"}) == "business"
    d = c.get_details("projects.max", {"organization_id": "umbrella", "now": datetime(2026, 11, 3, tzinfo=timezone.utc)})
    assert d.value == 50 and len(d.stale_overrides) == 1


def test_auth_and_bad_responses_fail_closed(remote):
    _, url, catalog = remote
    c = create_client(provider=RemoteProvider(url, token="bad"), catalog=catalog)
    d = c.get_details("seats.max", {"organization_id": "acme"})
    assert d.reason == Reason.ERROR and d.required_plan is None
    p = catalog.privilege("seats.max")
    for bad in [None, {}, {"privilege": "seats.max", "value": 9, "reason": "PLAN", "grants": [{"id": "x", "amount": -1}], "staleOverrides": []}]:
        with pytest.raises((ValueError, KeyError)):
            decode_remote_details(bad, p)
