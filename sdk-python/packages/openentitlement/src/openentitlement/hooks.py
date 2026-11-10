"""Evaluation and mutation hooks (spec §7), OpenFeature-style."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import Field

from .catalog import ValueType
from .details import EvaluationContext, ResolutionDetails
from .model import OpenEntitlementModel
from .provider import AuditEvent, ProviderMetadata


class HookContext(OpenEntitlementModel):
    """Requirement 7.1.1."""

    privilege: str
    value_type: Optional[ValueType]
    context: EvaluationContext
    provider_metadata: ProviderMetadata
    feature: Optional[str] = None
    hook_data: dict[str, Any] = Field(default_factory=dict)


class Hook:
    """Subclass and override any stage. Defaults do nothing."""

    def before(self, ctx: HookContext) -> None:
        return None

    def after(self, ctx: HookContext, details: ResolutionDetails[Any]) -> None:
        return None

    def error(self, ctx: HookContext, error: BaseException) -> None:
        return None

    def finally_after(self, ctx: HookContext, details: Optional[ResolutionDetails[Any]]) -> None:
        """The ``finally`` stage (``finally`` is a Python keyword)."""
        return None


class MutationContext(OpenEntitlementModel):
    """Requirement 7.2.1."""

    operation: str
    arguments: dict[str, Any]
    actor: str
    reason: str
    provider_metadata: ProviderMetadata


class MutationHook:
    def before(self, ctx: MutationContext) -> None:
        """Raise to veto the mutation (Requirement 7.2.2)."""
        return None

    def after(self, ctx: MutationContext, event: AuditEvent) -> None:
        return None

    def error(self, ctx: MutationContext, error: BaseException) -> None:
        return None

    def finally_after(self, ctx: MutationContext) -> None:
        return None


class AuditLog(MutationHook):
    """A ready-made mutation hook that collects audit events in memory (handy in tests)."""

    def __init__(self) -> None:
        self.events: list[AuditEvent] = []

    def after(self, ctx: MutationContext, event: AuditEvent) -> None:
        self.events.append(event)
