"""The catalog: features and privileges declared in application code (spec §1.1)."""

from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Any, Iterable, Mapping, Optional, Sequence

from pydantic import SkipValidation

from .errors import InvalidArgument
from .model import OpenEntitlementModel
from .values import UNLIMITED, Value, is_int, is_unlimited

MAX_SAFE_INTEGER = 2**53 - 1
"""Integers exact in every supported language; values range over -(2**53 - 1)..2**53 - 1."""

KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class ValueType(str, Enum):
    BOOLEAN = "boolean"
    INTEGER = "integer"
    ENUM = "enum"


class PrivilegeDefinition(OpenEntitlementModel):
    """A privilege as the evaluation client sees it. :class:`Catalog` validates it eagerly."""

    key: str
    value_type: ValueType
    # Checked against value_type by Catalog (InvalidArgument), not on construction.
    default: Annotated[Value, SkipValidation]
    unlimited_allowed: bool = False
    options: tuple[str, ...] = ()
    feature: str = ""  # filled in by the catalog

    def validate_value(self, value: Any) -> Optional[str]:
        """Return an error message if ``value`` is invalid for this privilege (Req 1.5.6)."""
        if self.value_type is ValueType.BOOLEAN:
            return None if isinstance(value, bool) else f"{self.key} expects a boolean"
        if self.value_type is ValueType.INTEGER:
            if is_unlimited(value):
                return None if self.unlimited_allowed else f"{self.key} does not allow UNLIMITED"
            if is_int(value) and -MAX_SAFE_INTEGER <= value <= MAX_SAFE_INTEGER:
                return None
            return f"{self.key} expects an integer or UNLIMITED"
        if isinstance(value, str) and value in self.options:
            return None
        return f"{self.key} expects one of {list(self.options)}"


class FeatureDefinition(OpenEntitlementModel):
    code: str
    name: str
    privileges: tuple[PrivilegeDefinition, ...]
    description: str = ""
    gate: Optional[str] = None

    @property
    def gate_key(self) -> str:
        if self.gate is not None:
            return self.gate
        return self.privileges[0].key


def boolean(key: str, *, default: bool = False) -> PrivilegeDefinition:
    return PrivilegeDefinition(key=key, value_type=ValueType.BOOLEAN, default=default)


def integer(key: str, *, default: Any = 0, unlimited_allowed: bool = False) -> PrivilegeDefinition:
    return PrivilegeDefinition(
        key=key, value_type=ValueType.INTEGER, default=default, unlimited_allowed=unlimited_allowed
    )


def enum(key: str, options: Sequence[str], *, default: Optional[str] = None) -> PrivilegeDefinition:
    opts = tuple(options)
    return PrivilegeDefinition(
        key=key,
        value_type=ValueType.ENUM,
        default=default if default is not None else (opts[0] if opts else ""),
        options=opts,
    )


def feature(
    code: str,
    name: str,
    privileges: Iterable[PrivilegeDefinition],
    *,
    description: str = "",
    gate: Optional[str] = None,
) -> FeatureDefinition:
    return FeatureDefinition(
        code=code, name=name, privileges=tuple(privileges), description=description, gate=gate
    )


class Catalog:
    """A validated set of features (Requirement 1.1.7: validated eagerly)."""

    def __init__(self, features: Iterable[FeatureDefinition]):
        self._features: dict[str, FeatureDefinition] = {}
        self._privileges: dict[str, PrivilegeDefinition] = {}
        for f in features:
            self._add(f)

    def _add(self, f: FeatureDefinition) -> None:
        if not KEY_PATTERN.fullmatch(f.code):
            raise InvalidArgument(f"invalid feature code {f.code!r}")
        if f.code in self._features:
            raise InvalidArgument(f"duplicate feature code {f.code!r}")
        if not f.name:
            raise InvalidArgument(f"feature {f.code!r} needs a name")
        if not f.privileges:
            raise InvalidArgument(f"feature {f.code!r} declares no privileges")
        own = {p.key for p in f.privileges}
        if len(f.privileges) > 1 and f.gate is None:
            raise InvalidArgument(f"feature {f.code!r} has several privileges and must name a gate")
        if f.gate is not None and f.gate not in own:
            raise InvalidArgument(f"gate {f.gate!r} is not a privilege of feature {f.code!r}")
        attached = []
        for p in f.privileges:
            if not KEY_PATTERN.fullmatch(p.key):
                raise InvalidArgument(f"invalid privilege key {p.key!r}")
            if p.key in self._privileges or sum(1 for q in f.privileges if q.key == p.key) > 1:
                raise InvalidArgument(f"duplicate privilege key {p.key!r}")
            if p.value_type is ValueType.ENUM:
                if not p.options or len(set(p.options)) != len(p.options):
                    raise InvalidArgument(f"enum {p.key!r} needs non-empty, unique options")
            if p.value_type is not ValueType.INTEGER and p.unlimited_allowed:
                raise InvalidArgument(f"{p.key!r}: only integer privileges may allow UNLIMITED")
            problem = p.validate_value(p.default)
            if problem:
                raise InvalidArgument(f"invalid default: {problem}")
            attached.append(_with_feature(p, f.code))
        gate = next(p for p in attached if p.key == f.gate_key)
        if gate.value_type is ValueType.ENUM:
            raise InvalidArgument(f"gate {gate.key!r} must be boolean or integer")
        f = f.model_copy(update={"privileges": tuple(attached)})
        self._features[f.code] = f
        for p in attached:
            self._privileges[p.key] = p

    def privilege(self, key: str) -> Optional[PrivilegeDefinition]:
        return self._privileges.get(key)

    def feature(self, code: str) -> Optional[FeatureDefinition]:
        return self._features.get(code)

    @property
    def features(self) -> tuple[FeatureDefinition, ...]:
        return tuple(self._features.values())

    @property
    def privileges(self) -> tuple[PrivilegeDefinition, ...]:
        return tuple(self._privileges.values())

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "Catalog":
        """Load the JSON catalog format used by the conformance suite."""
        feats = []
        for f in data["features"]:
            privs = []
            for p in f["privileges"]:
                vt = ValueType(p["valueType"])
                default = p.get("default")
                if default == {"unlimited": True}:
                    default = UNLIMITED
                privs.append(
                    PrivilegeDefinition(
                        key=p["key"],
                        value_type=vt,
                        default=default
                        if default is not None
                        else {ValueType.BOOLEAN: False, ValueType.INTEGER: 0}.get(
                            vt, (p.get("options") or [""])[0]
                        ),
                        unlimited_allowed=bool(p.get("unlimitedAllowed", False)),
                        options=tuple(p.get("options", ())),
                    )
                )
            feats.append(
                FeatureDefinition(
                    code=f["code"],
                    name=f["name"],
                    description=f.get("description", ""),
                    privileges=tuple(privs),
                    gate=f.get("gate"),
                )
            )
        return cls(feats)


def _with_feature(p: PrivilegeDefinition, code: str) -> PrivilegeDefinition:
    return p.model_copy(update={"feature": code})
