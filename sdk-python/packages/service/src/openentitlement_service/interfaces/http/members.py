"""Members, invitation links and the Cloud service tier on the HTTP API. Rules live in the service layer."""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from openentitlement.model import OpenEntitlementModel

from ...services.members import InvitationLink, InvitedRole, Joined, MemberService, MemberView
from ...services.models import ServiceTier
from ...services.workspaces import WorkspaceView
from .auth import CurrentAccount
from .dependencies import WorkspaceAccess, Workspaces


def member_service(request: Request) -> MemberService:
    service: MemberService = request.app.state.members
    return service


Members = Annotated[MemberService, Depends(member_service)]
router = APIRouter(tags=["members"])


class NewInvitation(OpenEntitlementModel):
    email: str
    role: InvitedRole
    product_id: UUID | None = Field(default=None, description="The Product of a Manager or User invitation; none for an Owner.")


class RoleChange(OpenEntitlementModel):
    role: InvitedRole | None = Field(description="Owner, or the Role in the Product; null removes the member from the Product.")
    product_id: UUID | None = Field(default=None, description="The Product of a Manager, User or null Role; none for Owner.")


class InvitationToken(OpenEntitlementModel):
    token: str = Field(max_length=200)


class ServiceTierChange(OpenEntitlementModel):
    tier: ServiceTier
    version: int = Field(ge=1, description="The Workspace version you read. A different one is a revision-conflict problem.")


@router.get("/api/workspaces/{workspace_id}/members")
async def list_members(workspace: WorkspaceAccess, service: Members) -> list[MemberView]:
    """The Owners and the members of the Products you manage, with their Roles there. Owners see everyone."""
    return await service.list_members(workspace)


@router.put("/api/workspaces/{workspace_id}/members/{account_id}", status_code=204)
async def set_member_role(account_id: UUID, body: RoleChange, workspace: WorkspaceAccess, service: Members) -> Response:
    await service.set_role(workspace, account_id, role=body.role, product_id=body.product_id)
    return Response(status_code=204)


@router.delete("/api/workspaces/{workspace_id}/members/{account_id}", status_code=204)
async def remove_member(account_id: UUID, workspace: WorkspaceAccess, service: Members) -> Response:
    """An Owner removes the member from the Workspace; a Manager from the Products they manage."""
    await service.remove(workspace, account_id)
    return Response(status_code=204)


@router.post("/api/workspaces/{workspace_id}/invitations", status_code=201)
async def invite(body: NewInvitation, workspace: WorkspaceAccess, service: Members) -> InvitationLink:
    """A single-use invitation link for one verified email, valid for seven days. Its token is shown once."""
    return await service.invite(workspace, email=body.email, role=body.role, product_id=body.product_id)


@router.post("/api/invitations/accept")
async def accept_invitation(body: InvitationToken, signed: CurrentAccount, service: Members) -> Joined:
    return await service.accept(signed.account, body.token)


@router.put("/api/workspaces/{workspace_id}/service-tier")
async def set_service_tier(body: ServiceTierChange, workspace: WorkspaceAccess, service: Workspaces) -> WorkspaceView:
    """Platform administrators only, on OpenEntitlement Cloud. Cloud Pro allows one Product."""
    return await service.set_service_tier(workspace, tier=body.tier, version=body.version)
