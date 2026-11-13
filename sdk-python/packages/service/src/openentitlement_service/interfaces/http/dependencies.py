"""FastAPI dependencies shared by the routes: the signed-in Account and its Workspace transaction."""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request

from ...services.workspaces import OpenWorkspace, WorkspaceService
from .auth import CurrentAccount


def workspace_service(request: Request) -> WorkspaceService:
    service: WorkspaceService = request.app.state.workspaces
    return service


Workspaces = Annotated[WorkspaceService, Depends(workspace_service)]


async def workspace_access(
    workspace_id: UUID, signed: CurrentAccount, service: Workspaces
) -> AsyncIterator[OpenWorkspace]:
    """One transaction for the whole request, bound to the Workspace in the path, as the signed-in Account.

    A non-member gets ``not-found``. Each operation then checks the Account's Role for what it does.
    The transaction commits when the route returns and rolls back when it raises, before the
    response is sent.
    """
    async with service.open(signed.account, workspace_id) as workspace:
        yield workspace


#: The request's Workspace transaction and Actor. Function scope makes FastAPI finish the transaction
#: (COMMIT or ROLLBACK) before it sends the response, so a failed COMMIT becomes a problem response
#: instead of a success the client cannot trust.
WorkspaceAccess = Annotated[OpenWorkspace, Depends(workspace_access, scope="function")]
