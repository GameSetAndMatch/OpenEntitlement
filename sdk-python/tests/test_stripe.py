from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import pytest

from openentitlement import UNLIMITED, Catalog, Reason, boolean, create_client, enum, feature, integer
from openentitlement_stripe import StripeEntitlementsProvider, parse_lookup_key, verify_webhook

CATALOG = Catalog(
    [
        feature("seats", "Seats", [integer("seat_max", default=1, unlimited_allowed=True)]),
        feature("sso", "SSO", [boolean("sso_enabled")]),
        feature("support", "Support", [boolean("support.enabled"), enum("support.tier", ["community", "priority"])], gate="support.enabled"),
    ]
)


class SequenceTransport:
    """One complete (unpaginated) response per call."""

    def __init__(self, responses: list[list[str]]):
        self.responses, self.calls = responses, []

    def __call__(self, url: str, headers: Any) -> tuple[int, bytes]:
        keys = self.responses[len(self.calls)]
        self.calls.append(url)
        return 200, json.dumps({"data": [{"id": f"e{i}", "lookup_key": k} for i, k in enumerate(keys)], "has_more": False}).encode()


class FakeTransport:
    def __init__(self, pages: list[list[str]], status: int = 200):
        self.pages, self.status, self.calls = pages, status, []

    def __call__(self, url: str, headers: Any) -> tuple[int, bytes]:
        self.calls.append(url)
        if self.status != 200:
            return self.status, b'{"error": {"message": "nope"}}'
        i = len(self.calls) - 1
        data = [{"id": f"ent_{i}_{j}", "lookup_key": k} for j, k in enumerate(self.pages[i])]
        return 200, json.dumps({"data": data, "has_more": i < len(self.pages) - 1}).encode()


def client(transport: Any, **kw: Any):  # type: ignore[no-untyped-def]
    p = StripeEntitlementsProvider("sk_test", customer_for=lambda org: "cus_1" if org == "acme" else None, transport=transport, **kw)
    return p, create_client(p, CATALOG, context={"organizationId": "acme"})


def test_lookup_key_convention() -> None:
    assert parse_lookup_key("seat_max:50") == ("seat_max", "50")
    assert parse_lookup_key("sso_enabled") == ("sso_enabled", None)


def test_paginates_and_picks_most_generous() -> None:
    t = FakeTransport([["seat_max:10", "sso_enabled"], ["seat_max:50", "support.tier:priority"]])
    _, c = client(t)
    assert c.get_limit("seat_max") == 50
    assert "starting_after=ent_0_1" in t.calls[1]
    assert c.is_enabled("sso") and c.get_enum("support.tier") == "priority"
    assert c.is_enabled_details("support").reason is Reason.PLAN and not c.is_enabled("support")  # absent boolean
    assert len(t.calls) == 2  # cached


def test_unlimited_and_mapping_precedence() -> None:
    _, c = client(FakeTransport([["seat_max:unlimited"]]))
    assert c.get_limit("seat_max") is UNLIMITED
    _, c = client(FakeTransport([["pro-bundle"]]), mapping={"pro-bundle": {"seat_max": 25, "sso_enabled": True}})
    assert c.get_limit("seat_max") == 25 and c.is_enabled("sso")


def test_invalid_keys_are_ignored_and_unknown_customers_default() -> None:
    _, c = client(FakeTransport([["seat_max:lots"]]))
    assert c.get_limit_details("seat_max").reason is Reason.DEFAULT
    assert c.get_limit_details("seat_max", {"organizationId": "other"}).reason is Reason.DEFAULT


def test_api_errors_become_error_reason() -> None:
    _, c = client(FakeTransport([], status=401))
    d = c.get_limit_details("seat_max")
    assert d.reason is Reason.ERROR and d.value == 1


def test_webhook_refreshes_cache_and_invalidates_when_truncated() -> None:
    t = SequenceTransport([["seat_max:10"], ["seat_max:99"]])
    p, c = client(t, cache_ttl=3600)
    assert c.get_limit("seat_max") == 10
    p.handle_event({"type": "entitlements.active_entitlement_summary.updated",
                    "data": {"object": {"customer": "cus_1", "entitlements": {"data": [{"lookup_key": "seat_max:20"}], "has_more": False}}}})
    assert c.get_limit("seat_max") == 20 and len(t.calls) == 1
    p.handle_event({"type": "entitlements.active_entitlement_summary.updated",
                    "data": {"object": {"customer": "cus_1", "entitlements": {"data": [], "has_more": True}}}})
    assert c.get_limit("seat_max") == 99 and len(t.calls) == 2


def _sign(payload: bytes, secret: str, ts: int) -> str:
    return f"t={ts},v1=" + hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()


def test_verify_webhook() -> None:
    payload = b'{"type": "x"}'
    assert verify_webhook(payload, _sign(payload, "whsec", 1000), "whsec", now=1010) == {"type": "x"}
    with pytest.raises(ValueError):
        verify_webhook(payload, _sign(payload, "other", 1000), "whsec", now=1010)
    with pytest.raises(ValueError):
        verify_webhook(payload, _sign(payload, "whsec", 1000), "whsec", now=5000)
    with pytest.raises(ValueError):
        verify_webhook(payload, "v1=abc", "whsec")
