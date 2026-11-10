"""The shared Pydantic base for every OpenEntitlement model (ADR-0006).

Python attributes are snake_case (``organization_id``). JSON, JSON Schema and
FastAPI responses use camelCase aliases (``organizationId``). Validation accepts
either spelling.
"""

from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel, ConfigDict, model_serializer
from pydantic.alias_generators import to_camel

MODEL_CONFIG = ConfigDict(
    frozen=True,
    extra="forbid",
    alias_generator=to_camel,
    field_title_generator=lambda name, _info: name.replace("_", " ").capitalize(),
    validate_by_name=True,
    validate_by_alias=True,
    serialize_by_alias=True,
    arbitrary_types_allowed=True,
    revalidate_instances="never",
)


M = TypeVar("M", bound="OpenEntitlementModel")
_setattr = object.__setattr__


class OpenEntitlementModel(BaseModel):
    """Immutable, hashable, camelCase JSON, snake_case attributes.

    Positional construction (``Plan("free", "Free")``) still works at runtime
    for compatibility with the earlier dataclasses; prefer keywords.
    """

    model_config = MODEL_CONFIG

    def __init__(self, /, *args: Any, **data: Any) -> None:
        if args:
            names = tuple(type(self).__pydantic_fields__)
            if len(args) > len(names):
                raise TypeError(f"{type(self).__name__} takes at most {len(names)} positional arguments")
            for name, value in zip(names, args, strict=False):
                if name in data:
                    raise TypeError(f"{type(self).__name__} got multiple values for argument {name!r}")
                data[name] = value
        # What BaseModel.__init__ does, without the extra frame (this is on the evaluation hot path).
        self.__pydantic_validator__.validate_python(data, self_instance=self)

    @classmethod
    def _trusted(cls: type[M], fields_set: "set[str] | frozenset[str]", values: dict[str, Any]) -> M:
        """Build from values that are already valid (internal hot path; no validation, no defaults).

        ``values`` must hold every field. Equivalent to ``model_construct`` but cheaper.
        """
        obj = cls.__new__(cls)
        _setattr(obj, "__dict__", values)
        _setattr(obj, "__pydantic_fields_set__", set(fields_set))
        _setattr(obj, "__pydantic_extra__", None)
        _setattr(obj, "__pydantic_private__", None)
        return obj

    def _evolve(self: M, changes: dict[str, Any]) -> M:
        """``model_copy(update=changes)`` for already-valid values, without the deep machinery."""
        values = self.__dict__.copy()
        values.update(changes)
        return type(self)._trusted(self.__pydantic_fields_set__ | changes.keys(), values)


class WireModel(OpenEntitlementModel):
    """A model whose JSON form is its hand-written ``to_dict`` (the OEREP v1 wire shape).

    ``model_dump``, ``model_dump_json`` and FastAPI responses therefore emit the
    same JSON as ``to_dict``; the JSON Schema still comes from the fields.
    """

    def to_dict(self) -> dict[str, Any]:  # pragma: no cover - overridden
        raise NotImplementedError

    @model_serializer(mode="wrap")
    def _serialize_wire(self, handler):  # type: ignore[no-untyped-def]  # unannotated: keep the field schema
        return self.to_dict()


__all__ = ["MODEL_CONFIG", "OpenEntitlementModel", "WireModel"]
