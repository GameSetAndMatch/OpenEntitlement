"""Value types: UNLIMITED, limits, JSON encoding (spec §1.2)."""

from __future__ import annotations

from typing import Any, Union

from pydantic import StrictBool, StrictInt, StrictStr


class Unlimited:
    """The distinct "no limit" value (Requirement 1.2.1).

    It is deliberately *not* an int and supports no arithmetic or ordering, so
    it can never be confused with a large number. Use :func:`is_unlimited`,
    :func:`add_limit` and :func:`fits` instead.
    """

    _instance: "Unlimited | None" = None
    __slots__ = ()

    def __new__(cls) -> "Unlimited":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNLIMITED"

    def __reduce__(self) -> str:
        return "UNLIMITED"

    def __copy__(self) -> "Unlimited":
        return self

    def __deepcopy__(self, memo: Any) -> "Unlimited":
        return self

    def __hash__(self) -> int:
        return hash("openentitlement.UNLIMITED")

    def __eq__(self, other: object) -> bool:
        return other is self

    def __bool__(self) -> bool:
        return True

    def _no_order(self, other: object) -> bool:
        raise TypeError("UNLIMITED is not ordered; use openentitlement.fits()")

    __lt__ = __le__ = __gt__ = __ge__ = _no_order

    @classmethod
    def __get_pydantic_core_schema__(cls, source: Any, handler: Any) -> Any:
        """Validate UNLIMITED or ``{"unlimited": true}``; serialize as ``{"unlimited": true}``."""
        from pydantic_core import core_schema

        return core_schema.no_info_plain_validator_function(
            decode_unlimited,
            serialization=core_schema.plain_serializer_function_ser_schema(lambda _: {"unlimited": True}),
        )

    @classmethod
    def __get_pydantic_json_schema__(cls, schema: Any, handler: Any) -> dict[str, Any]:
        return {
            "type": "object",
            "title": "Unlimited",
            "properties": {"unlimited": {"const": True, "type": "boolean"}},
            "required": ["unlimited"],
            "additionalProperties": False,
        }


UNLIMITED = Unlimited()

Limit = Union[StrictInt, Unlimited]
"""An integer privilege value: an int (negative values are allowed) or UNLIMITED."""

Value = Union[StrictBool, StrictInt, StrictStr, Unlimited]
"""Any privilege value."""


def is_unlimited(value: object) -> bool:
    """Requirement 1.2.2."""
    return value is UNLIMITED


def is_int(value: object) -> bool:
    """True for real ints (bool is excluded)."""
    return isinstance(value, int) and not isinstance(value, bool)


def add_limit(limit: Limit, amount: int) -> Limit:
    """UNLIMITED + n = UNLIMITED (Requirement 1.2.4)."""
    if is_unlimited(limit):
        return UNLIMITED
    return limit + amount  # type: ignore[operator]


def fits(total: int, limit: Limit) -> bool:
    """Whether a finite ``total`` fits within ``limit`` (Requirement 1.2.4)."""
    return is_unlimited(limit) or total <= limit  # type: ignore[operator]


def encode_value(value: Any) -> Any:
    """JSON-encode a value: UNLIMITED -> {"unlimited": true} (Requirement 1.2.3)."""
    if is_unlimited(value):
        return {"unlimited": True}
    return value


def decode_value(raw: Any) -> Any:
    """Inverse of :func:`encode_value`."""
    if isinstance(raw, dict):
        if len(raw) == 1 and raw.get("unlimited") is True:
            return UNLIMITED
        raise ValueError(f"not an OpenEntitlement value: {raw!r}")
    return raw


def decode_unlimited(raw: Any) -> "Unlimited":
    """Accept UNLIMITED itself or its JSON form; anything else is a validation error."""
    if raw is UNLIMITED or (isinstance(raw, dict) and len(raw) == 1 and raw.get("unlimited") is True):
        return UNLIMITED
    raise ValueError('expected UNLIMITED or {"unlimited": true}')


def encode_json(obj: Any) -> Any:
    """Recursively encode UNLIMITED inside dicts/lists."""
    if is_unlimited(obj):
        return {"unlimited": True}
    if isinstance(obj, dict):
        return {k: encode_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [encode_json(v) for v in obj]
    return obj
