"""Generic OEREP v1 provider using the Python standard library."""
from __future__ import annotations

import json
import math
import threading
import time
from collections import OrderedDict
from typing import Any, Iterable, Optional
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .catalog import PrivilegeDefinition, ValueType
from .details import ErrorCode, EvaluationContext, GrantApplied, Reason, ResolutionDetails
from .provider import AbstractProvider, Capabilities, ProviderMetadata
from .resolver import Need
from .values import decode_value, is_int, is_unlimited


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def decode_remote_details(raw: Any, p: PrivilegeDefinition, ctx: Optional[EvaluationContext] = None) -> ResolutionDetails[Any]:
    """Validate untrusted wire details before quota arithmetic."""
    if not isinstance(raw, dict) or raw.get("privilege") != p.key:
        raise ValueError("invalid OEREP details")
    reason = Reason(raw["reason"])
    value = decode_value(raw["value"])
    if p.validate_value(value) or (is_int(value) and value > 9007199254740991):
        raise ValueError("OEREP value does not match local catalog")
    grants, stale = raw.get("grants"), raw.get("staleOverrides")
    if not isinstance(grants, list) or not isinstance(stale, list) or any(not isinstance(v, str) for v in stale):
        raise ValueError("invalid OEREP metadata")
    decoded = []
    for g in grants:
        if (not isinstance(g, dict) or not isinstance(g.get("id"), str)
                or not is_int(g.get("amount")) or not 0 < g["amount"] <= 9007199254740991
                or ("subjectId" in g and (not isinstance(g["subjectId"], str) or not g["subjectId"]))):
            raise ValueError("invalid OEREP grant")
        decoded.append(GrantApplied(id=g["id"], amount=g["amount"], subject_id=g.get("subjectId")))
    total = sum(g.amount for g in decoded)
    if ((decoded and p.value_type is not ValueType.INTEGER)
            or len({g.id for g in decoded}) != len(decoded) or total > 9007199254740991
            or any(g.subject_id is not None and g.subject_id != (ctx.subject_id if ctx else None) for g in decoded)
            or (p.value_type is ValueType.INTEGER and not is_unlimited(value) and total > value)):
        raise ValueError("inconsistent OEREP grants")
    for key in ("feature", "planId", "overrideId", "requiredPlan", "errorMessage"):
        if key in raw and not isinstance(raw[key], str):
            raise ValueError("invalid OEREP metadata")
    code = ErrorCode(raw["errorCode"]) if "errorCode" in raw else None
    if reason == Reason.ERROR and (code is None or "requiredPlan" in raw):
        raise ValueError("invalid OEREP error")
    plan_value = decode_value(raw["planValue"]) if "planValue" in raw else None
    if "planValue" in raw and (p.validate_value(plan_value) or (is_int(plan_value) and plan_value > 9007199254740991)):
        raise ValueError("invalid OEREP planValue")
    return ResolutionDetails(
        privilege=p.key, value=value, reason=reason, grants=tuple(decoded), stale_overrides=tuple(stale),
        feature=raw.get("feature"), plan_id=raw.get("planId"), plan_value=plan_value,
        has_plan_value="planValue" in raw, override_id=raw.get("overrideId"),
        required_plan=raw.get("requiredPlan"), error_code=code, error_message=raw.get("errorMessage"),
    )


class RemoteProvider(AbstractProvider):
    """Connect to an OEREP server. Timeout and ``cache_ttl`` are in seconds.

    Decisions are not cached unless ``cache_ttl`` is set. With a TTL, successful validated resolutions
    are kept per privilege and context (organization, subject, resource) for at most ``cache_ttl``
    seconds, bounded to ``cache_max_entries`` with least-recently-used eviction. Cached values can be
    up to ``cache_ttl`` stale: administrative changes take up to that long to be visible. Errors and
    requests with an explicit evaluation time are never cached; upgrade suggestions are never cached.
    Check-and-act paths (``guard``, ``require_within``, ``require_enabled``) always fetch the current
    value with ``fresh=True``, which bypasses and refreshes the cache.
    """
    metadata = ProviderMetadata(name="oerep")
    #: The client passes ``fresh=True`` to ``resolve`` on check-and-act paths.
    supports_fresh = True
    capabilities = Capabilities(overrides=True, grants=True, plan_catalog=True)

    def __init__(self, base_url: str, *, token: Optional[str] = None, timeout: float = 5.0,
                 cache_ttl: Optional[float] = None, cache_max_entries: int = 10_000):
        url = urlsplit(base_url)
        if url.scheme not in ("http", "https") or not url.netloc or url.query or url.fragment or url.username or url.password:
            raise ValueError("base_url must be an HTTP(S) URL without credentials, query or fragment")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be positive")
        if cache_ttl is not None and (isinstance(cache_ttl, bool) or not isinstance(cache_ttl, (int, float))
                                      or not math.isfinite(cache_ttl) or cache_ttl <= 0):
            raise ValueError("cache_ttl must be a positive finite number of seconds or None")
        if isinstance(cache_max_entries, bool) or not isinstance(cache_max_entries, int) or cache_max_entries <= 0:
            raise ValueError("cache_max_entries must be a positive integer")
        self._base_url, self._token, self.timeout = base_url.rstrip("/"), token, timeout
        self.cache_ttl, self.cache_max_entries = cache_ttl, cache_max_entries
        self._opener = build_opener(_NoRedirect())
        self._cache: OrderedDict[tuple[Optional[str], ...], tuple[float, ResolutionDetails[Any]]] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._monotonic = time.monotonic

    @property
    def base_url(self) -> str:
        """Transport authority is fixed for this provider's lifetime."""
        return self._base_url

    @property
    def token(self) -> Optional[str]:
        return self._token

    def clear_cache(self) -> None:
        """Drop every cached resolution."""
        with self._cache_lock:
            self._cache.clear()

    def shutdown(self) -> None:
        self.clear_cache()

    def _cache_key(self, key: str, ctx: EvaluationContext) -> Optional[tuple[Optional[str], ...]]:
        """The entry key, or None when this request must bypass the cache."""
        if self.cache_ttl is None:
            return None
        return (key, ctx.organization_id, ctx.subject_id, ctx.resource_id)

    def _cache_get(self, ck: tuple[Optional[str], ...]) -> Optional[ResolutionDetails[Any]]:
        with self._cache_lock:
            entry = self._cache.get(ck)
            if entry is None:
                return None
            if self._monotonic() >= entry[0]:
                del self._cache[ck]
                return None
            self._cache.move_to_end(ck)
            return entry[1]

    def _cache_put(self, items: list[tuple[tuple[Optional[str], ...], ResolutionDetails[Any]]]) -> None:
        assert self.cache_ttl is not None
        expires = self._monotonic() + self.cache_ttl
        with self._cache_lock:
            for ck, d in items:
                if d.reason is Reason.ERROR:
                    continue
                self._cache[ck] = (expires, d)
                self._cache.move_to_end(ck)
            while len(self._cache) > self.cache_max_entries:
                self._cache.popitem(last=False)

    def _post(self, path: str, ctx: EvaluationContext, **extra: Any) -> Any:
        context: dict[str, Any] = {"organizationId": ctx.organization_id}
        if ctx.subject_id is not None:
            context["subjectId"] = ctx.subject_id
        if ctx.resource_id is not None:
            context["resourceId"] = ctx.resource_id
        if ctx.now is not None:
            if ctx.now.tzinfo is None:
                raise ValueError("now must be timezone-aware")
            context["now"] = ctx.now.isoformat()
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = Request(f"{self.base_url}/oerep/v1/{path}",
                      data=json.dumps({"context": context, **extra}).encode(), headers=headers, method="POST")
        with self._opener.open(req, timeout=self.timeout) as response:
            return json.load(response)

    def resolve(
        self, privilege: PrivilegeDefinition, ctx: EvaluationContext, *, fresh: bool = False, explicit_time: Optional[bool] = None
    ) -> ResolutionDetails[Any]:
        """``fresh=True`` skips a cached entry and refreshes it with the server's current value.
        A supplied ``now`` bypasses the cache unless ``explicit_time=False`` identifies SDK-generated time."""
        if explicit_time is None:
            explicit_time = ctx.now is not None
        ck = None if explicit_time else self._cache_key(privilege.key, ctx)
        if ck is not None and not fresh and (hit := self._cache_get(ck)) is not None:
            return hit
        if ck is not None:
            with self._cache_lock:
                self._cache.pop(ck, None)
        d = decode_remote_details(self._post(f"resolve/{quote(privilege.key, safe='')}", ctx), privilege, ctx)
        if ck is not None:
            self._cache_put([(ck, d)])
        return d

    def resolve_all(self, privileges: Iterable[PrivilegeDefinition], ctx: EvaluationContext) -> dict[str, ResolutionDetails[Any]]:
        """Resolve every listed privilege with one bulk request (``POST /oerep/v1/resolve``).

        Pass ``catalog.privileges``. Results for privileges the server knows but the local catalog does
        not are ignored. Any invalid entry fails the whole call. With a cache, results fill the
        per-privilege entries that later single resolutions read.
        """
        wanted = {p.key: p for p in privileges}
        # Evict all requested current-time entries before fetching: failed bulk validation is atomic.
        if ctx.now is None:
            with self._cache_lock:
                for key in wanted:
                    self._cache.pop((key, ctx.organization_id, ctx.subject_id, ctx.resource_id), None)
        data = self._post("resolve", ctx)
        if not isinstance(data, dict) or not isinstance(data.get("privileges"), list):
            raise ValueError("invalid OEREP bulk response")
        out: dict[str, ResolutionDetails[Any]] = {}
        for raw in data["privileges"]:
            key = raw.get("privilege") if isinstance(raw, dict) else None
            if not isinstance(key, str):
                raise ValueError("invalid OEREP details")
            if key not in wanted:
                continue
            if key in out:
                raise ValueError("duplicate OEREP bulk result")
            out[key] = decode_remote_details(raw, wanted[key], ctx)
        if len(out) != len(wanted):
            raise ValueError("OEREP bulk response is missing privileges")
        # A bulk call with an explicit ``now`` is a time-travel query: never stored.
        if self.cache_ttl is not None and ctx.now is None:
            items = [(ck, d) for k, d in out.items() if (ck := self._cache_key(k, ctx)) is not None]
            self._cache_put(items)
        return out

    def suggest_plan(self, privilege: PrivilegeDefinition, need: Need, ctx: EvaluationContext) -> Optional[str]:
        """Upgrade suggestions are never cached."""
        data = self._post(f"suggest/{quote(privilege.key, safe='')}", ctx, need=need)
        if not isinstance(data, dict) or "requiredPlan" not in data:
            raise ValueError("invalid OEREP suggestion")
        plan = data["requiredPlan"]
        if plan is not None and (not isinstance(plan, str) or not plan):
            raise ValueError("invalid OEREP suggestion")
        return plan
