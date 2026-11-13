"""Organizations, their Tier variant per Product and Organization terms (ADR-0008, OPE-41).

An Organization is one customer of the Workspace: every member sees its name. For each Product it
buys it has one Tier variant, a contract status and Organization terms that belong to that
variant. Its values are resolved by the SDK's resolution engine (spec §3), so the console and
applications cannot disagree: the contract status first picks the variant in effect (the Tier's
grace variant while past-due grace lasts, then the Product's status policy), then
``resolve_from_facts`` resolves every Privilege from that variant and the Organization terms.

Writes to an Organization's variant in a Product take the Product lock that Catalog and Tier
writes take, so a Catalog change can never invalidate terms saved concurrently, and a Tier cannot
be deleted while an Organization is being given one of its variants.
"""
from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

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
from pydantic import Field, JsonValue, TypeAdapter, ValidationError

from .access import Permission
from .catalog import CatalogValue, VariantValues, value_error
from .problems import AlreadyTaken, FieldError, NotFound, RevisionConflict, ValidationFailed, escape_pointer_token
from .repositories import AlreadyExists, StaleVersion
from .tiers import DEFAULT_POLICY, StatusPolicy, TierRecord
from .workspaces import OpenWorkspace

ContractStatus = Literal["active", "past_due", "ended"]
MAX_REASON = 2000


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


class AssignmentInput(OpenEntitlementModel):
    variant_id: Identifier
    status: ContractStatus = "active"
    terms: dict[str, CatalogValue] = Field(default_factory=dict)


ValueSource = Literal["default", "variant", "organizationTerms", "gracePeriod", "environment", "error"]


class ResolvedValue(OpenEntitlementModel):
    """One Privilege's value for an Organization, and where it comes from in glossary terms."""

    privilege: str
    value: CatalogValue | None
    source: ValueSource
    #: "Catalog default", the variant's name, "Organization terms", "Grace period" or the environment prerequisite.
    source_name: str
    error: str | None = None


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


class OrganizationView(OpenEntitlementModel):
    id: str
    name: str
    version: int
    #: Only the Products where the viewer has a Role.
    products: tuple[AssignmentView, ...]


class OrganizationsView(OpenEntitlementModel):
    organizations: tuple[OrganizationView, ...]


class OrganizationChange(OpenEntitlementModel):
    """An immutable audit fact about an Organization or its Tier variant in a Product."""

    id: UUID
    workspace_id: UUID
    #: Set for a change to the Organization's variant, status or terms in one Product.
    product_id: UUID | None
    actor_id: UUID
    actor_email: str
    at: datetime
    target: Literal["organization", "assignment"]
    key: str
    action: Literal["created", "changed"]
    before: dict[str, JsonValue] | None
    after: dict[str, JsonValue] | None
    #: Why Organization terms changed; required exactly then.
    reason: str | None = None


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


@dataclass(frozen=True)
class _Facts:
    """One Organization's facts in one Product, as the SDK's ``FactSource`` reads them.

    Each Tier variant is a plan of its own family, and Organization terms are Organization-scoped
    overrides of the variant in effect. A Read-only Privilege has neither: it uses its Catalog
    default (RFC-0002).
    """

    organization_id: str
    variants: Mapping[str, VariantValues]
    plan_id: str
    terms: Mapping[str, CatalogValue]
    read_only: frozenset[str]

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
        if privilege in self.read_only or privilege not in self.terms:
            return []
        return [
            Override(
                id=f"organization-terms:{privilege}",
                scope=Scope(organization_id=organization_id),
                privilege=privilege,
                value=_sdk_value(self.terms[privilege]),
                plan_family=self.plan_id,
                reason="Organization terms",
            )
        ]

    def grants(self, organization_id: str, privilege: str) -> Sequence[Grant]:
        return []


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


def resolve(assignment: AssignmentRecord, facts: ProductFacts, now: datetime) -> tuple[InEffect, tuple[ResolvedValue, ...]]:
    """Every Privilege of the Product for the Organization, resolved by the SDK engine."""
    effect = in_effect(assignment, facts, now)
    # Organization terms belong to the assigned variant: a grace or fallback variant replaces them.
    applies = effect.variant_id == assignment.variant_id and not effect.fallback
    source = _Facts(
        organization_id=assignment.organization_id,
        variants=facts.variants,
        plan_id=effect.variant_id,
        terms=assignment.terms if applies else {},
        read_only=frozenset(p.key for p in facts.privileges if p.visibility is Visibility.READ_ONLY),
    )
    context = EvaluationContext(organization_id=assignment.organization_id, now=now)
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
        if details.reason is Reason.OVERRIDE:
            kind, name = "organizationTerms", "Organization terms"
        elif details.reason is Reason.PLAN and effect.grace:
            kind, name = "gracePeriod", "Grace period"
        elif details.reason is Reason.PLAN:
            kind, name = "variant", variant.name if variant else effect.variant_id
        else:
            kind, name = "default", "Catalog default"
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


def normalized_reason(reason: str | None) -> str | None:
    text = (reason or "").strip()
    if len(text) > MAX_REASON:
        raise ValidationFailed([FieldError("/reason", f"Use at most {MAX_REASON} characters.")])
    return text or None


def _dump(model: OpenEntitlementModel) -> dict[str, JsonValue]:
    data: dict[str, JsonValue] = model.model_dump(mode="json", by_alias=True)
    return data


class OrganizationService:
    def __init__(self, environment: Mapping[str, str] | None = None) -> None:
        self.environment = dict(environment or {})

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
        facts: dict[UUID, ProductFacts] = {}
        organizations = []
        for organization in sorted(await ws.repos.organizations.list(), key=lambda o: (o.name.casefold(), o.id)):
            products = []
            for assignment in sorted(assignments.get(organization.id, []), key=lambda a: str(a.product_id)):
                if assignment.product_id not in facts:
                    facts[assignment.product_id] = await self._facts(ws, assignment.product_id)
                effect, values = resolve(assignment, facts[assignment.product_id], ws.now)
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
                    )
                )
            organizations.append(
                OrganizationView(id=organization.id, name=organization.name, version=organization.version, products=tuple(products))
            )
        return OrganizationsView(organizations=tuple(organizations))

    async def _audit(
        self,
        ws: OpenWorkspace,
        *,
        product_id: UUID | None,
        target: Literal["organization", "assignment"],
        key: str,
        action: Literal["created", "changed"],
        before: dict[str, JsonValue] | None,
        after: dict[str, JsonValue] | None,
        reason: str | None = None,
    ) -> None:
        await ws.repos.organizations.audit(
            OrganizationChange(
                id=uuid4(),
                workspace_id=ws.actor.workspace_id,
                product_id=product_id,
                actor_id=ws.actor.account.id,
                actor_email=ws.actor.account.email,
                at=ws.now,
                target=target,
                key=key,
                action=action,
                before=before,
                after=after,
                reason=reason,
            )
        )

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
        await self._audit(
            ws, product_id=None, target="organization", key=id, action="created", before=None, after=_dump(organization)
        )
        if product_id is not None and assignment is not None:
            await self._assign(ws, organization, product_id, assignment, version=0, reason=reason, pointer="/assignment")
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
        await self._audit(
            ws, product_id=None, target="organization", key=organization_id, action="changed",
            before=_dump(current), after=_dump(changed),
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
        await self._assign(ws, organization, product_id, assignment, version=version, reason=reason, pointer="")
        return await self.view(ws)

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
    ) -> None:
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
        await self._audit(
            ws,
            product_id=product_id,
            target="assignment",
            key=organization.id,
            action="changed" if current else "created",
            before=_dump(current) if current else None,
            after=_dump(saved),
            reason=why if terms_changed else None,
        )
