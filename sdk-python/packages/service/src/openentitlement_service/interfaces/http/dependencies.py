"""FastAPI dependencies shared by the routes."""
from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import Request

from ...services.repositories import Repositories, Store


async def workspace_transaction(request: Request, workspace_id: UUID) -> AsyncIterator[Repositories]:
    """One transaction for the whole request, bound to its Workspace.

    It commits when the route returns and rolls back when it raises, before the response is sent.
    Until sign-in exists (OPE-38), the Workspace comes from the route's ``workspace_id``
    parameter; sign-in will resolve it from the caller and check their membership first.
    """
    store: Store = request.app.state.store
    async with store.transaction(workspace_id) as repositories:
        yield repositories
