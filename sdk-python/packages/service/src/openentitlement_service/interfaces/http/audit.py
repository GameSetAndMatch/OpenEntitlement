"""The Audit log on the HTTP API (ADR-0007). Visibility and projection live in the service layer."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from ...services.audit import MAX_PAGE, AuditLogView, AuditService
from .dependencies import WorkspaceAccess

router = APIRouter(tags=["audit"])
_service = AuditService()


@router.get("/api/workspaces/{workspace_id}/audit")
async def audit_log(
    workspace: WorkspaceAccess,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
    before: Annotated[int | None, Query(ge=1, description="The `next` of the previous page.")] = None,
) -> AuditLogView:
    """Who changed what, newest first: Owners read every entry; a Product's Managers their Products' entries and values.

    Anyone else, a User included, gets a `permission-denied` problem.
    """
    return await _service.log(workspace, limit=limit, before=before)
