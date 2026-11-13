"""A Product's API keys on the HTTP API (OPE-42). Rules and Permissions live in ``services/api_keys.py``."""
from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from fastapi import APIRouter, Response
from openentitlement.model import OpenEntitlementModel
from pydantic import Field

from ...services.api_keys import ApiKeyService, ApiKeyView, NewApiKey
from .dependencies import WorkspaceAccess

router = APIRouter(prefix="/api/workspaces/{workspace_id}/products/{product_id}/api-keys", tags=["api-keys"])
service = ApiKeyService()


class ApiKeyCreation(OpenEntitlementModel):
    name: str = Field(max_length=200, description="What uses the key, such as the application's name.")


@router.get("")
async def list_keys(product_id: UUID, workspace: WorkspaceAccess) -> Sequence[ApiKeyView]:
    """The Product's API keys without their secrets. Its Managers and the Workspace's Owners."""
    return await service.list(workspace, product_id)


@router.post("", status_code=201)
async def create_key(product_id: UUID, body: ApiKeyCreation, workspace: WorkspaceAccess) -> NewApiKey:
    """A new key that evaluates only this Product. Its secret is in this response and never again."""
    return await service.create(workspace, product_id, name=body.name)


@router.delete("/{key_id}", status_code=204)
async def revoke_key(product_id: UUID, key_id: UUID, workspace: WorkspaceAccess) -> Response:
    """Revoke the key: applications using it are refused from their next request."""
    await service.revoke(workspace, product_id, key_id)
    return Response(status_code=204)
