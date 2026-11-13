"""Organizations, their Tier variant per Product, Organization terms and application users (ADR-0008, OPE-41, OPE-60).

An Organization is one customer of the Workspace: every member sees its name. For each Product it
buys it has one Tier variant, a contract status and Organization terms that belong to that
variant. Its values are resolved by the SDK's resolution engine (spec §3), so the console and
applications cannot disagree: the contract status first picks the variant in effect (the Tier's
grace variant while past-due grace lasts, then the Product's status policy), then
``resolve_from_facts`` resolves every Privilege from that variant and the Organization terms.

An application user is an Organization-scoped Subject, identified by the Subject ID the
application sends (ADR-0005). In each Product it may have Personal terms, which replace the
Organization's values and belong to the Organization's variant when they were saved, and Grants,
which add to the resolved value. They reach the engine as subject-scoped overrides and grants.

Writes to an Organization's variant or its application users in a Product take the Product lock that Catalog and Tier
writes take, so a Catalog change can never invalidate terms saved concurrently, and a Tier cannot
be deleted while an Organization is being given one of its variants.
"""
from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from openentitlement.catalog import PrivilegeDefinition, ValueType
from openentitlement.details import EvaluationContext, Reason
from openentitlement.facts import Assignment, Grant, Override, Plan, Scope
from openentitlement.model import OpenEntitlementModel
from openentitlement.privileges import (
    BooleanPrivilege,
    Identifier,
    IntegerPrivilege,
    Privilege,
    Title,
    TypedPrivilege,
    Unlimited,
    Visibility,
)
from openentitlement.resolver import resolve_from_facts
from openentitlement.values import UNLIMITED, is_unlimited
from pydantic import Field, JsonValue, StrictInt, TypeAdapter, ValidationError

from . import audit
from .access import Permission
from .audit import Aspect, AuditAction, TargetKind
from .catalog import CatalogValue, VariantValues, value_error
from .problems import (
    AlreadyTaken,
    FieldError,
    NotFound,
    RevisionConflict,
    UserEntitlementsUnavailable,
    ValidationFailed,
    escape_pointer_token,
)
from .repositories import AlreadyExists, StaleVersion
from .tiers import DEFAULT_POLICY, StatusPolicy, TierRecord
from .workspaces import Deployment, OpenWorkspace, user_entitlements

ContractStatus = Literal["active", "past_due", "ended"]
MAX_REASON = 2000
MAX_SUBJECT = 200
UserState = Literal["active", "stale", "suspended"]


class OrganizationRecord(OpenEntitlementModel):
    """A customer of the Workspace. Its ID is what applications send; it never changes."""

    workspace_id: UUID
    id: Identifier
    name: Title
    version: int = Field(ge=1, strict=True)
    created_at: datetime


class AssignmentRecord(OpenEntitlementModel):
    """An Organization's Tier variant in one Product, its contract status and Organization terms."""

    workspace_id: UUID
    organization_id: Identifier
    product_id: UUID
    variant_id: Identifier
    #: The variant's Tier, which never changes for a variant.
    tier_id: Identifier
    #: Values that replace the variant's; they belong to that variant (GLOSSARY: Organization terms).
    terms: dict[str, CatalogValue] = Field(default_factory=dict)
    status: ContractStatus = "active"
    #: When a past-due Organization's grace ends; set while past due.
    grace_ends_at: datetime | None = None
    version: int = Field(ge=1, strict=True)


class ApplicationUserRecord(OpenEntitlementModel):
    """An application user's Personal terms and Grants in one Product (GLOSSARY: Application user).

    Not a console Account or member: the application identifies it by ``subject_id`` together
    with its Organization's ID.
    """

    workspace_id: UUID
    product_id: UUID
    organization_id: Identifier
    subject_id: str
    name: str
    #: The Organization's variant when the Personal terms were saved: they belong to it (ADR-0005).
    variant_id: Identifier
    #: Values that replace the Organization's for this user.
    terms: dict[str, CatalogValue] = Field(default_factory=dict)
    #: Positive whole-number allowances added to integer Privileges' resolved values.
    grants: dict[str, StrictInt] = Field(default_factory=dict)
    version: int = Field(ge=1, strict=True)


class ApplicationUserInput(OpenEntitlementModel):
    name: str
    terms: dict[str, CatalogValue] = Field(default_factory=dict)
    grants: dict[str, StrictInt] = Field(default_factory=dict)


class AssignmentInput(OpenEntitlementModel):
    variant_id: Identifier
    status: ContractStatus = "active"
    terms: dict[str, CatalogValue] = Field(default_factory=dict)


ValueSource = Literal[
    "default", "variant", "organizationTerms", "personalTerms", "grant", "gracePeriod", "environment", "error"
]


class ResolvedValue(OpenEntitlementModel):
    """One Privilege's value for an Organization, and where it comes from in glossary terms."""

    privilege: str
    value: CatalogValue | None
    source: ValueSource
    #: "Catalog default", the variant's name, "Organization terms", "Personal terms", "Grace period",
    #: the environment prerequisite, or a value with its Grants, such as "Personal terms 40 + Grant 5".
    source_name: str
    error: str | None = None


class ApplicationUserView(OpenEntitlementModel):
    subject_id: str
    name: str
    variant_id: str
    terms: dict[str, CatalogValue]
    grants: dict[str, int]
    version: int
    #: ``stale``: the Organization has another variant, so the Personal terms are inactive (Grants
    #: still apply). ``suspended``: grace or a fallback variant suspends both.
    state: UserState
    #: The user's values, as the SDK resolved them. Empty where user-level entitlements are unavailable.
    values: tuple[ResolvedValue, ...]


class AssignmentView(OpenEntitlementModel):
    product_id: UUID
    variant_id: str
    tier_id: str
    status: ContractStatus
    grace_ends_at: datetime | None = None
    terms: dict[str, CatalogValue]
    version: int
    #: The variant whose values apply now: the assigned one, its Tier's grace variant or a fallback.
    effective_variant_id: str
    grace: bool
    fallback: bool
    #: The status policy keeps the values read-only.
    read_only: bool
    values: tuple[ResolvedValue, ...]
    #: Application users with Personal terms or Grants in this Product.
    users: tuple[ApplicationUserView, ...] = ()


class OrganizationView(OpenEntitlementModel):
    id: str
    name: str
    version: int
    #: Only the Products where the viewer has a Role.
    products: tuple[AssignmentView, ...]


class OrganizationsView(OpenEntitlementModel):
    organizations: tuple[OrganizationView, ...]


# Resolution through the SDK engine.


def _sdk_value(value: Any) -> Any:
    return UNLIMITED if isinstance(value, Unlimited) else value


def _catalog_value(value: Any) -> CatalogValue | None:
    if is_unlimited(value):
        return Unlimited(unlimited=True)
    result: CatalogValue | None = value
    return result


def definition(privilege: TypedPrivilege) -> PrivilegeDefinition:
    """The SDK's evaluation view of a Catalog Privilege."""
    default = _sdk_value(getattr(privilege, "default", None))
    if isinstance(privilege, BooleanPrivilege):
        return PrivilegeDefinition(key=privilege.key, value_type=ValueType.BOOLEAN, default=default)
    if isinstance(privilege, IntegerPrivilege):
        return PrivilegeDefinition(
            key=privilege.key, value_type=ValueType.INTEGER, default=default, unlimited_allowed=privilege.unlimited
        )
    return PrivilegeDefinition(key=privilege.key, value_type=ValueType.ENUM, default=default, options=privilege.enum)


ORGANIZATION_TERMS = "organization-terms"
PERSONAL_TERMS = "personal-terms"


@dataclass(frozen=True)
class _Facts:
    """One Organization's facts in one Product, as the SDK's ``FactSource`` reads them.

    Each Tier variant is a plan of its own family, and Organization terms are Organization-scoped
    overrides of the variant in effect. An application user's Personal terms are subject-scoped
    overrides of the variant they were saved on, so the engine keeps them inactive (stale) on any
    other, and its Grants are subject-scoped grants. A Read-only Privilege has none of them: it
    uses its Catalog default (RFC-0002).
    """

    organization_id: str
    variants: Mapping[str, VariantValues]
    plan_id: str
    terms: Mapping[str, CatalogValue]
    read_only: frozenset[str]
    user: ApplicationUserRecord | None = None

    def assignment(self, organization_id: str) -> Assignment | None:
        return Assignment(organization_id=organization_id, plan_id=self.plan_id)

    def plan(self, plan_id: str) -> Plan | None:
        variant = self.variants.get(plan_id)
        return Plan(id=variant.id, name=variant.name) if variant else None

    def plans(self) -> Sequence[Plan]:
        return [Plan(id=v.id, name=v.name) for v in self.variants.values()]

    def plan_value(self, plan_id: str, privilege: str) -> tuple[bool, Any]:
        variant = self.variants.get(plan_id)
        if privilege in self.read_only or variant is None or privilege not in variant.values:
            return False, None
        return True, _sdk_value(variant.values[privilege])

    def overrides(self, organization_id: str, privilege: str) -> Sequence[Override]:
        if privilege in self.read_only:
            return []
        found = []
        if privilege in self.terms:
            found.append(
                Override(
                    id=f"{ORGANIZATION_TERMS}:{privilege}",
                    scope=Scope(organization_id=organization_id),
                    privilege=privilege,
                    value=_sdk_value(self.terms[privilege]),
                    plan_family=self.plan_id,
                    reason="Organization terms",
                )
            )
        user = self.user
        if user is not None and privilege in user.terms:
            found.append(
                Override(
                    id=f"{PERSONAL_TERMS}:{privilege}",
                    scope=Scope(organization_id=organization_id, subject_id=user.subject_id),
                    privilege=privilege,
                    value=_sdk_value(user.terms[privilege]),
                    plan_family=user.variant_id,
                    reason="Personal terms",
                )
            )
        return found

    def grants(self, organization_id: str, privilege: str) -> Sequence[Grant]:
        user = self.user
        if privilege in self.read_only or user is None or privilege not in user.grants:
            return []
        return [
            Grant(
                id=f"grant:{privilege}",
                scope=Scope(organization_id=organization_id, subject_id=user.subject_id),
                privilege=privilege,
                amount=user.grants[privilege],
                reason="Grant",
            )
        ]


@dataclass(frozen=True)
class ProductFacts:
    """What resolving an Organization in one Product needs, read once per Product."""

    privileges: tuple[TypedPrivilege, ...]
    variants: Mapping[str, VariantValues]
    tiers: Mapping[str, TierRecord]
    policy: StatusPolicy = field(default=DEFAULT_POLICY)
    #: The install's environment, for Boolean environment prerequisites (ADR-0004).
    environment: Mapping[str, str] = field(default_factory=dict)


def prerequisite(privilege: TypedPrivilege, environment: Mapping[str, str]) -> bool | str | None:
    """A Boolean environment prerequisite's value, why it cannot be read, or None without one.

    It can only restrict: access needs both the entitlement and the variable to be true (ADR-0004).
    """
    variable = privilege.env_override if isinstance(privilege, BooleanPrivilege) else None
    if variable is None:
        return None
    raw = environment.get(variable)
    if raw is None:
        return f"The required environment variable {variable} is unset."
    text = raw.strip().lower()
    if text not in ("true", "false", "1", "0"):
        return f"The environment variable {variable} must be true or false."
    return text in ("true", "1")


@dataclass(frozen=True)
class InEffect:
    variant_id: str
    grace: bool = False
    fallback: bool = False
    read_only: bool = False


def in_effect(assignment: AssignmentRecord, facts: ProductFacts, now: datetime) -> InEffect:
    """The variant whose values apply at ``now``, given the contract status.

    Past due within grace: the Tier's grace variant. Past due after grace (or without a grace
    variant) and ended: the Product's status policy, read-only or a fallback variant.
    """
    status = assignment.status
    if status == "active":
        return InEffect(assignment.variant_id)
    if status == "past_due" and assignment.grace_ends_at is not None and now < assignment.grace_ends_at:
        grace = next(
            (v for v in facts.variants.values() if v.tier_id == assignment.tier_id and v.kind == "grace"), None
        )
        if grace is not None:
            return InEffect(grace.id, grace=True)
    action = facts.policy.past_due if status == "past_due" else facts.policy.ended
    if action.variant_id is not None and action.variant_id in facts.variants:
        return InEffect(action.variant_id, fallback=True)
    return InEffect(assignment.variant_id, read_only=True)


def _exceptions_apply(assignment: AssignmentRecord, effect: InEffect) -> bool:
    """Whether Organization terms, Personal terms and Grants apply: a grace or fallback variant suspends them."""
    return effect.variant_id == assignment.variant_id and not effect.fallback


def user_state(assignment: AssignmentRecord, user: ApplicationUserRecord, facts: ProductFacts, now: datetime) -> UserState:
    if not _exceptions_apply(assignment, in_effect(assignment, facts, now)):
        return "suspended"
    return "active" if user.variant_id == assignment.variant_id else "stale"


def _amount(value: Any) -> str:
    return "unlimited" if is_unlimited(value) else str(value)


def resolve(
    assignment: AssignmentRecord, facts: ProductFacts, now: datetime, user: ApplicationUserRecord | None = None
) -> tuple[InEffect, tuple[ResolvedValue, ...]]:
    """Every Privilege of the Product for the Organization, or one of its application users, resolved by the SDK engine."""
    effect = in_effect(assignment, facts, now)
    # Organization terms belong to the assigned variant: a grace or fallback variant replaces them.
    # It suspends the user's Personal terms and Grants too (ADR-0005).
    applies = _exceptions_apply(assignment, effect)
    source = _Facts(
        organization_id=assignment.organization_id,
        variants=facts.variants,
        plan_id=effect.variant_id,
        terms=assignment.terms if applies else {},
        read_only=frozenset(p.key for p in facts.privileges if p.visibility is Visibility.READ_ONLY),
        user=user if applies else None,
    )
    context = EvaluationContext(
        organization_id=assignment.organization_id, subject_id=user.subject_id if user else None, now=now
    )
    variant = facts.variants.get(effect.variant_id)
    values = []
    for privilege in facts.privileges:
        details = resolve_from_facts(source, definition(privilege), context)
        if details.reason is Reason.ERROR or details.value is None:
            values.append(
                ResolvedValue(
                    privilege=privilege.key,
                    value=None,
                    source="error",
                    source_name="",
                    error=details.error_message or "This variant has no value for this Privilege.",
                )
            )
            continue
        kind: ValueSource
        required = prerequisite(privilege, facts.environment)
        if isinstance(required, str):
            values.append(ResolvedValue(privilege=privilege.key, value=None, source="error", source_name="", error=required))
            continue
        if required is False:
            # The install's prerequisite vetoes the entitlement; it never grants one.
            variable = privilege.env_override if isinstance(privilege, BooleanPrivilege) else ""
            values.append(
                ResolvedValue(
                    privilege=privilege.key, value=False, source="environment", source_name=f"Environment prerequisite {variable}"
                )
            )
            continue
        # Where the value before Grants comes from.
        if details.override_id is not None and details.override_id.startswith(PERSONAL_TERMS):
            kind, name = "personalTerms", "Personal terms"
        elif details.override_id is not None:
            kind, name = "organizationTerms", "Organization terms"
        elif details.has_plan_value and effect.grace:
            kind, name = "gracePeriod", "Grace period"
        elif details.has_plan_value:
            kind, name = "variant", variant.name if variant else effect.variant_id
        else:
            kind, name = "default", "Catalog default"
        if details.reason is Reason.GRANT:
            granted = sum(g.amount for g in details.grants)
            kind, name = "grant", f"{name} {_amount(details.value - granted)} + Grant {granted}"
        values.append(
            ResolvedValue(privilege=privilege.key, value=_catalog_value(details.value), source=kind, source_name=name)
        )
    return effect, tuple(values)


# Rules.


def _pointer(*tokens: str) -> str:
    return "".join("/" + escape_pointer_token(t) for t in tokens)


def _json(terms: Mapping[str, CatalogValue]) -> str:
    """Terms in a normalized form, so that equal values compare equal whatever their order."""
    return json.dumps(
        {k: v.model_dump(mode="json") if isinstance(v, Unlimited) else v for k, v in terms.items()}, sort_keys=True
    )


def _name(name: str) -> str:
    try:
        return TypeAdapter(Title).validate_python(name)
    except ValidationError as exc:
        raise ValidationFailed([FieldError("/name", e["msg"]) for e in exc.errors()]) from exc


def term_errors(
    privileges: Sequence[TypedPrivilege], terms: Mapping[str, CatalogValue], stored: Mapping[str, CatalogValue]
) -> list[FieldError]:
    """Why Organization terms are invalid: unknown Privileges, invalid values, Read-only values.

    A Read-only Privilege uses its Catalog default (RFC-0002). A stored value stays as it is and has
    no effect, so a save may resend it unchanged, but cannot set or change one.
    """
    by_key = {p.key: p for p in privileges}
    errors = []
    for key, value in sorted(terms.items()):
        pointer = _pointer("terms", key)
        entry = by_key.get(key)
        if entry is None:
            errors.append(FieldError(pointer, "Unknown Privilege in this Product."))
        elif entry.visibility is Visibility.READ_ONLY:
            if key not in stored or _json({key: value}) != _json({key: stored[key]}):
                errors.append(FieldError(pointer, "A Read-only Privilege uses its Catalog default; omit this value."))
        else:
            problem = value_error(entry, value)
            if problem:
                errors.append(FieldError(pointer, problem))
    return errors


def grant_errors(
    privileges: Sequence[TypedPrivilege], grants: Mapping[str, int], stored: Mapping[str, int]
) -> list[FieldError]:
    """Why Grants are invalid: each is a positive whole-number allowance on an integer Privilege.

    Like Personal terms, a Read-only Privilege takes none; a stored one may be resent unchanged.
    """
    by_key = {p.key: p for p in privileges}
    errors = []
    for key, amount in sorted(grants.items()):
        pointer = _pointer("grants", key)
        entry = by_key.get(key)
        if entry is None:
            errors.append(FieldError(pointer, "Unknown Privilege in this Product."))
        elif not isinstance(entry, IntegerPrivilege):
            errors.append(FieldError(pointer, "A Grant adds to an integer Privilege only."))
        elif entry.visibility is Visibility.READ_ONLY:
            if stored.get(key) != amount:
                errors.append(FieldError(pointer, "A Read-only Privilege uses its Catalog default; omit this Grant."))
        elif isinstance(amount, bool) or amount <= 0:
            errors.append(FieldError(pointer, "Use a positive whole number."))
    return errors


def subject_id_error(subject_id: str) -> str | None:
    """Why a Subject ID is not one an application sends: it is matched exactly as given."""
    if (
        not subject_id
        or subject_id != subject_id.strip()
        or len(subject_id) > MAX_SUBJECT
        or any(ord(c) < 32 or ord(c) == 127 for c in subject_id)
    ):
        return (
            f"Use the ID your application sends: at most {MAX_SUBJECT} characters, "
            "without surrounding spaces or control characters."
        )
    return None


def _user_name(name: str) -> str:
    text = name.strip()
    if not text or len(text) > MAX_SUBJECT:
        raise ValidationFailed([FieldError("/name", f"Enter a name of at most {MAX_SUBJECT} characters.")])
    return text


def _exceptions(user: ApplicationUserRecord | None) -> tuple[str | None, str, str]:
    """What a reason covers: Personal terms with the variant they belong to, and Grants."""
    if user is None:
        return None, "{}", "{}"
    return (user.variant_id if user.terms else None), _json(user.terms), json.dumps(user.grants, sort_keys=True)


def normalized_reason(reason: str | None) -> str | None:
    text = (reason or "").strip()
    if len(text) > MAX_REASON:
        raise ValidationFailed([FieldError("/reason", f"Use at most {MAX_REASON} characters.")])
    return text or None


def _dump(model: OpenEntitlementModel) -> dict[str, JsonValue]:
    data: dict[str, JsonValue] = model.model_dump(mode="json", by_alias=True)
    return data


@dataclass(frozen=True)
class _Assigned:
    """What saving an Organization's Tier variant changed, for its Audit log entry."""

    changes: list[audit.AuditChange]
    reason: str | None


def _assignment_fields(assignment: AssignmentRecord, facts: ProductFacts) -> dict[str, JsonValue]:
    """An Organization's Tier variant in a Product as the Audit log shows it: the variant by its name now."""
    data = _dump(assignment)
    variant = facts.variants.get(assignment.variant_id)
    return {
        "variant": variant.name if variant else assignment.variant_id,
        "status": data["status"],
        "graceEndsAt": data.get("graceEndsAt"),
        "terms": data["terms"],
    }


def _user_fields(user: ApplicationUserRecord) -> dict[str, JsonValue]:
    data = _dump(user)
    return {"name": data["name"], "terms": data["terms"], "grants": data["grants"]}


class OrganizationService:
    def __init__(
        self, environment: Mapping[str, str] | None = None, *, deployment: Deployment = Deployment.SELF_HOSTED
    ) -> None:
        self.environment = dict(environment or {})
        self.deployment = deployment

    async def _users_allowed(self, ws: OpenWorkspace) -> tuple[bool, str]:
        workspace = await ws.repos.workspaces.get()
        assert workspace is not None, "an open Workspace exists"
        return user_entitlements(self.deployment, workspace), workspace.service_tier.value

    async def _facts(self, ws: OpenWorkspace, product_id: UUID) -> ProductFacts:
        policy = await ws.repos.tiers.policy(product_id)
        return ProductFacts(
            privileges=tuple(r.entry for r in await ws.repos.catalog.list(product_id) if isinstance(r.entry, Privilege)),
            variants={v.id: v for v in await ws.repos.catalog.variants(product_id)},
            tiers={t.id: t for t in await ws.repos.tiers.list(product_id)},
            policy=policy.policy if policy else DEFAULT_POLICY,
            environment=self.environment,
        )

    async def view(self, ws: OpenWorkspace) -> OrganizationsView:
        """Every Organization's name, with its variant and values in the Products the viewer can see."""
        assignments: dict[str, list[AssignmentRecord]] = {}
        for found in await ws.repos.organizations.assignments():
            if ws.actor.sees(found.product_id):
                assignments.setdefault(found.organization_id, []).append(found)
        users: dict[tuple[str, UUID], list[ApplicationUserRecord]] = {}
        for user in await ws.repos.organizations.users():
            if ws.actor.sees(user.product_id):
                users.setdefault((user.organization_id, user.product_id), []).append(user)
        allowed, _ = await self._users_allowed(ws)
        facts: dict[UUID, ProductFacts] = {}
        organizations = []
        for organization in sorted(await ws.repos.organizations.list(), key=lambda o: (o.name.casefold(), o.id)):
            products = []
            for assignment in sorted(assignments.get(organization.id, []), key=lambda a: str(a.product_id)):
                if assignment.product_id not in facts:
                    facts[assignment.product_id] = await self._facts(ws, assignment.product_id)
                product_facts = facts[assignment.product_id]
                effect, values = resolve(assignment, product_facts, ws.now)
                found_users = sorted(users.get((organization.id, assignment.product_id), []), key=lambda u: (u.name.casefold(), u.subject_id))
                products.append(
                    AssignmentView(
                        product_id=assignment.product_id,
                        variant_id=assignment.variant_id,
                        tier_id=assignment.tier_id,
                        status=assignment.status,
                        grace_ends_at=assignment.grace_ends_at,
                        terms=assignment.terms,
                        version=assignment.version,
                        effective_variant_id=effect.variant_id,
                        grace=effect.grace,
                        fallback=effect.fallback,
                        read_only=effect.read_only,
                        values=values,
                        users=tuple(
                            ApplicationUserView(
                                subject_id=user.subject_id,
                                name=user.name,
                                variant_id=user.variant_id,
                                terms=user.terms,
                                grants=user.grants,
                                version=user.version,
                                state=user_state(assignment, user, product_facts, ws.now),
                                # Downgraded to Cloud Pro: the record stays, user-level values are not served (ADR-0005).
                                values=resolve(assignment, product_facts, ws.now, user)[1] if allowed else (),
                            )
                            for user in found_users
                        ),
                    )
                )
            organizations.append(
                OrganizationView(id=organization.id, name=organization.name, version=organization.version, products=tuple(products))
            )
        return OrganizationsView(organizations=tuple(organizations))

    async def _titles(self, ws: OpenWorkspace, product_id: UUID) -> dict[str, str]:
        """Each Privilege's title now, to name terms and Grants in the Audit log."""
        return {r.key: r.entry.title for r in await ws.repos.catalog.list(product_id) if isinstance(r.entry, Privilege)}

    async def create(
        self,
        ws: OpenWorkspace,
        *,
        id: str,  # noqa: A002 - the Organization's ID
        name: str,
        product_id: UUID | None = None,
        assignment: AssignmentInput | None = None,
        reason: str | None = None,
    ) -> OrganizationsView:
        """Add an Organization, optionally giving it a Tier variant in one Product in the same transaction."""
        ws.actor.require(Permission.MANAGE_ORGANIZATIONS)
        if (product_id is None) != (assignment is None):
            raise ValidationFailed([FieldError("/assignment", "Give a Tier variant together with its Product.")])
        try:
            TypeAdapter(Identifier).validate_python(id)
        except ValidationError as exc:
            detail = "Use a lowercase letter, then lowercase letters, digits or underscores (at most 80)."
            raise ValidationFailed([FieldError("/id", detail)]) from exc
        organization = OrganizationRecord(
            workspace_id=ws.actor.workspace_id, id=id, name=_name(name), version=1, created_at=ws.now
        )
        try:
            await ws.repos.organizations.add(organization)
        except AlreadyExists as exc:
            raise AlreadyTaken(f"Another Organization already uses the ID {id}.", kind="Organization", key=id) from exc
        changes = audit.diff(None, {"name": organization.name})
        why = None
        if product_id is not None and assignment is not None:
            assigned = await self._assign(
                ws, organization, product_id, assignment, version=0, reason=reason, pointer="/assignment"
            )
            # One entry: every Manager reads the new name; only this Product's Managers its Tier and terms.
            names = await audit.product_names(ws)
            changes += [c.model_copy(update={"product_id": product_id, "product_name": names.get(product_id)}) for c in assigned.changes]
            why = assigned.reason
        await audit.record(
            ws, action=AuditAction.CREATED, target_kind=TargetKind.ORGANIZATION, target_id=id,
            target_name=organization.name, changes=changes, reason=why,
        )
        return await self.view(ws)

    async def rename(self, ws: OpenWorkspace, organization_id: str, *, name: str, version: int) -> OrganizationsView:
        ws.actor.require(Permission.MANAGE_ORGANIZATIONS)
        current = await self._organization(ws, organization_id)
        if current.version != version:
            raise RevisionConflict(kind="Organization", id=organization_id)
        changed = OrganizationRecord.model_validate(
            current.model_dump(by_alias=True) | {"name": _name(name), "version": version + 1}
        )
        try:
            await ws.repos.organizations.update(changed, expected_version=version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="Organization", id=organization_id) from exc
        await audit.record(
            ws, action=AuditAction.CHANGED, target_kind=TargetKind.ORGANIZATION, target_id=organization_id,
            target_name=current.name, changes=audit.diff({"name": current.name}, {"name": changed.name}),
        )
        return await self.view(ws)

    async def assign(
        self,
        ws: OpenWorkspace,
        organization_id: str,
        product_id: UUID,
        assignment: AssignmentInput,
        *,
        version: int,
        reason: str | None = None,
    ) -> OrganizationsView:
        """Give the Organization a Tier variant in the Product (version 0), or change it, its status or terms."""
        ws.actor.require(Permission.EDIT_PRODUCT, product_id)
        organization = await self._organization(ws, organization_id)
        assigned = await self._assign(ws, organization, product_id, assignment, version=version, reason=reason, pointer="")
        terms = [c.field.startswith("terms.") for c in assigned.changes]
        # The sentence names the part that changed: the terms, the Tier variant and status, or both (none).
        aspect = Aspect.TERMS if all(terms) else None if any(terms) else Aspect.TIER
        await audit.record(
            ws,
            action=AuditAction.CHANGED,
            target_kind=TargetKind.ORGANIZATION,
            target_id=organization.id,
            target_name=organization.name,
            aspect=aspect,
            product_id=product_id,
            changes=assigned.changes,
            reason=assigned.reason,
        )
        return await self.view(ws)

    async def _audit_user(
        self,
        ws: OpenWorkspace,
        before: ApplicationUserRecord | None,
        after: ApplicationUserRecord | None,
        reason: str | None,
    ) -> None:
        user = before or after
        assert user is not None
        changes = audit.diff(
            _user_fields(before) if before else None,
            _user_fields(after) if after else None,
            titles=await self._titles(ws, user.product_id),
        )
        exceptions = any(c.field.startswith(("terms.", "grants.")) for c in changes)
        await audit.record(
            ws,
            action=AuditAction.CHANGED if before and after else AuditAction.CREATED if after else AuditAction.REMOVED,
            target_kind=TargetKind.APPLICATION_USER,
            target_id=f"{user.organization_id}/{user.subject_id}",
            target_name=user.name or user.subject_id,
            aspect=Aspect.TERMS if before and after and exceptions else None,
            product_id=user.product_id,
            changes=changes,
            reason=reason,
        )

    async def _organization(self, ws: OpenWorkspace, organization_id: str) -> OrganizationRecord:
        found = await ws.repos.organizations.get(organization_id)
        if found is None:
            raise NotFound("This Organization does not exist.")
        return found

    async def _assign(
        self,
        ws: OpenWorkspace,
        organization: OrganizationRecord,
        product_id: UUID,
        wanted: AssignmentInput,
        *,
        version: int,
        reason: str | None,
        pointer: str,
    ) -> _Assigned:
        """Save the Organization's Tier variant in the Product; return what changed for the Audit log."""
        ws.actor.require(Permission.EDIT_PRODUCT, product_id)
        # The Product lock: Catalog, Tier and Organization-term writes of one Product run one at a time.
        await ws.repos.catalog.lock(product_id)
        product = await ws.repos.products.get(product_id)
        if product is None:
            raise NotFound("This Product does not exist or you have no Role in it.")
        current = next(
            (a for a in await ws.repos.organizations.assignments(product_id) if a.organization_id == organization.id),
            None,
        )
        if (current.version if current else 0) != version:
            raise RevisionConflict(kind="Organization's Tier variant", id=organization.id)
        facts = await self._facts(ws, product_id)
        chosen = facts.variants.get(wanted.variant_id)
        new_variant = current is None or current.variant_id != wanted.variant_id
        errors: list[FieldError] = []
        if current is None and product.archived_at is not None:
            errors.append(FieldError(pointer or "/", "This Product is archived: it cannot be given to another Organization."))
        if chosen is None or chosen.kind == "grace":
            errors.append(FieldError(pointer + "/variantId", "Choose a standard or trial variant of this Product."))
        elif new_variant and facts.tiers[chosen.tier_id].archived_at is not None:
            errors.append(
                FieldError(pointer + "/variantId", "This variant's Tier is archived: it cannot be given to an Organization.")
            )
        # Organization terms belong to the variant: a new variant starts from the terms sent with it.
        stored = current.terms if current and not new_variant else {}
        errors.extend(
            FieldError(pointer + e.pointer, e.detail) for e in term_errors(facts.privileges, wanted.terms, stored)
        )
        tier = facts.tiers.get(chosen.tier_id) if chosen else None
        if (
            wanted.status == "past_due"
            and tier is not None
            and tier.grace_period_days > 0
            and not any(v.tier_id == tier.id and v.kind == "grace" for v in facts.variants.values())
        ):
            errors.append(
                FieldError(pointer + "/status", "Create a grace period variant for this Tier before using past-due grace.")
            )
        if errors:
            raise ValidationFailed(errors)
        assert chosen is not None and tier is not None
        before = current.terms if current else {}
        terms_changed = _json(before) != _json(wanted.terms)
        why = normalized_reason(reason)
        if terms_changed and why is None:
            raise ValidationFailed([FieldError("/reason", "Add a reason for changing Organization terms.")])
        grace_ends_at = None
        if wanted.status == "past_due":
            keeps = current is not None and current.status == "past_due" and current.tier_id == tier.id
            grace_ends_at = (
                current.grace_ends_at if keeps and current is not None else ws.now + timedelta(days=tier.grace_period_days)
            )
        saved = AssignmentRecord(
            workspace_id=ws.actor.workspace_id,
            organization_id=organization.id,
            product_id=product_id,
            variant_id=chosen.id,
            tier_id=tier.id,
            terms=dict(wanted.terms),
            status=wanted.status,
            grace_ends_at=grace_ends_at,
            version=version + 1,
        )
        try:
            await ws.repos.organizations.save_assignment(saved, expected_version=version)
        except (StaleVersion, AlreadyExists) as exc:
            raise RevisionConflict(kind="Organization's Tier variant", id=organization.id) from exc
        titles = {p.key: p.title for p in facts.privileges}
        changes = audit.diff(
            _assignment_fields(current, facts) if current else None, _assignment_fields(saved, facts), titles=titles
        )
        return _Assigned(changes=changes, reason=why if terms_changed else None)

    # Application users (OPE-60).

    async def _user_target(
        self, ws: OpenWorkspace, organization_id: str, product_id: UUID, subject_id: str
    ) -> tuple[OrganizationRecord, ApplicationUserRecord | None]:
        ws.actor.require(Permission.EDIT_PRODUCT, product_id)
        organization = await self._organization(ws, organization_id)
        # The Product lock: a Catalog change cannot invalidate Personal terms or Grants saved concurrently.
        await ws.repos.catalog.lock(product_id)
        if await ws.repos.products.get(product_id) is None:
            raise NotFound("This Product does not exist or you have no Role in it.")
        current = next(
            (
                u
                for u in await ws.repos.organizations.users(product_id)
                if u.organization_id == organization.id and u.subject_id == subject_id
            ),
            None,
        )
        return organization, current

    async def save_user(
        self,
        ws: OpenWorkspace,
        organization_id: str,
        product_id: UUID,
        subject_id: str,
        wanted: ApplicationUserInput,
        *,
        version: int,
        reason: str | None = None,
    ) -> OrganizationsView:
        """Add an application user of the Organization in the Product (version 0), or change its name, Personal terms or Grants.

        The Personal terms sent belong to the Organization's variant now. A reason is required
        whenever Personal terms or Grants change. Needs Cloud Enterprise on OpenEntitlement Cloud.
        """
        ws.actor.require(Permission.EDIT_PRODUCT, product_id)
        allowed, tier = await self._users_allowed(ws)
        if not allowed:
            raise UserEntitlementsUnavailable(service_tier=tier)
        problem = subject_id_error(subject_id)
        if problem:
            raise ValidationFailed([FieldError("/subjectId", problem)])
        name = _user_name(wanted.name)
        organization, current = await self._user_target(ws, organization_id, product_id, subject_id)
        if (current.version if current else 0) != version:
            raise RevisionConflict(kind="application user", id=subject_id)
        assignment = next(
            (a for a in await ws.repos.organizations.assignments(product_id) if a.organization_id == organization.id),
            None,
        )
        if assignment is None:
            raise ValidationFailed(
                [FieldError("/", "Give this Organization a Tier variant in this Product before adding its application users.")]
            )
        facts = await self._facts(ws, product_id)
        # Personal terms belong to the variant: stale ones are not "stored" for the new one.
        stored_terms = current.terms if current and current.variant_id == assignment.variant_id else {}
        errors = term_errors(facts.privileges, wanted.terms, stored_terms)
        errors.extend(grant_errors(facts.privileges, wanted.grants, current.grants if current else {}))
        if errors:
            raise ValidationFailed(errors)
        saved = ApplicationUserRecord(
            workspace_id=ws.actor.workspace_id,
            product_id=product_id,
            organization_id=organization.id,
            subject_id=subject_id,
            name=name,
            variant_id=assignment.variant_id,
            terms=dict(wanted.terms),
            grants=dict(wanted.grants),
            version=version + 1,
        )
        changed = _exceptions(current) != _exceptions(saved)
        why = normalized_reason(reason)
        if changed and why is None:
            raise ValidationFailed([FieldError("/reason", "Add a reason for changing Personal terms or Grants.")])
        try:
            await ws.repos.organizations.save_user(saved, expected_version=version)
        except (StaleVersion, AlreadyExists) as exc:
            raise RevisionConflict(kind="application user", id=subject_id) from exc
        await self._audit_user(ws, current, saved, why if changed else None)
        return await self.view(ws)

    async def remove_user(
        self,
        ws: OpenWorkspace,
        organization_id: str,
        product_id: UUID,
        subject_id: str,
        *,
        version: int,
        reason: str | None = None,
    ) -> OrganizationsView:
        """Remove an application user's record: it inherits the Organization's values again.

        Allowed on Cloud Pro too, so a downgraded Workspace can clear records it can no longer change.
        """
        organization, current = await self._user_target(ws, organization_id, product_id, subject_id)
        if current is None:
            raise NotFound("This application user has no record in this Product.")
        if current.version != version:
            raise RevisionConflict(kind="application user", id=subject_id)
        changed = _exceptions(current) != _exceptions(None)
        why = normalized_reason(reason)
        if changed and why is None:
            raise ValidationFailed([FieldError("/reason", "Add a reason for removing Personal terms or Grants.")])
        try:
            await ws.repos.organizations.delete_user(current, expected_version=version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="application user", id=subject_id) from exc
        await self._audit_user(ws, current, None, why if changed else None)
        return await self.view(ws)
