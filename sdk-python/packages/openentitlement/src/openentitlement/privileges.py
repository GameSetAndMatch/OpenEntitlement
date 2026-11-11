"""Privilege Catalog models: Privileges, Groups and Tags, separate from the OEREP v1 wire API.

These are Pydantic models (ADR-0006). Python attributes are snake_case (``group_id``);
JSON, JSON Schema and FastAPI responses use camelCase aliases (``groupId``).
Validation accepts either spelling, so Python callers and JSON clients each use
their own convention.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import (
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    StringConstraints,
    TypeAdapter,
    model_validator,
    model_serializer,
)

from .model import OpenEntitlementModel

MAX_SAFE_INTEGER = 2**53 - 1

Identifier = Annotated[StrictStr, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", max_length=80)]
Title = Annotated[StrictStr, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[StrictStr, StringConstraints(max_length=2000)]
SafeInteger = Annotated[StrictInt, Field(ge=-MAX_SAFE_INTEGER, le=MAX_SAFE_INTEGER)]
"""An integer that is exact in every supported language. Negative values are allowed."""
EnvironmentVariable = Annotated[StrictStr, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]*$")]


class Visibility(str, Enum):
    HIDDEN = "hidden"
    READ_ONLY = "read_only"
    EDITABLE = "editable"


class CatalogModel(OpenEntitlementModel):
    """The shared model configuration (immutable, no unknown fields, camelCase JSON), plus validated defaults."""

    model_config = ConfigDict(validate_default=True, use_enum_values=False)

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema: Any, handler: Any) -> dict[str, Any]:
        schema = handler(core_schema)
        # Optional means absent on the Catalog wire, never an explicit JSON null.
        for field in schema.get("properties", {}).values():
            if "anyOf" in field:
                choices = [choice for choice in field["anyOf"] if choice != {"type": "null"}]
                if len(choices) == 1:
                    field.pop("anyOf")
                    field.update(choices[0])
                else:
                    field["anyOf"] = choices
            if field.get("default", ...) is None:
                field.pop("default")
        return schema

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_nulls(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(v is None for v in value.values()):
            raise ValueError("Omit absent Catalog fields rather than supplying null")
        return value

    @model_serializer(mode="wrap")
    def _omit_absent(self, handler: Any) -> dict[str, Any]:
        return {key: value for key, value in handler(self).items() if value is not None}

    def to_dict(self) -> dict[str, Any]:
        """The Catalog JSON shape, with camelCase keys."""
        return self.model_dump(mode="json", exclude_none=True)

    def to_json(self) -> str:
        return self.model_dump_json(exclude_none=True)


class Group(CatalogModel):
    id: Identifier
    title: Title
    description: Description = ""
    parent_id: Optional[Identifier] = None

    @model_validator(mode="after")
    def _not_its_own_parent(self) -> Group:
        if self.parent_id == self.id:
            raise ValueError("A Group cannot contain itself")
        return self


class Tag(CatalogModel):
    id: Identifier
    title: Title
    description: Description = ""


class Privilege(CatalogModel):
    """Base for the typed Privileges. Use BooleanPrivilege, IntegerPrivilege or StringEnumPrivilege."""

    key: Identifier
    title: Title
    description: Description = ""
    visibility: Visibility = Visibility.EDITABLE
    group_id: Optional[Identifier] = None
    tags: tuple[Identifier, ...] = Field(default=(), max_length=50)

    @model_validator(mode="before")
    @classmethod
    def _reject_null_default(cls, value: Any) -> Any:
        if isinstance(value, dict) and "default" in value and value["default"] is None:
            raise ValueError("Use an absent default rather than null")
        return value

    @model_validator(mode="after")
    def _check_privilege(self) -> Privilege:
        if type(self) is Privilege:
            raise ValueError("Use BooleanPrivilege, IntegerPrivilege or StringEnumPrivilege")
        if len(set(self.tags)) != len(self.tags):
            raise ValueError("Privilege tags must be unique Tag identifiers")
        return self

    def _require_default(self, default: Any, *, environment: bool = False) -> None:
        if (self.visibility is not Visibility.EDITABLE or environment) and default is None:
            raise ValueError("Hidden, read-only and environment-linked Privileges need a default")

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> Privilege:
        return _PRIVILEGE_ADAPTER.validate_python(value)


class BooleanPrivilege(Privilege):
    type: Literal["boolean"] = "boolean"
    default: Optional[StrictBool] = None
    env_override: Optional[EnvironmentVariable] = None

    @model_validator(mode="after")
    def _check_boolean(self) -> BooleanPrivilege:
        self._require_default(self.default, environment=self.env_override is not None)
        return self


class Unlimited(CatalogModel):
    """The explicit absence of a cap. JSON: ``{"unlimited": true}``."""

    unlimited: Literal[True]

    @model_validator(mode="before")
    @classmethod
    def _explicit_true(cls, value: Any) -> Any:
        if isinstance(value, dict) and value.get("unlimited") is not True:
            raise ValueError("Unlimited requires explicit boolean true")
        return value


class IntegerPrivilege(Privilege):
    type: Literal["integer"] = "integer"
    default: Optional[Union[SafeInteger, Unlimited]] = None
    minimum: SafeInteger = 0
    maximum: Optional[SafeInteger] = None
    unlimited: StrictBool = False

    @model_validator(mode="after")
    def _check_integer(self) -> IntegerPrivilege:
        if self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Minimum cannot exceed maximum")
        if isinstance(self.default, Unlimited):
            if not self.unlimited:
                raise ValueError("Unlimited is not allowed")
        elif self.default is not None:
            upper = self.maximum if self.maximum is not None else MAX_SAFE_INTEGER
            if not self.minimum <= self.default <= upper:
                raise ValueError("Integer Privilege default is out of bounds")
        self._require_default(self.default)
        return self


class StringEnumPrivilege(Privilege):
    type: Literal["enum"] = "enum"
    enum: tuple[Annotated[StrictStr, StringConstraints(max_length=200)], ...] = Field(min_length=1, max_length=100)
    default: Optional[StrictStr] = None

    @model_validator(mode="after")
    def _check_enum(self) -> StringEnumPrivilege:
        if len(set(self.enum)) != len(self.enum):
            raise ValueError("String enum requires unique string choices")
        if self.default is not None and self.default not in self.enum:
            raise ValueError("String enum default must be one of its choices")
        self._require_default(self.default)
        return self


TypedPrivilege = Annotated[Union[BooleanPrivilege, IntegerPrivilege, StringEnumPrivilege], Field(discriminator="type")]
_PRIVILEGE_ADAPTER: TypeAdapter[Privilege] = TypeAdapter(TypedPrivilege)


class PrivilegeCatalog(CatalogModel):
    privileges: tuple[TypedPrivilege, ...]
    groups: tuple[Group, ...] = ()
    tags: tuple[Tag, ...] = ()

    @model_validator(mode="after")
    def _check_catalog(self) -> PrivilegeCatalog:
        for label, ids in (
            ("Privilege", [p.key for p in self.privileges]),
            ("Group", [g.id for g in self.groups]),
            ("Tag", [t.id for t in self.tags]),
        ):
            if len(ids) != len(set(ids)):
                raise ValueError(f"Duplicate {label} identifier")
        groups = {g.id: g for g in self.groups}
        tags = {t.id for t in self.tags}
        for group in self.groups:
            seen = {group.id}
            parent = group.parent_id
            while parent is not None:
                if parent in seen:
                    raise ValueError("Group hierarchy contains a cycle")
                seen.add(parent)
                if parent not in groups:
                    raise ValueError("Unknown parent Group")
                parent = groups[parent].parent_id
        for privilege in self.privileges:
            if privilege.group_id is not None and privilege.group_id not in groups:
                raise ValueError("Privilege references an unknown Group")
            if any(tag not in tags for tag in privilege.tags):
                raise ValueError("Privilege references an unknown Tag")
        return self

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> PrivilegeCatalog:
        return cls.model_validate(value)
