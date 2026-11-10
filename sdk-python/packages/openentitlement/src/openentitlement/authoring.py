"""Optional Pydantic authoring API. Install openentitlement-sdk[authoring].

The core SDK remains dependency-free. Existing dataclasses remain compatible;
these models reuse their domain checks and emit the same Catalog JSON.

Python attributes are snake_case (``group_id``); JSON, JSON Schema and FastAPI
responses use camelCase aliases (``groupId``). Validation accepts either form.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator
from pydantic.alias_generators import to_camel

from . import privileges as domain


Identifier = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=80)]
Title = Annotated[str, Field(min_length=1, max_length=200)]
SafeInteger = Annotated[int, Field(ge=0, le=2**53 - 1)]


class AuthoringModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        validate_default=True,
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )

    def to_dict(self) -> dict[str, Any]:
        """Catalog JSON shape, with camelCase keys."""
        return self.model_dump(mode="json", exclude_none=True)

    def _python_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True, by_alias=False)

    def to_json(self) -> str:
        return self.model_dump_json(exclude_none=True)


class Group(AuthoringModel):
    id: Identifier
    title: Title
    description: str = Field(default="", max_length=2000)
    parent_id: Identifier | None = None

    @model_validator(mode="after")
    def validate_group(self) -> Group:
        domain.Group(**self._python_dict())
        return self


class Tag(AuthoringModel):
    id: Identifier
    title: Title
    description: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_tag(self) -> Tag:
        domain.Tag(**self._python_dict())
        return self


class Privilege(AuthoringModel):
    key: Identifier
    title: Title
    description: str = Field(default="", max_length=2000)
    visibility: Literal["hidden", "read_only", "editable"] = "editable"
    group_id: Identifier | None = None
    tags: list[Identifier] = Field(default_factory=list, max_length=50)

    @model_validator(mode="before")
    @classmethod
    def reject_null_default(cls, value: Any) -> Any:
        if isinstance(value, dict) and "default" in value and value["default"] is None:
            raise ValueError("Use an absent default rather than null")
        return value

    @model_validator(mode="after")
    def validate_privilege(self) -> Privilege:
        if type(self) is Privilege:
            raise ValueError("Use BooleanPrivilege, IntegerPrivilege or StringEnumPrivilege")
        try:
            normalized = domain.Privilege.from_dict(self.to_dict())
        except TypeError as exc:
            raise ValueError(str(exc)) from exc
        self.title = normalized.title
        return self

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> Privilege:
        return _PRIVILEGE_ADAPTER.validate_python(value)


class BooleanPrivilege(Privilege):
    type: Literal["boolean"] = "boolean"
    default: bool | None = None
    env_override: str | None = None


class IntegerPrivilege(Privilege):
    type: Literal["integer"] = "integer"
    default: int | dict[str, bool] | None = None
    minimum: SafeInteger = 0
    maximum: SafeInteger | None = None
    unlimited: bool = False


class StringEnumPrivilege(Privilege):
    type: Literal["enum"] = "enum"
    enum: list[Annotated[str, Field(max_length=200)]] = Field(min_length=1, max_length=100)
    default: str | None = None


TypedPrivilege = Annotated[Union[BooleanPrivilege, IntegerPrivilege, StringEnumPrivilege], Field(discriminator="type")]
_PRIVILEGE_ADAPTER = TypeAdapter(TypedPrivilege)


class PrivilegeCatalog(AuthoringModel):
    privileges: list[TypedPrivilege]
    groups: list[Group] = Field(default_factory=list)
    tags: list[Tag] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_catalog(self) -> PrivilegeCatalog:
        domain.PrivilegeCatalog.from_dict(self.to_dict())
        return self

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> PrivilegeCatalog:
        return cls.model_validate(value)
