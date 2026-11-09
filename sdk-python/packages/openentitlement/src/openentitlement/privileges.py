"""Typed Privilege Catalog authoring models, separate from the OEREP v1 wire API."""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Literal

_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")


class Visibility(str, Enum):
    HIDDEN = "hidden"
    READ_ONLY = "read_only"
    EDITABLE = "editable"


def _identifier(value: str) -> None:
    if not isinstance(value, str) or len(value) > 80 or not _IDENTIFIER.fullmatch(value):
        raise ValueError("Expected a flat identifier")


@dataclass(frozen=True, kw_only=True)
class Group:
    id: str
    title: str
    description: str = ""
    parent_id: str | None = None

    def __post_init__(self) -> None:
        _identifier(self.id)
        if not isinstance(self.title, str) or not self.title.strip() or len(self.title) > 200:
            raise ValueError("Group title is required")
        if not isinstance(self.description, str) or len(self.description) > 2000:
            raise ValueError("Invalid Group description")
        if self.parent_id is not None:
            _identifier(self.parent_id)
            if self.parent_id == self.id:
                raise ValueError("A Group cannot contain itself")


@dataclass(frozen=True, kw_only=True)
class Tag:
    id: str
    title: str
    description: str = ""

    def __post_init__(self) -> None:
        _identifier(self.id)
        if not isinstance(self.title, str) or not self.title.strip() or len(self.title) > 200:
            raise ValueError("Tag title is required")
        if not isinstance(self.description, str) or len(self.description) > 2000:
            raise ValueError("Invalid Tag description")


@dataclass(frozen=True, kw_only=True)
class Privilege:
    key: str
    title: str
    description: str = ""
    visibility: Visibility = Visibility.EDITABLE
    group_id: str | None = None
    tags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if type(self) is Privilege:
            raise TypeError("Use BooleanPrivilege, IntegerPrivilege or StringEnumPrivilege")
        _identifier(self.key)
        if not isinstance(self.title, str) or not self.title.strip() or len(self.title) > 200:
            raise ValueError("Privilege title is required (maximum 200 characters)")
        if not isinstance(self.description, str) or len(self.description) > 2000:
            raise ValueError("Invalid Privilege description")
        object.__setattr__(self, "title", self.title.strip())
        object.__setattr__(self, "visibility", Visibility(self.visibility))
        if self.group_id is not None:
            _identifier(self.group_id)
        if not isinstance(self.tags, (tuple, list)) or len(self.tags) > 50 or len(set(self.tags)) != len(self.tags):
            raise ValueError("Privilege tags must be unique Tag identifiers")
        for tag in self.tags:
            _identifier(tag)
        object.__setattr__(self, "tags", tuple(self.tags))

    def to_dict(self) -> dict[str, Any]:
        result = {key: value for key, value in asdict(self).items() if value is not None}
        result["visibility"] = self.visibility.value
        result["tags"] = list(self.tags)
        if "enum" in result:
            result["enum"] = list(result["enum"])
        return result

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Privilege:
        raw = dict(data)
        kind = raw.pop("type", None)
        model = {"boolean": BooleanPrivilege, "integer": IntegerPrivilege, "enum": StringEnumPrivilege}.get(kind)
        if model is None:
            raise ValueError("Privilege type must be boolean, integer or enum")
        if "default" in raw and raw["default"] is None:
            raise ValueError("Use an absent default rather than null")
        return model(**raw)

    def _require_default(self, default: Any, *, env: bool = False) -> None:
        if (self.visibility is not Visibility.EDITABLE or env) and default is None:
            raise ValueError("Hidden, read-only and environment-linked Privileges need a default")


@dataclass(frozen=True, kw_only=True)
class BooleanPrivilege(Privilege):
    type: Literal["boolean"] = field(default="boolean", init=False)
    default: bool | None = None
    env_override: str | None = None

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.default is not None and type(self.default) is not bool:
            raise ValueError("Boolean Privilege default must be a boolean")
        if self.env_override is not None and (
            not isinstance(self.env_override, str)
            or not re.fullmatch(r"[A-Z][A-Z0-9_]*", self.env_override)
        ):
            raise ValueError("env_override must be an uppercase environment variable name")
        self._require_default(self.default, env=self.env_override is not None)


@dataclass(frozen=True, kw_only=True)
class IntegerPrivilege(Privilege):
    type: Literal["integer"] = field(default="integer", init=False)
    default: int | dict[str, bool] | None = None
    minimum: int = 0
    maximum: int | None = None
    unlimited: bool = False

    def __post_init__(self) -> None:
        super().__post_init__()
        for bound in (self.minimum, self.maximum):
            if bound is not None and (type(bound) is not int or not 0 <= bound <= 2**53 - 1):
                raise ValueError("Integer bounds must be non-negative safe integers")
        if self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("Minimum cannot exceed maximum")
        if type(self.unlimited) is not bool:
            raise ValueError("unlimited must be a boolean")
        if self.default is not None:
            if isinstance(self.default, dict):
                if set(self.default) != {"unlimited"} or self.default.get("unlimited") is not True or not self.unlimited:
                    raise ValueError("Unlimited is not allowed")
            elif type(self.default) is not int or not self.minimum <= self.default <= (self.maximum if self.maximum is not None else 2**53 - 1):
                raise ValueError("Integer Privilege default is out of bounds")
        self._require_default(self.default)


@dataclass(frozen=True, kw_only=True)
class StringEnumPrivilege(Privilege):
    type: Literal["enum"] = field(default="enum", init=False)
    enum: tuple[str, ...]
    default: str | None = None

    def __post_init__(self) -> None:
        super().__post_init__()
        if not isinstance(self.enum, (tuple, list)) or not self.enum or len(self.enum) > 100 or any(not isinstance(v, str) or len(v) > 200 for v in self.enum) or len(set(self.enum)) != len(self.enum):
            raise ValueError("String enum requires unique string choices")
        object.__setattr__(self, "enum", tuple(self.enum))
        if self.default is not None and (not isinstance(self.default, str) or self.default not in self.enum):
            raise ValueError("String enum default must be one of its choices")
        self._require_default(self.default)


@dataclass(frozen=True, kw_only=True)
class PrivilegeCatalog:
    privileges: tuple[Privilege, ...]
    groups: tuple[Group, ...] = ()
    tags: tuple[Tag, ...] = ()

    def __post_init__(self) -> None:
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
        object.__setattr__(self, "privileges", tuple(self.privileges))
        object.__setattr__(self, "groups", tuple(self.groups))
        object.__setattr__(self, "tags", tuple(self.tags))

    def to_dict(self) -> dict[str, Any]:
        return {
            "privileges": [p.to_dict() for p in self.privileges],
            "groups": [{k: v for k, v in asdict(g).items() if v is not None} for g in self.groups],
            "tags": [asdict(t) for t in self.tags],
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PrivilegeCatalog:
        if set(data) - {"privileges", "groups", "tags"} or not isinstance(data.get("privileges"), list):
            raise ValueError("Privilege Catalog contains unknown fields or no privileges list")
        return cls(
            privileges=tuple(Privilege.from_dict(p) for p in data["privileges"]),
            groups=tuple(Group(**g) for g in data.get("groups", [])),
            tags=tuple(Tag(**t) for t in data.get("tags", [])),
        )
