"""Records the service layer works with: frozen Pydantic models, camelCase JSON (ADR-0006)."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Record(BaseModel):
    model_config = ConfigDict(frozen=True, alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Workspace(Record):
    id: UUID
    name: str
    version: int = 1
    created_at: datetime


class Product(Record):
    """A commercial offering within a Workspace (ADR-0008)."""

    id: UUID
    workspace_id: UUID
    key: str
    name: str
    version: int = 1
    created_at: datetime
