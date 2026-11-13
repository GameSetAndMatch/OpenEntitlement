"""OEREP 0.1 evaluation: an application resolves its Product's Privileges with an API key (RFC-0005, spec §10).

A request is checked in a fixed order, so a key never reveals another Product:

1. a missing or unknown key is ``api-key-invalid`` (401);
2. a key of another Product, or a Product key that is not one, is ``product-forbidden`` (403),
   with one body whether or not the Product or the Privilege exists;
3. only then is a Privilege the Product does not have ``not-found`` (404).

Every lookup is scoped to the key's Workspace (the transaction is bound to it) and Product. Values
are resolved by the SDK engine from the same facts as the console (``organizations.fact_source``),
so applications and the console cannot disagree. An Organization without a Tier variant in the
Product resolves from the Catalog defaults, or the most restrictive value for a Privilege without
one. Evaluation only reads: it never changes a record or writes an audit entry.
"""
from __future__ import annotations

import re
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from openentitlement.catalog import PrivilegeDefinition, ValueType
from openentitlement.details import ErrorCode, EvaluationContext, Reason, ResolutionDetails, error_details
from openentitlement.privileges import Privilege, TypedPrivilege, Visibility
from openentitlement.resolver import Need, resolve_from_facts, satisfies

from .api_keys import parse_key
from .models import Product
from .organizations import (
    ApplicationUserRecord,
    AssignmentRecord,
    ProductFacts,
    definition,
    fact_source,
    prerequisite,
    sdk_value,
)
from .problems import ApiKeyInvalid, FieldError, NotFound, ProductForbidden, ValidationFailed
from .repositories import Repositories, Store
from .sign_in import digest
from .tiers import DEFAULT_POLICY, upgrade_candidates
from .workspaces import Deployment, user_entitlements, utcnow

#: Product keys and Privilege keys in OEREP paths (RFC-0005).
PATH_KEY = re.compile(r"^[a-z][a-z0-9_]*$")
MAX_SAFE_INTEGER = 9007199254740991
_RFC3339 = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):([0-5]\d):([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$"
)


def _restrictive(privilege: PrivilegeDefinition) -> Any:
    """The most restrictive value: ``false``, ``0`` or the first enum option (RFC-0005)."""
    if privilege.value_type is ValueType.BOOLEAN:
        return False
    if privilege.value_type is ValueType.INTEGER:
        return 0
    return privilege.options[0] if privilege.options else None


def _context(body: Any) -> EvaluationContext:
    """The evaluation context of a request body (Requirement 10.1.1). Unknown fields are ignored."""
    if not isinstance(body, dict):
        raise ValidationFailed([FieldError("", "Send a JSON object with a context.")])
    raw = body.get("context")
    if not isinstance(raw, dict):
        raise ValidationFailed([FieldError("/context", "Send the evaluation context as an object.")])
    errors = []
    organization = raw.get("organizationId")
    if not isinstance(organization, str) or not organization:
        errors.append(FieldError("/context/organizationId", "Send the Organization's ID as a non-empty string."))
    for name in ("subjectId", "resourceId"):
        if name in raw and (not isinstance(raw[name], str) or not raw[name]):
            errors.append(FieldError(f"/context/{name}", "Send a non-empty string, or leave it out."))
    now = None
    if "now" in raw:
        now = _timestamp(raw["now"])
        if now is None:
            errors.append(FieldError("/context/now", "Send an RFC 3339 timestamp with a time zone, or leave it out."))
    if errors:
        raise ValidationFailed(errors)
    return EvaluationContext(
        organization_id=organization, subject_id=raw.get("subjectId"), resource_id=raw.get("resourceId"), now=now
    )


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not _RFC3339.match(value):
        return None
    try:
        return datetime.fromisoformat(value.upper().replace("Z", "+00:00"))
    except ValueError:
        return None


def _need(privilege: PrivilegeDefinition, body: Mapping[str, Any]) -> Need:
    """``need`` of an upgrade request (Requirement 10.3.1)."""
    need = body.get("need")
    if privilege.value_type is ValueType.BOOLEAN and need is True:
        return True
    if privilege.value_type is ValueType.INTEGER and isinstance(need, int) and not isinstance(need, bool) and 0 <= need <= MAX_SAFE_INTEGER:
        return need
    if privilege.value_type is ValueType.ENUM and isinstance(need, str) and need in privilege.options:
        return need
    hint = {
        ValueType.BOOLEAN: "true",
        ValueType.INTEGER: "a non-negative whole number: the plan value needed",
        ValueType.ENUM: "one of this Privilege's options",
    }[privilege.value_type]
    raise ValidationFailed([FieldError("/need", f"Send {hint}.")])


@dataclass(frozen=True)
class Evaluation:
    """One authorized OEREP request: its key's Product, read in one transaction."""

    repos: Repositories
    product: Product
    privileges: tuple[TypedPrivilege, ...]
    environment: Mapping[str, str]
    clock: Callable[[], datetime]
    #: Whether application users' Personal terms and Grants apply: not on Cloud Pro (ADR-0005).
    users_allowed: bool = True

    def privilege(self, key: str) -> TypedPrivilege:
        """The Product's Privilege, or ``not-found``. Only asked after the key's Product was checked."""
        found = next((p for p in self.privileges if p.key == key), None) if PATH_KEY.match(key) else None
        if found is None:
            raise NotFound("This Product has no Privilege with this key.")
        return found

    async def _facts(self) -> ProductFacts:
        repos, product_id = self.repos, self.product.id
        policy = await repos.tiers.policy(product_id)
        return ProductFacts(
            privileges=self.privileges,
            variants={v.id: v for v in await repos.catalog.variants(product_id)},
            tiers={t.id: t for t in await repos.tiers.list(product_id)},
            policy=policy.policy if policy else DEFAULT_POLICY,
            environment=self.environment,
        )

    async def _load(self, body: Any) -> tuple[EvaluationContext, ProductFacts, AssignmentRecord | None, ApplicationUserRecord | None]:
        ctx = _context(body)
        if ctx.now is None:
            ctx = ctx.model_copy(update={"now": self.clock()})
        assert ctx.organization_id is not None
        organizations, product_id = self.repos.organizations, self.product.id
        assignment = await organizations.assignment(product_id, ctx.organization_id)
        user = None
        if ctx.subject_id is not None and self.users_allowed:
            user = await organizations.user(product_id, ctx.organization_id, ctx.subject_id)
        return ctx, await self._facts(), assignment, user

    async def resolve(self, privileges: tuple[TypedPrivilege, ...], body: Any) -> list[ResolutionDetails[Any]]:
        """Resolve ``privileges`` for the request's context at one time (§10.1.1, §10.2.1)."""
        ctx, facts, assignment, user = await self._load(body)
        return [self._resolve(p, ctx, facts, assignment, user) for p in privileges]

    def _resolve(
        self,
        privilege: TypedPrivilege,
        ctx: EvaluationContext,
        facts: ProductFacts,
        assignment: AssignmentRecord | None,
        user: ApplicationUserRecord | None,
    ) -> ResolutionDetails[Any]:
        assert ctx.now is not None and ctx.organization_id is not None
        _, source = fact_source(ctx.organization_id, assignment, facts, ctx.now, user)
        sdk = definition(privilege)
        if assignment is None and sdk.default is None:
            sdk = sdk.model_copy(update={"default": _restrictive(sdk)})
        details = resolve_from_facts(source, sdk, ctx)
        # A Boolean environment prerequisite can only remove access (ADR-0004).
        required = prerequisite(privilege, self.environment)
        if required is None or required is True or details.reason is Reason.ERROR:
            return details
        if isinstance(required, str):
            return error_details(privilege.key, False, ErrorCode.GENERAL, required)
        return details.with_(value=False, reason=Reason.FIXED, grants=())

    async def upgrade(self, privilege: TypedPrivilege, body: Any) -> str | None:
        """The lowest-ranked eligible, non-archived Tier of this Product that meets ``need`` (§3.4), or None.

        Each candidate is judged by its standard variant's value; Tier variants are never candidates.
        """
        sdk = definition(privilege)
        ctx, facts, assignment, user = await self._load(body)
        need = _need(sdk, body)
        details = self._resolve(privilege, ctx, facts, assignment, user)
        # A failed evaluation never suggests an upgrade (§10.2.2); no Tier lifts an environment veto.
        if details.reason in (Reason.ERROR, Reason.FIXED):
            return None
        read_only = privilege.visibility is Visibility.READ_ONLY
        for tier in upgrade_candidates(facts.tiers.values(), assignment.tier_id if assignment else None):
            standard = next((v for v in facts.variants.values() if v.tier_id == tier.id and v.kind == "standard"), None)
            if standard is None:
                continue
            # A variant stores its values; a Read-only Privilege always has its Catalog default.
            value = sdk.default if read_only or privilege.key not in standard.values else sdk_value(standard.values[privilege.key])
            if value is not None and satisfies(sdk, value, need):
                return tier.id
        return None


class EvaluationService:
    """Opens OEREP requests: authenticates the key and checks its Product before anything is read."""

    def __init__(
        self,
        store: Store,
        *,
        environment: Mapping[str, str] | None = None,
        clock: Callable[[], datetime] = utcnow,
        deployment: Deployment = Deployment.SELF_HOSTED,
    ) -> None:
        self.store = store
        self.environment = dict(environment or {})
        self.clock = clock
        self.deployment = deployment

    @asynccontextmanager
    async def open(self, authorization: str | None, product_key: str) -> AsyncIterator[Evaluation]:
        """A read-only transaction in the key's Workspace, for the key's Product.

        ``authorization`` is the request's ``Authorization`` header. Raises ``api-key-invalid``, then
        ``product-forbidden``; nothing about the Workspace is read before the key is found.
        """
        scheme, _, secret = (authorization or "").partition(" ")
        parsed = parse_key(secret.strip()) if scheme.lower() == "bearer" else None
        if parsed is None:
            raise ApiKeyInvalid()
        workspace_id, token = parsed
        async with self.store.transaction(workspace_id) as repos:
            key = await repos.api_keys.find(digest(token))
            if key is None:
                raise ApiKeyInvalid()
            product = await repos.products.get(key.product_id)
            if product is None or product.key != product_key:
                raise ProductForbidden()
            workspace = await repos.workspaces.get()
            assert workspace is not None, "a key goes with its Workspace"
            privileges = tuple(r.entry for r in await repos.catalog.list(product.id) if isinstance(r.entry, Privilege))
            yield Evaluation(
                repos=repos,
                product=product,
                privileges=privileges,
                environment=self.environment,
                clock=self.clock,
                users_allowed=user_entitlements(self.deployment, workspace),
            )
