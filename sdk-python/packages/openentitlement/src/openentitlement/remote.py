"""Generic OEREP v1 provider using the Python standard library."""
from __future__ import annotations

import json
import math
from typing import Any, Optional
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .catalog import PrivilegeDefinition
from .details import ErrorCode, EvaluationContext, GrantApplied, Reason, ResolutionDetails
from .provider import AbstractProvider, Capabilities, ProviderMetadata
from .resolver import Need
from .values import decode_value, is_int


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def decode_remote_details(raw: Any, p: PrivilegeDefinition) -> ResolutionDetails[Any]:
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
        decoded.append(GrantApplied(g["id"], g["amount"], g.get("subjectId")))
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
    """Connect to an OEREP server; decisions are never cached. Timeout is in seconds."""
    metadata = ProviderMetadata("oerep")
    capabilities = Capabilities(overrides=True, grants=True, plan_catalog=True)

    def __init__(self, base_url: str, *, token: Optional[str] = None, timeout: float = 5.0):
        url = urlsplit(base_url)
        if url.scheme not in ("http", "https") or not url.netloc or url.query or url.fragment or url.username or url.password:
            raise ValueError("base_url must be an HTTP(S) URL without credentials, query or fragment")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be positive")
        self.base_url, self.token, self.timeout = base_url.rstrip("/"), token, timeout
        self._opener = build_opener(_NoRedirect())

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

    def resolve(self, privilege: PrivilegeDefinition, ctx: EvaluationContext) -> ResolutionDetails[Any]:
        return decode_remote_details(self._post(f"resolve/{quote(privilege.key, safe='')}", ctx), privilege)

    def suggest_plan(self, privilege: PrivilegeDefinition, need: Need, ctx: EvaluationContext) -> Optional[str]:
        data = self._post(f"suggest/{quote(privilege.key, safe='')}", ctx, need=need)
        if not isinstance(data, dict) or "requiredPlan" not in data:
            raise ValueError("invalid OEREP suggestion")
        plan = data["requiredPlan"]
        if plan is not None and (not isinstance(plan, str) or not plan):
            raise ValueError("invalid OEREP suggestion")
        return plan
