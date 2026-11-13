"""Organizations, their Tier variant per Product and Organization terms on the HTTP API (OPE-41).

Rules and Permissions live in ``services/organizations.py``; each change names the version it was made from.
"""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter
from openentitlement.model import OpenEntitlementModel
from openentitlement.privileges import Identifier, Title
from pydantic import Field

from ...services.catalog import CatalogValue
from ...services.organizations import AssignmentInput, ContractStatus, OrganizationService, OrganizationsView
from .dependencies import WorkspaceAccess

router = APIRouter(prefix="/api/workspaces/{workspace_id}/organizations", tags=["organizations"])
Reason = Field(
    default=None, max_length=2000, description="Why Organization terms change. Required exactly when they do."
)


class NewAssignment(OpenEntitlementModel):
    product_id: UUID
    variant_id: Identifier
    status: ContractStatus = "active"
    terms: dict[str, CatalogValue] = Field(default_factory=dict)


class OrganizationCreation(OpenEntitlementModel):
    id: Identifier
    name: Title
    #: Optionally give the new Organization a Tier variant in one Product, in the same transaction.
    assignment: NewAssignment | None = None
    reason: str | None = Reason


class OrganizationRename(OpenEntitlementModel):
    name: Title
    version: int = Field(ge=1, strict=True, description="The version you read.")


class AssignmentSave(OpenEntitlementModel):
    variant_id: Identifier
    status: ContractStatus = "active"
    #: The Organization terms of this variant. A new variant starts from these: the previous ones are cleared.
    terms: dict[str, CatalogValue] = Field(default_factory=dict)
    version: int = Field(ge=0, strict=True, description="0 to give a first variant in this Product; otherwise the version you read.")
    reason: str | None = Reason


def _service() -> OrganizationService:
    # Boolean environment prerequisites read the install's environment (ADR-0004).
    return OrganizationService(environment=os.environ)


@router.get("")
async def view(workspace: WorkspaceAccess) -> OrganizationsView:
    """Every Organization's name, with its variant, status, terms and resolved values in the Products you can see."""
    return await _service().view(workspace)


@router.post("", status_code=201)
async def create(body: OrganizationCreation, workspace: WorkspaceAccess) -> OrganizationsView:
    """Add an Organization: any Product's Manager or an Owner."""
    found = body.assignment
    return await _service().create(
        workspace,
        id=body.id,
        name=body.name,
        product_id=found.product_id if found else None,
        assignment=AssignmentInput(variant_id=found.variant_id, status=found.status, terms=found.terms) if found else None,
        reason=body.reason,
    )


@router.patch("/{organization_id}")
async def rename(organization_id: Identifier, body: OrganizationRename, workspace: WorkspaceAccess) -> OrganizationsView:
    """Rename an Organization. Its ID, which applications send, never changes."""
    return await _service().rename(workspace, organization_id, name=body.name, version=body.version)


@router.put("/{organization_id}/products/{product_id}")
async def assign(
    organization_id: Identifier, product_id: UUID, body: AssignmentSave, workspace: WorkspaceAccess
) -> OrganizationsView:
    """Give the Organization a Tier variant in the Product, or change it, its contract status or Organization terms."""
    wanted = AssignmentInput(variant_id=body.variant_id, status=body.status, terms=body.terms)
    return await _service().assign(
        workspace, organization_id, product_id, wanted, version=body.version, reason=body.reason
    )
