"""Organizations, their Tier variant per Product, Organization terms and application users on the HTTP API (OPE-41, OPE-60).

Rules and Permissions live in ``services/organizations.py``; each change names the version it was made from.
"""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, Query, Request
from openentitlement.model import OpenEntitlementModel
from openentitlement.privileges import Identifier, Title
from pydantic import Field, StrictInt

from ...services.catalog import CatalogValue
from ...services.problems import FieldError, ValidationFailed
from ...services.organizations import (
    ApplicationUserInput,
    AssignmentInput,
    ContractStatus,
    OrganizationService,
    OrganizationsView,
)
from ...services.workspaces import WorkspaceService
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


class ApplicationUserSave(OpenEntitlementModel):
    name: str = Field(description="The user's display name in the console.")
    #: Values that replace the Organization's for this user. They belong to the Organization's variant now.
    terms: dict[str, CatalogValue] = Field(default_factory=dict)
    #: Positive whole-number allowances added to integer Privileges.
    grants: dict[str, StrictInt] = Field(default_factory=dict)
    version: int = Field(ge=0, strict=True, description="0 to add the user in this Product; otherwise the version you read.")
    reason: str | None = Field(
        default=None, max_length=2000, description="Why Personal terms or Grants change. Required exactly when they do."
    )


class ApplicationUserRemoval(OpenEntitlementModel):
    reason: str | None = Field(
        default=None, max_length=2000, description="Why Personal terms or Grants are removed. Required exactly when the user has some."
    )


def _service(request: Request) -> OrganizationService:
    # Boolean environment prerequisites read the install's environment (ADR-0004); Cloud Enterprise
    # gates application users only on OpenEntitlement Cloud (ADR-0005).
    workspaces: WorkspaceService = request.app.state.workspaces
    return OrganizationService(environment=os.environ, deployment=workspaces.deployment)


@router.get("")
async def view(request: Request, workspace: WorkspaceAccess) -> OrganizationsView:
    """Every Organization's name, with its variant, status, terms and resolved values in the Products you can see."""
    return await _service(request).view(workspace)


@router.post("", status_code=201)
async def create(request: Request, body: OrganizationCreation, workspace: WorkspaceAccess) -> OrganizationsView:
    """Add an Organization: any Product's Manager or an Owner."""
    found = body.assignment
    return await _service(request).create(
        workspace,
        id=body.id,
        name=body.name,
        product_id=found.product_id if found else None,
        assignment=AssignmentInput(variant_id=found.variant_id, status=found.status, terms=found.terms) if found else None,
        reason=body.reason,
    )


@router.patch("/{organization_id}")
async def rename(
    request: Request, organization_id: Identifier, body: OrganizationRename, workspace: WorkspaceAccess
) -> OrganizationsView:
    """Rename an Organization. Its ID, which applications send, never changes."""
    return await _service(request).rename(workspace, organization_id, name=body.name, version=body.version)


@router.put("/{organization_id}/products/{product_id}")
async def assign(
    request: Request, organization_id: Identifier, product_id: UUID, body: AssignmentSave, workspace: WorkspaceAccess
) -> OrganizationsView:
    """Give the Organization a Tier variant in the Product, or change it, its contract status or Organization terms."""
    wanted = AssignmentInput(variant_id=body.variant_id, status=body.status, terms=body.terms)
    return await _service(request).assign(
        workspace, organization_id, product_id, wanted, version=body.version, reason=body.reason
    )


@router.put("/{organization_id}/products/{product_id}/users/{subject_id:path}")
async def save_user(
    request: Request,
    organization_id: Identifier,
    product_id: UUID,
    subject_id: str,
    body: ApplicationUserSave,
    workspace: WorkspaceAccess,
) -> OrganizationsView:
    """Add an application user of the Organization in the Product, or change its name, Personal terms or Grants.

    ``subject_id`` is the ID the application sends, percent-encoded. Needs Cloud Enterprise on OpenEntitlement Cloud.
    """
    wanted = ApplicationUserInput(name=body.name, terms=body.terms, grants=body.grants)
    return await _service(request).save_user(
        workspace, organization_id, product_id, subject_id, wanted, version=body.version, reason=body.reason
    )


@router.delete("/{organization_id}/products/{product_id}/users/{subject_id:path}")
async def remove_user(
    request: Request,
    organization_id: Identifier,
    product_id: UUID,
    subject_id: str,
    workspace: WorkspaceAccess,
    version: int = Query(ge=1, description="The version you read."),
    body: ApplicationUserRemoval | None = None,
) -> OrganizationsView:
    """Remove an application user's record in the Product: it inherits the Organization's values again.

    The reason travels in the JSON body, never in the address, so access logs never hold it (ADR-0010 Q13).
    """
    if "reason" in request.query_params:
        raise ValidationFailed([FieldError("/query/reason", "Send the reason in the request body, not the address.")])
    return await _service(request).remove_user(
        workspace, organization_id, product_id, subject_id, version=version, reason=body.reason if body else None
    )
