"""Workspaces and Products on the HTTP API. Every rule and Permission lives in the service layer."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query, Response
from pydantic import Field

from openentitlement.model import OpenEntitlementModel

from ...services.workspaces import ProductView, WorkspaceSummary, WorkspaceView
from .auth import CurrentAccount
from .dependencies import WorkspaceAccess, Workspaces

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])
Version = Field(ge=1, description="The version you read. A different current version is a revision-conflict problem.")


class NewWorkspace(OpenEntitlementModel):
    name: str


class NewProduct(OpenEntitlementModel):
    key: str = Field(description="The Product's identifier in OEREP paths. It never changes.")
    name: str


class ProductRename(OpenEntitlementModel):
    name: str
    version: int = Version


class ProductVersion(OpenEntitlementModel):
    version: int = Version


@router.get("")
async def list_workspaces(signed: CurrentAccount, service: Workspaces) -> list[WorkspaceSummary]:
    """The Workspaces you are a member of (every Workspace for a Platform administrator)."""
    return await service.list_workspaces(signed.account)


@router.post("", status_code=201)
async def create_workspace(body: NewWorkspace, signed: CurrentAccount, service: Workspaces) -> WorkspaceView:
    """A new Workspace with its first Product. You become its Owner."""
    return await service.create_workspace(signed.account, body.name)


@router.get("/{workspace_id}")
async def get_workspace(workspace: WorkspaceAccess, service: Workspaces) -> WorkspaceView:
    """The Workspace, with the Products where you have a Role."""
    return await service.view(workspace)


@router.get("/{workspace_id}/products")
async def list_products(workspace: WorkspaceAccess, service: Workspaces) -> tuple[ProductView, ...]:
    return (await service.view(workspace)).products


@router.post("/{workspace_id}/products", status_code=201)
async def create_product(body: NewProduct, workspace: WorkspaceAccess, service: Workspaces) -> ProductView:
    return await service.create_product(workspace, key=body.key, name=body.name)


@router.get("/{workspace_id}/products/{product_id}")
async def get_product(product_id: UUID, workspace: WorkspaceAccess, service: Workspaces) -> ProductView:
    return await service.get_product(workspace, product_id)


@router.patch("/{workspace_id}/products/{product_id}")
async def rename_product(
    product_id: UUID, body: ProductRename, workspace: WorkspaceAccess, service: Workspaces
) -> ProductView:
    return await service.rename_product(workspace, product_id, name=body.name, version=body.version)


@router.post("/{workspace_id}/products/{product_id}/archive")
async def archive_product(
    product_id: UUID, body: ProductVersion, workspace: WorkspaceAccess, service: Workspaces
) -> ProductView:
    """Current customers keep an archived Product; it cannot be given to a new one."""
    return await service.archive_product(workspace, product_id, version=body.version)


@router.post("/{workspace_id}/products/{product_id}/restore")
async def restore_product(
    product_id: UUID, body: ProductVersion, workspace: WorkspaceAccess, service: Workspaces
) -> ProductView:
    return await service.restore_product(workspace, product_id, version=body.version)


@router.delete("/{workspace_id}/products/{product_id}", status_code=204)
async def delete_product(
    product_id: UUID, workspace: WorkspaceAccess, service: Workspaces, version: int = Query(ge=1)
) -> Response:
    """Delete a Product no customer uses. A Workspace keeps at least one Product."""
    await service.delete_product(workspace, product_id, version=version)
    return Response(status_code=204)
