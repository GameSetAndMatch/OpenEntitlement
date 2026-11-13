"""Product Catalog operations using the SDK's canonical authoring models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from openentitlement.model import OpenEntitlementModel
from openentitlement.privileges import Group, Tag, Privilege, TypedPrivilege, PrivilegeCatalog, Unlimited, Identifier
from pydantic import Field, StrictBool, StrictInt, StrictStr, ValidationError, model_validator

from .access import Permission
from .problems import FieldError, NotFound, RevisionConflict, ValidationFailed
from .repositories import AlreadyExists, StaleVersion
from .workspaces import OpenWorkspace

CatalogKind = Literal["groups", "tags", "privileges"]
CatalogEntry = Group | Tag | TypedPrivilege


class CatalogRecord(OpenEntitlementModel):
    workspace_id: UUID
    product_id: UUID
    kind: CatalogKind
    key: str
    version: int
    entry: CatalogEntry

    @model_validator(mode="before")
    @classmethod
    def typed_entry(cls, value: object) -> object:
        if isinstance(value, dict) and isinstance(value.get("entry"), dict):
            data = dict(value)
            entry = data["entry"]
            data["entry"] = (
                Group.model_validate(entry)
                if data["kind"] == "groups"
                else Tag.model_validate(entry)
                if data["kind"] == "tags"
                else Privilege.from_dict(entry)
            )
            return data
        return value


CatalogValue = StrictBool | StrictInt | StrictStr | Unlimited


class VariantValue(OpenEntitlementModel):
    version: int = Field(ge=1, strict=True)
    value: CatalogValue


class VariantValues(OpenEntitlementModel):
    """The Catalog-facing values of a Tier variant; lifecycle and Tier authoring arrive in OPE-40."""

    workspace_id: UUID
    product_id: UUID
    id: Identifier
    name: str
    version: int = Field(ge=1, strict=True)
    values: dict[str, CatalogValue]


class CatalogChange(OpenEntitlementModel):
    id: UUID
    workspace_id: UUID
    product_id: UUID
    actor_id: UUID
    actor_email: str
    at: datetime
    kind: CatalogKind
    key: str
    title: str
    before: CatalogEntry | None
    after: CatalogEntry
    variant_before: tuple[VariantValues, ...] = ()
    variant_after: tuple[VariantValues, ...] = ()


class CatalogView(OpenEntitlementModel):
    variants: tuple[VariantValues, ...] = ()
    catalog: PrivilegeCatalog
    versions: dict[str, dict[str, int]]


def identity(entry: CatalogEntry) -> tuple[CatalogKind, str]:
    if isinstance(entry, Group):
        return "groups", entry.id
    if isinstance(entry, Tag):
        return "tags", entry.id
    return "privileges", entry.key


def validation_problem(exc: ValidationError, prefix: str = "") -> ValidationFailed:
    return ValidationFailed(
        [
            FieldError(prefix + "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in e["loc"]), e["msg"])
            for e in exc.errors()
        ]
    )


class CatalogService:
    async def _product(self, ws: OpenWorkspace, product_id: UUID, permission: Permission) -> None:
        ws.actor.require(permission, product_id)
        if await ws.repos.products.get(product_id) is None:
            raise NotFound("This Product does not exist or you have no Role in it.")

    async def view(self, ws: OpenWorkspace, product_id: UUID) -> CatalogView:
        await self._product(ws, product_id, Permission.READ_PRODUCT)
        # A coherent snapshot across the three record tables, including concurrent creates.
        await ws.repos.catalog.lock(product_id)
        return await self._view(ws, product_id)

    async def _view(self, ws: OpenWorkspace, product_id: UUID) -> CatalogView:
        records = await ws.repos.catalog.list(product_id)
        catalog = self._catalog(list(records))
        return CatalogView(
            variants=tuple(await ws.repos.catalog.variants(product_id)),
            catalog=catalog,
            versions={
                kind: {r.key: r.version for r in records if r.kind == kind} for kind in ("groups", "tags", "privileges")
            },
        )

    def _catalog(self, records: list[CatalogRecord]) -> PrivilegeCatalog:
        try:
            return PrivilegeCatalog.model_validate(
                {
                    kind: [r.entry.model_dump(mode="json") for r in records if r.kind == kind]
                    for kind in ("groups", "tags", "privileges")
                }
            )
        except ValidationError as exc:
            raise validation_problem(exc) from exc

    async def save(
        self,
        ws: OpenWorkspace,
        product_id: UUID,
        entry: CatalogEntry,
        *,
        version: int,
        variant_values: dict[str, VariantValue] | None = None,
    ) -> CatalogView:
        await self._product(ws, product_id, Permission.EDIT_PRODUCT)
        # Serialize reference checks with other Catalog writes and Product deletion. Versions
        # still belong to individual records, so unrelated edits never cause a conflict.
        await ws.repos.catalog.lock(product_id)
        if await ws.repos.products.get(product_id) is None:
            raise NotFound("This Product does not exist or you have no Role in it.")
        records = list(await ws.repos.catalog.list(product_id))
        kind, key = identity(entry)
        current = next((r for r in records if (r.kind, r.key) == (kind, key)), None)
        if (current.version if current else 0) != version:
            raise RevisionConflict(kind=kind, id=key)
        record = CatalogRecord(
            workspace_id=ws.actor.workspace_id,
            product_id=product_id,
            kind=kind,
            key=key,
            version=version + 1,
            entry=entry,
        )
        self._catalog([r for r in records if (r.kind, r.key) != (kind, key)] + [record])
        supplied = variant_values or {}
        variants = await ws.repos.catalog.variants(product_id)
        if supplied.keys() - {v.id for v in variants}:
            raise ValidationFailed([FieldError("/variantValues", "Unknown Tier variant.")])
        if supplied and not isinstance(entry, Privilege):
            raise ValidationFailed([FieldError("/variantValues", "Only a Privilege has variant values.")])
        if isinstance(entry, Privilege):
            for variant in variants:
                override = supplied.get(variant.id)
                if override and override.version != variant.version:
                    raise RevisionConflict(kind="Tier variant", id=variant.id)
                values = dict(variant.values)
                if override:
                    values[key] = override.value
                value = values.get(key, getattr(entry, "default", None))
                if value is None:
                    raise ValidationFailed(
                        [FieldError("/variantValues/" + variant.id, "Set a value in every Tier variant.")]
                    )
                try:
                    # Validate assigned values with precisely the same bounds/type rules as a default.
                    Privilege.from_dict(
                        entry.model_dump(mode="json")
                        | {"default": value.model_dump(mode="json") if isinstance(value, Unlimited) else value}
                    )
                except ValidationError as exc:
                    raise validation_problem(exc, "/variantValues/" + variant.id) from exc
                if override:
                    changed = variant.model_copy(update={"values": values, "version": variant.version + 1})
                    await ws.repos.catalog.save_variant(changed, expected_version=variant.version)
        try:
            await ws.repos.catalog.save(record, expected_version=version)
        except (StaleVersion, AlreadyExists) as exc:
            raise RevisionConflict(kind=kind, id=key) from exc
        await ws.repos.catalog.audit(
            CatalogChange(
                id=uuid4(),
                workspace_id=ws.actor.workspace_id,
                product_id=product_id,
                actor_id=ws.actor.account.id,
                actor_email=ws.actor.account.email,
                at=ws.now,
                kind=kind,
                key=key,
                title=entry.title,
                before=current.entry if current else None,
                after=entry,
                variant_before=tuple(variants),
                variant_after=tuple(await ws.repos.catalog.variants(product_id)),
            )
        )
        return await self._view(ws, product_id)
