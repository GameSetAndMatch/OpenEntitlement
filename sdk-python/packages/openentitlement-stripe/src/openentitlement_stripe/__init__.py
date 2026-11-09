"""Stripe Entitlements adapter for OpenEntitlement.

Stripe models entitlements as *boolean* features (``lookup_key``) attached to products; a customer's
active entitlements derive from their subscriptions. This adapter maps them onto OpenEntitlement:

* ``lookup_key == "<privilege>"``                → boolean privilege is ``true``
* ``lookup_key == "<privilege>:<value>"``        → integer (``50``, ``unlimited``), boolean or enum value
* ``mapping={"pro-bundle": {"seat_max": 50}}``  → explicit mapping, for lookup keys you can't rename

Several active entitlements for one privilege resolve to the most generous value. Stripe cannot say
"false": a boolean privilege missing from a customer who *has* active entitlements resolves to ``false``
with reason ``PLAN`` (the product doesn't include it). Missing integer/enum privileges, and customers
with no active entitlements at all, resolve to the privilege default (reason ``DEFAULT``). Everything Stripe has no concept of
(overrides, grants, plan catalog, mutations) is declared unsupported; layer it in your own store.

No dependency on the Stripe SDK: two REST calls and HMAC webhook verification from the stdlib.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Mapping, Optional, Sequence

from openentitlement import (
    UNLIMITED,
    AbstractProvider,
    Capabilities,
    EvaluationContext,
    PrivilegeDefinition,
    ProviderMetadata,
    Reason,
    ResolutionDetails,
    ValueType,
    is_unlimited,
)

__all__ = ["StripeEntitlementsProvider", "StripeError", "verify_webhook", "parse_lookup_key"]
__version__ = "0.1.0"

log = logging.getLogger("openentitlement.stripe")

Transport = Callable[[str, Mapping[str, str]], "tuple[int, bytes]"]
SUMMARY_EVENT = "entitlements.active_entitlement_summary.updated"


class StripeError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"Stripe API returned {status}: {body[:200]}")
        self.status = status


def _urllib_transport(url: str, headers: Mapping[str, str]) -> "tuple[int, bytes]":
    req = urllib.request.Request(url, headers=dict(headers), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 - https only, fixed host
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def parse_lookup_key(lookup_key: str) -> "tuple[str, Optional[str]]":
    """``"seat_max:50"`` → ``("seat_max", "50")``; ``"sso_enabled"`` → ``("sso_enabled", None)``."""
    key, sep, raw = lookup_key.partition(":")
    return key, (raw if sep else None)


def _coerce(priv: PrivilegeDefinition, raw: Optional[str]) -> Any:
    """Turn the ``:<value>`` suffix into a typed value, or raise ValueError."""
    if priv.value_type is ValueType.BOOLEAN:
        if raw is None or raw == "true":
            return True
        if raw == "false":
            return False
    elif priv.value_type is ValueType.INTEGER and raw is not None:
        if raw == "unlimited" and priv.unlimited_allowed:
            return UNLIMITED
        if raw.isdigit():
            return int(raw)
    elif priv.value_type is ValueType.ENUM and raw in priv.options:
        return raw
    raise ValueError(f"cannot map {raw!r} onto {priv.value_type.value} privilege {priv.key}")


def _more_generous(priv: PrivilegeDefinition, a: Any, b: Any) -> Any:
    if priv.value_type is ValueType.BOOLEAN:
        return a or b
    if priv.value_type is ValueType.INTEGER:
        if is_unlimited(a) or is_unlimited(b):
            return UNLIMITED
        return max(a, b)
    return a if priv.options.index(a) >= priv.options.index(b) else b


class StripeEntitlementsProvider(AbstractProvider):
    metadata = ProviderMetadata("stripe-entitlements")
    capabilities = Capabilities()  # boolean plan facts only; see module docstring

    def __init__(
        self,
        api_key: str,
        *,
        customer_for: Callable[[str], Optional[str]],
        mapping: Optional[Mapping[str, Mapping[str, Any]]] = None,
        cache_ttl: float = 60.0,
        transport: Optional[Transport] = None,
        api_base: str = "https://api.stripe.com",
        monotonic: Callable[[], float] = time.monotonic,
    ):
        """
        :param customer_for: maps an ``organizationId`` to a Stripe customer id (``cus_...``), or None.
        :param mapping: explicit ``lookup_key -> {privilege: value}`` mapping; wins over the naming convention.
        :param cache_ttl: seconds to cache a customer's active entitlements (Stripe recommends persisting
            them); webhooks passed to :meth:`handle_event` refresh the cache immediately.
        """
        if not api_key:
            raise ValueError("api_key is required")
        self._api_key = api_key
        self._customer_for = customer_for
        self._mapping = {k: dict(v) for k, v in (mapping or {}).items()}
        self._ttl = cache_ttl
        self._transport = transport or _urllib_transport
        self._base = api_base.rstrip("/")
        self._monotonic = monotonic
        self._cache: dict[str, tuple[float, tuple[str, ...]]] = {}
        self._lock = threading.Lock()

    # -- Stripe API -------------------------------------------------------------------------------

    def _get(self, path: str, params: Mapping[str, str]) -> dict[str, Any]:
        url = f"{self._base}{path}?{urllib.parse.urlencode(params)}"
        status, body = self._transport(url, {"Authorization": f"Bearer {self._api_key}"})
        if status != 200:
            raise StripeError(status, body.decode("utf-8", "replace"))
        return json.loads(body)

    def active_lookup_keys(self, customer_id: str) -> tuple[str, ...]:
        """All active entitlement lookup keys for a customer (paginated, cached)."""
        now = self._monotonic()
        with self._lock:
            hit = self._cache.get(customer_id)
            if hit and hit[0] > now:
                return hit[1]
        keys: list[str] = []
        params = {"customer": customer_id, "limit": "100"}
        while True:
            page = self._get("/v1/entitlements/active_entitlements", params)
            data = page.get("data", [])
            keys.extend(e["lookup_key"] for e in data if e.get("lookup_key"))
            if not page.get("has_more") or not data:
                break
            params = {**params, "starting_after": data[-1]["id"]}
        result = tuple(sorted(set(keys)))
        with self._lock:
            self._cache[customer_id] = (now + self._ttl, result)
        return result

    def handle_event(self, event: Mapping[str, Any]) -> None:
        """Feed verified webhook events here to keep the cache fresh (see :func:`verify_webhook`)."""
        if event.get("type") != SUMMARY_EVENT:
            return
        obj = event.get("data", {}).get("object", {})
        customer = obj.get("customer")
        if not customer:
            return
        ents = obj.get("entitlements", {})
        with self._lock:
            if ents.get("has_more"):
                # the summary holds at most 10 entitlements; refetch the full list on next resolve
                self._cache.pop(customer, None)
            else:
                keys = tuple(sorted({e["lookup_key"] for e in ents.get("data", []) if e.get("lookup_key")}))
                self._cache[customer] = (self._monotonic() + self._ttl, keys)

    # -- Provider ---------------------------------------------------------------------------------

    def values_from_lookup_keys(self, keys: Sequence[str], privilege: PrivilegeDefinition) -> list[Any]:
        found: list[Any] = []
        for lk in keys:
            if lk in self._mapping:
                if privilege.key in self._mapping[lk]:
                    v = self._mapping[lk][privilege.key]
                    if privilege.validate_value(v) is None:
                        found.append(v)
                    else:
                        log.warning("mapping %s -> %s=%r is invalid; ignored", lk, privilege.key, v)
                continue
            key, raw = parse_lookup_key(lk)
            if key != privilege.key:
                continue
            try:
                found.append(_coerce(privilege, raw))
            except ValueError as e:
                log.warning("lookup_key %r ignored: %s", lk, e)
        return found

    def resolve(self, privilege: PrivilegeDefinition, ctx: EvaluationContext) -> ResolutionDetails[Any]:
        customer = self._customer_for(ctx.organization_id)
        if not customer:
            return ResolutionDetails(privilege=privilege.key, value=privilege.default, reason=Reason.DEFAULT)
        keys = self.active_lookup_keys(customer)
        values = self.values_from_lookup_keys(keys, privilege)
        if not values:
            if keys and privilege.value_type is ValueType.BOOLEAN:
                return ResolutionDetails(
                    privilege=privilege.key, value=False, reason=Reason.PLAN, plan_value=False, has_plan_value=True
                )
            return ResolutionDetails(privilege=privilege.key, value=privilege.default, reason=Reason.DEFAULT)
        value = values[0]
        for v in values[1:]:
            value = _more_generous(privilege, value, v)
        return ResolutionDetails(
            privilege=privilege.key, value=value, reason=Reason.PLAN, plan_value=value, has_plan_value=True
        )


def verify_webhook(payload: bytes, signature_header: str, secret: str, *, tolerance: int = 300,
                   now: Optional[float] = None) -> dict[str, Any]:
    """Verify a ``Stripe-Signature`` header (v1 scheme) and return the parsed event.

    Raises ``ValueError`` when the signature is missing, wrong, or outside ``tolerance`` seconds.
    """
    parts: dict[str, list[str]] = {}
    for item in signature_header.split(","):
        k, _, v = item.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        ts = int(parts["t"][0])
    except (KeyError, ValueError) as e:
        raise ValueError("missing timestamp in Stripe-Signature") from e
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, s) for s in parts.get("v1", [])):
        raise ValueError("no valid v1 signature")
    current = time.time() if now is None else now
    if tolerance and abs(current - ts) > tolerance:
        raise ValueError("signature timestamp outside tolerance")
    event = json.loads(payload)
    if not isinstance(event, dict):
        raise ValueError("payload is not a JSON object")
    return event

