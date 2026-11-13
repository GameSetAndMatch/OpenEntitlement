"""A Product's Tiers, Tier variants and status policy on the HTTP API (OPE-40).

Rules and Permissions live in ``services/tiers.py``; each change names the version it was made from.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query, Response
from openentitlement.model import OpenEntitlementModel
from openentitlement.privileges import Identifier, Title
from pydantic import Field

from ...services.catalog import CatalogValue, VariantKind
from ...services.tiers import NewTier, PolicyAction, StatusPolicy, TierService, TiersView, VariantInput
from .dependencies import WorkspaceAccess

router = APIRouter(prefix="/api/workspaces/{workspace_id}/products/{product_id}", tags=["tiers"])
Version = Field(ge=1, strict=True, description="The version you read. A different current version is a revision-conflict problem.")
SaveVersion = Field(ge=0, strict=True, description="0 to create; otherwise the version you read.")


class TierCreation(OpenEntitlementModel):
    tier: NewTier
    #: The Tier's standard variant, created with it.
    standard: VariantInput


class TierEdit(OpenEntitlementModel):
    name: str
    rank: int
    grace_period_days: int
    version: int = Version


class TierVersion(OpenEntitlementModel):
    version: int = Version


class VariantSave(OpenEntitlementModel):
    name: Title
    kind: VariantKind
    values: dict[str, CatalogValue] = Field(default_factory=dict)
    version: int = SaveVersion


class PolicySave(OpenEntitlementModel):
    past_due: PolicyAction
    ended: PolicyAction
    version: int = SaveVersion


@router.get("/tiers")
async def view(product_id: UUID, workspace: WorkspaceAccess) -> TiersView:
    """The Product's Tiers by rank, their variants and the status policy."""
    return await TierService().view(workspace, product_id)


@router.post("/tiers", status_code=201)
async def create(product_id: UUID, body: TierCreation, workspace: WorkspaceAccess) -> TiersView:
    """Create a Tier with its standard variant, in one transaction."""
    standard = body.standard.model_copy(update={"kind": "standard"})
    return await TierService().create(workspace, product_id, body.tier, standard)


@router.patch("/tiers/{tier_id}")
async def update(product_id: UUID, tier_id: Identifier, body: TierEdit, workspace: WorkspaceAccess) -> TiersView:
    """Rename a Tier, or set its rank and past-due grace days. Its ID never changes."""
    return await TierService().update(
        workspace,
        product_id,
        tier_id,
        name=body.name,
        rank=body.rank,
        grace_period_days=body.grace_period_days,
        version=body.version,
    )


@router.post("/tiers/{tier_id}/archive")
async def archive(product_id: UUID, tier_id: Identifier, body: TierVersion, workspace: WorkspaceAccess) -> TiersView:
    """Current Organizations keep an archived Tier with all its variants; it is never given to a new one."""
    return await TierService().archive(workspace, product_id, tier_id, version=body.version)


@router.post("/tiers/{tier_id}/restore")
async def restore(product_id: UUID, tier_id: Identifier, body: TierVersion, workspace: WorkspaceAccess) -> TiersView:
    return await TierService().restore(workspace, product_id, tier_id, version=body.version)


@router.delete("/tiers/{tier_id}", status_code=204)
async def delete(
    product_id: UUID, tier_id: Identifier, workspace: WorkspaceAccess, version: int = Query(ge=1)
) -> Response:
    """Delete a Tier that no Organization uses, with its variants."""
    await TierService().delete(workspace, product_id, tier_id, version=version)
    return Response(status_code=204)


@router.put("/tiers/{tier_id}/variants/{variant_id}")
async def save_variant(
    product_id: UUID, tier_id: Identifier, variant_id: Identifier, body: VariantSave, workspace: WorkspaceAccess
) -> TiersView:
    """Create (version 0) or edit a Tier variant. Its Tier and purpose never change."""
    variant = VariantInput(id=variant_id, name=body.name, kind=body.kind, values=body.values)
    return await TierService().save_variant(workspace, product_id, tier_id, variant, version=body.version)


@router.put("/status-policy")
async def set_policy(product_id: UUID, body: PolicySave, workspace: WorkspaceAccess) -> TiersView:
    """What an Organization of this Product gets once its grace runs out, or its contract ends."""
    policy = StatusPolicy(past_due=body.past_due, ended=body.ended)
    return await TierService().set_policy(workspace, product_id, policy, version=body.version)
