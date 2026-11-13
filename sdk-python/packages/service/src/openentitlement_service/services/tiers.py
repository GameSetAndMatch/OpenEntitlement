"""Tiers and Tier variants per Product, with archiving (ADR-0008, OPE-40).

Every write takes the Catalog's Product lock first and reads the Catalog in the same transaction,
so a Privilege without a default and a new Tier variant can never be saved concurrently without
the variant's value. Variants are stored by the Catalog repository (``VariantValues``), which the
Catalog also writes when a required Privilege supplies values for every variant.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from openentitlement.model import OpenEntitlementModel
from openentitlement.privileges import Identifier, Privilege, Title, TypedPrivilege, Visibility

from pydantic import Field, JsonValue, ValidationError, model_serializer, model_validator

from .access import Permission
from .catalog import CatalogValue, VariantKind, VariantValues, value_error
from .problems import AlreadyTaken, FieldError, NotFound, RevisionConflict, TierInUse, ValidationFailed, escape_pointer_token
from .repositories import AlreadyExists, StaleVersion
from .workspaces import OpenWorkspace

MAX_GRACE_DAYS = 365


class TierRecord(OpenEntitlementModel):
    """An offer such as Basic or Pro in one Product. Its variants hold the values."""

    workspace_id: UUID
    product_id: UUID
    id: Identifier
    name: Title
    #: Higher ranks are higher Tiers; upgrade suggestions use it (spec §3.4).
    rank: int = Field(ge=0, strict=True)
    #: Days a past-due Organization keeps the Tier's grace variant.
    grace_period_days: int = Field(ge=0, le=MAX_GRACE_DAYS, strict=True)
    #: Archived Tiers keep serving their Organizations but are never given to new ones.
    archived_at: datetime | None = None
    version: int = Field(ge=1, strict=True)


class NewTier(OpenEntitlementModel):
    id: Identifier
    name: Title
    #: Defaults to one above the Product's highest rank.
    rank: int | None = Field(default=None, ge=0, strict=True)


class VariantInput(OpenEntitlementModel):
    id: Identifier
    name: Title
    kind: VariantKind = "standard"
    #: Values that differ from the Catalog defaults, by Privilege key.
    values: dict[str, CatalogValue] = Field(default_factory=dict)


class PolicyAction(OpenEntitlementModel):
    """Keep the values read-only, or move the Organization to a fallback variant of the Product."""

    action: Literal["readOnly", "fallback"]
    variant_id: Identifier | None = None

    @model_validator(mode="after")
    def fallback_names_a_variant(self) -> PolicyAction:
        if (self.action == "fallback") != (self.variant_id is not None):
            raise ValueError("A fallback names its variant; read-only names none")
        return self

    @model_serializer(mode="wrap")
    def _omit_absent_variant(self, handler: Any) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        return {key: value for key, value in data.items() if value is not None}


class StatusPolicy(OpenEntitlementModel):
    """What an Organization gets once its Tier's grace runs out (past due) or its contract ends."""

    past_due: PolicyAction
    ended: PolicyAction


DEFAULT_POLICY = StatusPolicy(past_due=PolicyAction(action="readOnly"), ended=PolicyAction(action="readOnly"))


class StatusPolicyRecord(OpenEntitlementModel):
    workspace_id: UUID
    product_id: UUID
    policy: StatusPolicy
    version: int = Field(ge=1, strict=True)


class TiersView(OpenEntitlementModel):
    tiers: tuple[TierRecord, ...]
    variants: tuple[VariantValues, ...]
    policy: StatusPolicy
    #: 0 until the policy is first saved.
    policy_version: int


class TierChange(OpenEntitlementModel):
    """An immutable audit fact about a Tier, a Tier variant or the status policy."""

    id: UUID
    workspace_id: UUID
    product_id: UUID
    actor_id: UUID
    actor_email: str
    at: datetime
    target: Literal["tier", "variant", "status-policy"]
    key: str
    action: Literal["created", "changed", "archived", "restored", "deleted"]
    before: dict[str, JsonValue] | None
    after: dict[str, JsonValue] | None


def upgrade_candidates(tiers: Iterable[TierRecord], current: str | None) -> list[TierRecord]:
    """Tiers an Organization on ``current`` could upgrade to, lowest rank first (spec §3.4).

    Archived Tiers are never candidates (ADR-0008).
    """
    tiers = list(tiers)
    floor = next((t.rank for t in tiers if t.id == current), None)
    found = [t for t in tiers if t.archived_at is None and t.id != current and (floor is None or t.rank > floor)]
    return sorted(found, key=lambda t: (t.rank, t.id))


def _pointer(*tokens: str) -> str:
    return "".join("/" + escape_pointer_token(t) for t in tokens)


def _dump(model: OpenEntitlementModel) -> dict[str, JsonValue]:
    data: dict[str, JsonValue] = model.model_dump(mode="json", by_alias=True)
    return data


def variant_value_errors(
    privileges: Sequence[TypedPrivilege],
    variant_name: str,
    values: Mapping[str, CatalogValue],
    stored: Mapping[str, CatalogValue],
    prefix: str,
) -> tuple[dict[str, CatalogValue], list[FieldError]]:
    """The values to store for a variant, or why they are invalid.

    A Tier uses only its Product's Privileges. A Privilege without a default needs a value. A
    Read-only Privilege uses its Catalog default (RFC-0002): a stored value stays as it is and has
    no effect, so a variant may resend it unchanged, but cannot set or change one.
    """
    by_key = {p.key: p for p in privileges}
    errors = [
        FieldError(prefix + _pointer("values", key), "Unknown Privilege in this Product.")
        for key in sorted(values.keys() - by_key.keys())
    ]
    result: dict[str, CatalogValue] = {}
    for key, entry in sorted(by_key.items()):
        pointer = prefix + _pointer("values", key)
        if entry.visibility is Visibility.READ_ONLY:
            if key in values and (key not in stored or values[key] != stored[key]):
                errors.append(FieldError(pointer, "A Read-only Privilege uses its Catalog default; omit this value."))
            if key in stored:
                result[key] = stored[key]
            continue
        if key not in values:
            if getattr(entry, "default", None) is None:
                errors.append(FieldError(pointer, f"{variant_name}: set a value. {entry.title} has no Catalog default."))
            continue
        problem = value_error(entry, values[key])
        if problem:
            errors.append(FieldError(pointer, f"{variant_name}: {problem}"))
            continue
        result[key] = values[key]
    return result, errors


class TierService:
    async def _open(self, ws: OpenWorkspace, product_id: UUID, permission: Permission) -> None:
        ws.actor.require(permission, product_id)
        # The Catalog's Product lock: Catalog saves and Tier writes of one Product run one at a time.
        await ws.repos.catalog.lock(product_id)
        if await ws.repos.products.get(product_id) is None:
            raise NotFound("This Product does not exist or you have no Role in it.")

    async def view(self, ws: OpenWorkspace, product_id: UUID) -> TiersView:
        await self._open(ws, product_id, Permission.READ_PRODUCT)
        return await self._view(ws, product_id)

    async def _view(self, ws: OpenWorkspace, product_id: UUID) -> TiersView:
        policy = await ws.repos.tiers.policy(product_id)
        return TiersView(
            tiers=tuple(sorted(await ws.repos.tiers.list(product_id), key=lambda t: (t.rank, t.id))),
            variants=tuple(await ws.repos.catalog.variants(product_id)),
            policy=policy.policy if policy else DEFAULT_POLICY,
            policy_version=policy.version if policy else 0,
        )

    async def _privileges(self, ws: OpenWorkspace, product_id: UUID) -> list[TypedPrivilege]:
        return [r.entry for r in await ws.repos.catalog.list(product_id) if isinstance(r.entry, Privilege)]

    async def _tier(self, ws: OpenWorkspace, product_id: UUID, tier_id: str, version: int | None = None) -> TierRecord:
        tier = next((t for t in await ws.repos.tiers.list(product_id) if t.id == tier_id), None)
        if tier is None:
            raise NotFound("This Tier does not exist in the Product.")
        if version is not None and tier.version != version:
            raise RevisionConflict(kind="Tier", id=tier_id)
        return tier

    async def _audit(
        self,
        ws: OpenWorkspace,
        product_id: UUID,
        target: Literal["tier", "variant", "status-policy"],
        key: str,
        action: Literal["created", "changed", "archived", "restored", "deleted"],
        before: dict[str, JsonValue] | None,
        after: dict[str, JsonValue] | None,
    ) -> None:
        await ws.repos.tiers.audit(
            TierChange(
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
            )
        )

    async def create(self, ws: OpenWorkspace, product_id: UUID, tier: NewTier, standard: VariantInput) -> TiersView:
        """Create the Tier and its standard variant in one transaction: never a Tier without its variant."""
        await self._open(ws, product_id, Permission.EDIT_PRODUCT)
        existing = await ws.repos.tiers.list(product_id)
        if any(t.id == tier.id for t in existing):
            raise AlreadyTaken(f"Another Tier already uses the ID {tier.id}.", kind="Tier", key=tier.id)
        if any(v.id == standard.id for v in await ws.repos.catalog.variants(product_id)):
            raise AlreadyTaken(f"Another variant already uses the ID {standard.id}.", kind="Tier variant", key=standard.id)
        values, errors = variant_value_errors(
            await self._privileges(ws, product_id), standard.name, standard.values, {}, "/standard"
        )
        if errors:
            raise ValidationFailed(errors)
        record = TierRecord(
            workspace_id=ws.actor.workspace_id,
            product_id=product_id,
            id=tier.id,
            name=tier.name,
            rank=tier.rank if tier.rank is not None else max((t.rank + 1 for t in existing), default=0),
            grace_period_days=0,
            version=1,
        )
        variant = VariantValues(
            workspace_id=ws.actor.workspace_id,
            product_id=product_id,
            id=standard.id,
            tier_id=tier.id,
            kind="standard",
            name=standard.name,
            values=values,
            version=1,
        )
        try:
            await ws.repos.tiers.save(record, expected_version=0)
            await ws.repos.catalog.save_variant(variant, expected_version=0)
        except (AlreadyExists, StaleVersion) as exc:
            raise RevisionConflict(kind="Tier", id=tier.id) from exc
        await self._audit(
            ws, product_id, "tier", tier.id, "created", None, {"tier": _dump(record), "variants": [_dump(variant)]}
        )
        return await self._view(ws, product_id)

    async def update(
        self, ws: OpenWorkspace, product_id: UUID, tier_id: str, *, name: str, rank: int, grace_period_days: int, version: int
    ) -> TiersView:
        await self._open(ws, product_id, Permission.EDIT_PRODUCT)
        current = await self._tier(ws, product_id, tier_id, version)
        try:
            changed = TierRecord.model_validate(
                current.model_dump(by_alias=True)
                | {"name": name, "rank": rank, "gracePeriodDays": grace_period_days, "version": version + 1}
            )
        except ValidationError as exc:
            raise ValidationFailed([FieldError(_pointer(*map(str, e["loc"])), e["msg"]) for e in exc.errors()]) from exc
        return await self._persist(ws, current, changed, "changed")

    async def archive(self, ws: OpenWorkspace, product_id: UUID, tier_id: str, *, version: int) -> TiersView:
        """Archive: it keeps serving its Organizations with all its variants; it is never given to new ones."""
        await self._open(ws, product_id, Permission.EDIT_PRODUCT)
        current = await self._tier(ws, product_id, tier_id, version)
        changed = current.model_copy(update={"archived_at": current.archived_at or ws.now, "version": version + 1})
        return await self._persist(ws, current, changed, "archived")

    async def restore(self, ws: OpenWorkspace, product_id: UUID, tier_id: str, *, version: int) -> TiersView:
        await self._open(ws, product_id, Permission.EDIT_PRODUCT)
        current = await self._tier(ws, product_id, tier_id, version)
        changed = current.model_copy(update={"archived_at": None, "version": version + 1})
        return await self._persist(ws, current, changed, "restored")

    async def _persist(
        self, ws: OpenWorkspace, current: TierRecord, changed: TierRecord, action: Literal["changed", "archived", "restored"]
    ) -> TiersView:
        try:
            await ws.repos.tiers.save(changed, expected_version=current.version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="Tier", id=current.id) from exc
        await self._audit(ws, current.product_id, "tier", current.id, action, {"tier": _dump(current)}, {"tier": _dump(changed)})
        return await self._view(ws, current.product_id)

    async def delete(self, ws: OpenWorkspace, product_id: UUID, tier_id: str, *, version: int) -> TiersView:
        """Delete a Tier that no Organization uses, with its variants."""
        await self._open(ws, product_id, Permission.EDIT_PRODUCT)
        current = await self._tier(ws, product_id, tier_id, version)
        if await ws.repos.tiers.in_use(product_id, tier_id):
            raise TierInUse(id=tier_id)
        variants = [v for v in await ws.repos.catalog.variants(product_id) if v.tier_id == tier_id]
        policy = await ws.repos.tiers.policy(product_id)
        for action in (policy.policy.past_due, policy.policy.ended) if policy else ():
            if action.variant_id in {v.id for v in variants}:
                raise TierInUse(id=tier_id, variant_id=action.variant_id)
        try:
            for variant in variants:
                await ws.repos.catalog.delete_variant(product_id, variant.id, expected_version=variant.version)
            await ws.repos.tiers.delete(product_id, tier_id, expected_version=version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="Tier", id=tier_id) from exc
        await self._audit(
            ws, product_id, "tier", tier_id, "deleted", {"tier": _dump(current), "variants": [_dump(v) for v in variants]}, None
        )
        return await self._view(ws, product_id)

    async def save_variant(
        self, ws: OpenWorkspace, product_id: UUID, tier_id: str, variant: VariantInput, *, version: int
    ) -> TiersView:
        """Create (version 0) or edit a Tier variant. Its Tier and purpose never change; one per purpose per Tier."""
        await self._open(ws, product_id, Permission.EDIT_PRODUCT)
        await self._tier(ws, product_id, tier_id)
        variants = await ws.repos.catalog.variants(product_id)
        current = next((v for v in variants if v.id == variant.id), None)
        if (current.version if current else 0) != version:
            raise RevisionConflict(kind="Tier variant", id=variant.id)
        if current and current.tier_id != tier_id:
            raise ValidationFailed([FieldError("/tierId", "A variant's Tier cannot change. Create a new variant instead.")])
        if current and current.kind != variant.kind:
            raise ValidationFailed([FieldError("/kind", "A variant's purpose cannot change. Create a new variant instead.")])
        if any(v.tier_id == tier_id and v.kind == variant.kind and v.id != variant.id for v in variants):
            raise ValidationFailed([FieldError("/kind", f"This Tier already has a {variant.kind} variant.")])
        values, errors = variant_value_errors(
            await self._privileges(ws, product_id), variant.name, variant.values, current.values if current else {}, ""
        )
        if errors:
            raise ValidationFailed(errors)
        saved = VariantValues(
            workspace_id=ws.actor.workspace_id,
            product_id=product_id,
            id=variant.id,
            tier_id=tier_id,
            kind=variant.kind,
            name=variant.name,
            values=values,
            version=version + 1,
        )
        try:
            await ws.repos.catalog.save_variant(saved, expected_version=version)
        except (StaleVersion, AlreadyExists) as exc:
            raise RevisionConflict(kind="Tier variant", id=variant.id) from exc
        await self._audit(
            ws,
            product_id,
            "variant",
            variant.id,
            "changed" if current else "created",
            _dump(current) if current else None,
            _dump(saved),
        )
        return await self._view(ws, product_id)

    async def set_policy(self, ws: OpenWorkspace, product_id: UUID, policy: StatusPolicy, *, version: int) -> TiersView:
        """A fallback must be a variant of this Product whose Tier is not archived."""
        await self._open(ws, product_id, Permission.EDIT_PRODUCT)
        current = await ws.repos.tiers.policy(product_id)
        if (current.version if current else 0) != version:
            raise RevisionConflict(kind="status policy", id=str(product_id))
        variants = {v.id: v for v in await ws.repos.catalog.variants(product_id)}
        archived = {t.id for t in await ws.repos.tiers.list(product_id) if t.archived_at is not None}
        errors = []
        for member, action in (("pastDue", policy.past_due), ("ended", policy.ended)):
            if action.variant_id is None:
                continue
            found = variants.get(action.variant_id)
            if found is None:
                errors.append(FieldError(_pointer(member, "variantId"), "Choose a variant of this Product."))
            elif found.tier_id in archived:
                errors.append(FieldError(_pointer(member, "variantId"), "This variant's Tier is archived."))
        if errors:
            raise ValidationFailed(errors)
        record = StatusPolicyRecord(
            workspace_id=ws.actor.workspace_id, product_id=product_id, policy=policy, version=version + 1
        )
        try:
            await ws.repos.tiers.save_policy(record, expected_version=version)
        except (StaleVersion, AlreadyExists) as exc:
            raise RevisionConflict(kind="status policy", id=str(product_id)) from exc
        await self._audit(
            ws,
            product_id,
            "status-policy",
            str(product_id),
            "changed",
            _dump(current.policy) if current else None,
            _dump(policy),
        )
        return await self._view(ws, product_id)
