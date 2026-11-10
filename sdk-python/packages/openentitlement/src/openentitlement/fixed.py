"""The fixed provider for self-hosted installs: everything on, nothing overridable (spec §6.4)."""

from __future__ import annotations

from typing import Any, Mapping, Optional

from .catalog import Catalog, PrivilegeDefinition, ValueType
from .details import EvaluationContext, Reason, ResolutionDetails
from .errors import InvalidArgument
from .provider import AbstractProvider, Capabilities, ProviderMetadata
from .values import UNLIMITED


class FixedProvider(AbstractProvider):
    metadata = ProviderMetadata(name="fixed")
    capabilities = Capabilities(fixed=True)

    def __init__(self, catalog: Catalog, values: Optional[Mapping[str, Any]] = None):
        """``values`` overrides the fixed value per privilege key (validated)."""
        configured = dict(values or {})
        self._values: dict[str, Any] = {}
        for p in catalog.privileges:
            if p.key in configured:
                v = configured.pop(p.key)
                problem = p.validate_value(v)
                if problem:
                    raise InvalidArgument(f"fixed value: {problem}")
                self._values[p.key] = v
            elif p.value_type is ValueType.BOOLEAN:
                self._values[p.key] = True
            elif p.value_type is ValueType.ENUM:
                self._values[p.key] = p.options[-1]
            elif p.unlimited_allowed:
                self._values[p.key] = UNLIMITED
            else:
                raise InvalidArgument(
                    f"{p.key} does not allow UNLIMITED; configure a fixed value for it (Requirement 6.4.2)"
                )
        if configured:
            raise InvalidArgument(f"unknown privileges in fixed values: {sorted(configured)}")

    def resolve(self, privilege: PrivilegeDefinition, ctx: EvaluationContext) -> ResolutionDetails[Any]:
        return ResolutionDetails(privilege=privilege.key, value=self._values[privilege.key], reason=Reason.FIXED)
