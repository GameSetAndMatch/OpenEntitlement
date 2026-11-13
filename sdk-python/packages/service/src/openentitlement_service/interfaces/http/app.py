"""Builds the FastAPI application around a ``Store``."""
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from starlette.types import Receive, Scope, Send

from ...services.problems import NotFound
from ...services.repositories import Store
from . import problems


def create_app(
    store: Store,
    *,
    console_dir: Path | None = None,
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

    @app.get("/healthz", tags=["health"])
    async def health() -> dict[str, str]:
        await store.ping()
        return {"status": "ok"}

    if console_dir is not None:
        _serve_console(app, console_dir.resolve())
    return app


API_PREFIXES = ("api", "oerep", "mcp", "healthz")


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
