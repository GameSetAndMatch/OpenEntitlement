"""Product Catalog operations using the SDK's canonical authoring models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, cast
from uuid import UUID, uuid4

from openentitlement.model import OpenEntitlementModel
from openentitlement.privileges import Group, Tag, Privilege, TypedPrivilege, PrivilegeCatalog, Unlimited, Identifier, Visibility
from pydantic import Field, StrictBool, StrictInt, StrictStr, ValidationError, model_validator

from .access import Permission
from .problems import FieldError, NotFound, PermissionDenied, RevisionConflict, ValidationFailed, escape_pointer_token, input_pointer
from .repositories import AlreadyExists, StaleVersion
from .workspaces import OpenWorkspace

CatalogKind = Literal["groups", "tags", "privileges"]
CatalogEntry = Group | Tag | TypedPrivilege


def typed_entry(kind: CatalogKind, data: dict[str, object]) -> CatalogEntry:
    if kind == "groups":
        return Group.model_validate(data)
    if kind == "tags":
        return Tag.model_validate(data)
    return cast(TypedPrivilege, Privilege.from_dict(data))


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
            data["entry"] = typed_entry(data["kind"], entry)
            return data
        return value


CatalogValue = StrictBool | StrictInt | StrictStr | Unlimited


class VariantValue(OpenEntitlementModel):
    version: int = Field(ge=1, strict=True)
    value: CatalogValue


VariantKind = Literal["standard", "trial", "grace"]


class VariantValues(OpenEntitlementModel):
    """A Tier variant and its values. The Catalog writes its values; the Tier service its lifecycle (OPE-40)."""

    workspace_id: UUID
    product_id: UUID
    id: Identifier
    tier_id: Identifier
    kind: VariantKind
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

    @model_validator(mode="before")
    @classmethod
    def typed_entries(cls, value: object) -> object:
        # Groups and Tags share a shape, so stored entries are typed by their kind.
        if isinstance(value, dict) and "kind" in value:
            data = dict(value)
            for member in ("before", "after"):
                if isinstance(data.get(member), dict):
                    data[member] = typed_entry(data["kind"], data[member])
            return data
        return value


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


# Model-level Catalog rules that concern one member of the submitted entry.
_RULE_MEMBERS = {
    "Integer Privilege default is out of bounds": "default",
    "Unlimited is not allowed": "default",
    "String enum default must be one of its choices": "default",
    "Hidden, read-only and environment-linked Privileges need a default": "default",
    "Use an absent default rather than null": "default",
    "Minimum cannot exceed maximum": "minimum",
    "String enum requires unique string choices": "enum",
    "Privilege tags must be unique Tag identifiers": "tags",
    "A Group cannot contain itself": "parentId",
}


def entry_errors(exc: ValidationError, data: object, prefix: str = "", *, discriminated: bool = False) -> list[FieldError]:
    """Field errors with JSON Pointers into the submitted ``data`` under ``prefix``.

    ``discriminated`` drops the leading Privilege type branch that ``Privilege.from_dict`` reports.
    """
    errors = []
    for e in exc.errors():
        loc = tuple(e["loc"])
        if discriminated and loc and isinstance(data, dict) and loc[0] == data.get("type"):
            loc = loc[1:]
        pointer = input_pointer(loc, data, e["type"], e.get("ctx"))
        member = _RULE_MEMBERS.get(str((e.get("ctx") or {}).get("error", "")))
        if not pointer and member:
            pointer = "/" + member
        errors.append(FieldError(prefix + pointer, e["msg"]))
    return errors


def validation_problem(exc: ValidationError, data: object, prefix: str = "", *, discriminated: bool = False) -> ValidationFailed:
    return ValidationFailed(entry_errors(exc, data, prefix, discriminated=discriminated))


def _reference_errors(entry: CatalogEntry, records: list[CatalogRecord]) -> list[FieldError]:
    """Unknown or cyclic references made by the submitted entry, at its own members."""
    groups = {r.key: r.entry for r in records if r.kind == "groups" and isinstance(r.entry, Group)}
    if isinstance(entry, Group):
        groups[entry.id] = entry
        if entry.parent_id is None:
            return []
        if entry.parent_id not in groups:
            return [FieldError("/entry/parentId", "Unknown parent Group")]
        seen: set[str] = {entry.id}
        parent: str | None = entry.parent_id
        while parent is not None:
            if parent in seen:
                return [FieldError("/entry/parentId", "Group hierarchy contains a cycle")]
            seen.add(parent)
            ancestor = groups.get(parent)
            parent = ancestor.parent_id if ancestor else None
        return []
    if isinstance(entry, Privilege):
        tags = {r.key for r in records if r.kind == "tags"}
        errors = []
        if entry.group_id is not None and entry.group_id not in groups:
            errors.append(FieldError("/entry/groupId", "Privilege references an unknown Group"))
        errors.extend(
            FieldError(f"/entry/tags/{i}", "Privilege references an unknown Tag")
            for i, tag in enumerate(entry.tags)
            if tag not in tags
        )
        return errors
    return []


def value_error(entry: TypedPrivilege, value: CatalogValue) -> str | None:
    """Why ``value`` is not a valid value of the Privilege, with the same type and bounds rules as its default."""
    data = entry.model_dump(mode="json") | {
        "default": value.model_dump(mode="json") if isinstance(value, Unlimited) else value
    }
    try:
        Privilege.from_dict(data)
    except ValidationError as exc:
        # One message per value: union alternatives would otherwise repeat it.
        first = exc.errors()[0]
        return str((first.get("ctx") or {}).get("error", "")) or first["msg"]
    return None


def _variant_pointer(variant_id: str, *members: str) -> str:
    return "".join("/" + escape_pointer_token(t) for t in ("variantValues", variant_id, *members))


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
            # Stored records are already valid, so a remaining rule concerns the submitted entry.
            raise ValidationFailed([FieldError("/entry", e["msg"]) for e in exc.errors()]) from exc

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
        # Resolution reads the variable an environment prerequisite names: only the install's operator binds one.
        binding = getattr(entry, "env_override", None)
        if binding != (getattr(current.entry, "env_override", None) if current else None) and not ws.actor.account.platform_admin:
            raise PermissionDenied(
                "Only a Platform administrator can change a Privilege's environment prerequisite.",
                permission="catalog:environment",
            )
        record = CatalogRecord(
            workspace_id=ws.actor.workspace_id,
            product_id=product_id,
            kind=kind,
            key=key,
            version=version + 1,
            entry=entry,
        )
        others = [r for r in records if (r.kind, r.key) != (kind, key)]
        reference_errors = _reference_errors(entry, others)
        if reference_errors:
            raise ValidationFailed(reference_errors)
        self._catalog(others + [record])
        supplied = variant_values or {}
        variants = await ws.repos.catalog.variants(product_id)
        unknown = sorted(supplied.keys() - {v.id for v in variants})
        if unknown:
            raise ValidationFailed([FieldError(_variant_pointer(v), "Unknown Tier variant.") for v in unknown])
        if supplied and not isinstance(entry, Privilege):
            raise ValidationFailed([FieldError("/variantValues", "Only a Privilege has variant values.")])
        changes: list[VariantValues] = []
        if isinstance(entry, Privilege):
            errors: list[FieldError] = []
            read_only = entry.visibility is Visibility.READ_ONLY
            for variant in variants:
                override = supplied.get(variant.id)
                if override and override.version != variant.version:
                    raise RevisionConflict(kind="Tier variant", id=variant.id)
                if read_only:
                    # RFC-0002: a Read-only value is the Catalog default, which the entry already
                    # validated. Stored variant values stay as they are and have no effect.
                    if override:
                        errors.append(
                            FieldError(
                                _variant_pointer(variant.id),
                                "A Read-only Privilege uses its Catalog default; omit this variant value.",
                            )
                        )
                    continue
                values = dict(variant.values)
                if override:
                    values[key] = override.value
                value = values.get(key, getattr(entry, "default", None))
                if value is None:
                    errors.append(FieldError(_variant_pointer(variant.id), "Set a value in every Tier variant."))
                    continue
                problem = value_error(entry, value)
                if problem:
                    errors.append(FieldError(_variant_pointer(variant.id, "value"), f"{variant.name}: {problem}"))
                    continue
                if override:
                    changes.append(variant.model_copy(update={"values": values, "version": variant.version + 1}))
            if not read_only:
                # Organization terms must stay valid; a Read-only Privilege's stored terms have no effect.
                names = {o.id: o.name for o in await ws.repos.organizations.list()}
                for assignment in await ws.repos.organizations.assignments(product_id):
                    term = assignment.terms.get(key)
                    problem = value_error(entry, term) if term is not None else None
                    if problem:
                        organization = names.get(assignment.organization_id, assignment.organization_id)
                        errors.append(FieldError("/entry", f"{organization}'s Organization terms would become invalid: {problem}"))
            if errors:
                raise ValidationFailed(errors)
        for changed in changes:
            try:
                await ws.repos.catalog.save_variant(changed, expected_version=changed.version - 1)
            except StaleVersion as exc:
                raise RevisionConflict(kind="Tier variant", id=changed.id) from exc
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
