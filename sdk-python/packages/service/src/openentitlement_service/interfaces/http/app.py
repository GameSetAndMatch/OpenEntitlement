"""Builds the FastAPI application around a ``Store``."""
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from starlette.types import Receive, Scope, Send

from ...services.problems import NotFound
from ...services.repositories import Store
from ...services.sign_in import SignInPolicy, SignInService
from ...services.workspaces import WorkspaceService, utcnow
from . import auth, problems, workspaces, catalog, tiers, organizations
from .oidc import OidcClient


def create_app(
    store: Store,
    *,
    console_dir: Path | None = None,
    sign_in: auth.SignInSettings | None = None,
    oidc_transport: httpx.AsyncBaseTransport | None = None,
    clock: Callable[[], datetime] = utcnow,
    on_startup: Callable[[], Awaitable[None]] | None = None,
    on_shutdown: Callable[[], Awaitable[None]] | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if on_startup:
            await on_startup()
        try:
            yield
        finally:
            if on_shutdown:
                await on_shutdown()

    app = FastAPI(title="OpenEntitlement", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    problems.install(app)
    app.state.store = store
    app.state.workspaces = WorkspaceService(store, clock=clock)
    # Without sign-in settings nobody can sign in; the policy then only names a placeholder issuer.
    policy = sign_in.policy() if sign_in else SignInPolicy(issuer="")
    app.state.authentication = auth.Authentication(
        service=SignInService(store, policy, clock=clock),
        oidc=OidcClient(sign_in.oidc, transport=oidc_transport) if sign_in else None,
    )
    app.include_router(auth.router)
    app.include_router(workspaces.router)
    app.include_router(catalog.router)
    app.include_router(tiers.router)
    app.include_router(organizations.router)

    @app.get("/healthz", tags=["health"])
    async def health() -> dict[str, str]:
        await store.ping()
        return {"status": "ok"}

    if console_dir is not None:
        _serve_console(app, console_dir.resolve())
    return app


API_PREFIXES = ("api", "auth", "oerep", "mcp", "healthz")


def _serve_console(app: FastAPI, root: Path) -> None:
    """Serve the built React console, falling back to its page for client-side routes.

    Mounted last, so it only sees addresses no route matched. API addresses never fall back.
    """
    index = root / "index.html"

    async def console(scope: Scope, receive: Receive, send: Send) -> None:
        path = scope["path"].lstrip("/")
        if scope["method"] not in ("GET", "HEAD") or path.split("/", 1)[0] in API_PREFIXES:
            raise NotFound()
        candidate = (root / path).resolve()
        target = candidate if candidate.is_relative_to(root) and candidate.is_file() else index
        await FileResponse(target)(scope, receive, send)

    app.mount("/", console)
