"""Records the service layer works with: the SDK's frozen Pydantic base, camelCase JSON (ADR-0006)."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from openentitlement.model import OpenEntitlementModel


class Workspace(OpenEntitlementModel):
    id: UUID
    name: str
    version: int = 1
    created_at: datetime


class Product(OpenEntitlementModel):
    """A commercial offering within a Workspace (ADR-0008)."""

    id: UUID
    workspace_id: UUID
    key: str
    name: str
    version: int = 1
    created_at: datetime
