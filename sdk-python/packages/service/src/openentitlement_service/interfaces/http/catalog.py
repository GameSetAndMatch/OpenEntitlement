"""Catalog HTTP interface; business validation and Permissions live in the service."""

from uuid import UUID
from typing import cast

from fastapi import APIRouter
from pydantic import Field, ValidationError, JsonValue
from openentitlement.privileges import Group, Tag, Privilege
from openentitlement.model import OpenEntitlementModel
from openentitlement_service.services.catalog import (
    CatalogEntry,
    CatalogService,
    CatalogView,
    VariantValue,
    CatalogKind,
    validation_problem,
)
from .dependencies import WorkspaceAccess

router = APIRouter(prefix="/api/workspaces/{workspace_id}/products/{product_id}/catalog", tags=["catalog"])


class CatalogSave(OpenEntitlementModel):
    kind: CatalogKind
    variant_values: dict[str, VariantValue] = Field(default_factory=dict)
    entry: dict[str, JsonValue]
    version: int = Field(ge=0, strict=True)


@router.get("")
async def view(product_id: UUID, workspace: WorkspaceAccess) -> CatalogView:
    return await CatalogService().view(workspace, product_id)


@router.put("")
async def save(product_id: UUID, body: CatalogSave, workspace: WorkspaceAccess) -> CatalogView:
    try:
        data = body.entry
        entry = (
            Group.model_validate(data)
            if body.kind == "groups"
            else Tag.model_validate(data)
            if body.kind == "tags"
            else Privilege.from_dict(data)
        )
    except ValidationError as exc:
        raise validation_problem(exc, body.entry, "/entry", discriminated=body.kind == "privileges") from exc
    return await CatalogService().save(
        workspace, product_id, cast(CatalogEntry, entry), version=body.version, variant_values=body.variant_values
    )
