"""Composition root: reads settings, wires the Postgres store into the HTTP API, runs uvicorn."""
from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI

from .interfaces.http import create_app
from .repositories.memory import InMemoryStore
from .repositories.postgres import PostgresStore, create_engine, migrate

logger = logging.getLogger("openentitlement_service")

# This file is <checkout>/sdk-python/packages/service/src/openentitlement_service/main.py.
_CHECKOUT_ROOT = Path(__file__).resolve().parents[5]
# The console built by `npm run build` in console/, when running from a checkout.
_CHECKOUT_CONSOLE = _CHECKOUT_ROOT / "console" / "web" / "dist"

_TRUE = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    port: int = 8787
    host: str = "127.0.0.1"
    #: Postgres URL. Required unless ``in_memory`` is set.
    database_url: str | None = None
    #: Keep data in memory and lose it on exit, for trying the service out.
    in_memory: bool = False
    #: Set behind a transaction-mode pooler such as PgBouncer: turns off prepared-statement caching.
    transaction_pooler: bool = False
    #: The built React console. ``None`` serves the API only.
    console_dir: Path | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        console = env.get("OE_CONSOLE_DIR")
        return cls(
            port=int(env.get("PORT", "8787")),
            host=env.get("OE_HOST", "127.0.0.1"),
            database_url=env.get("DATABASE_URL") or None,
            in_memory=env.get("OE_IN_MEMORY", "").lower() in _TRUE,
            transaction_pooler=env.get("OE_DATABASE_TRANSACTION_POOLER", "").lower() in _TRUE,
            console_dir=Path(console) if console else (_CHECKOUT_CONSOLE if _CHECKOUT_CONSOLE.is_dir() else None),
        )


def build_app(settings: Settings, *, migrate_at_startup: bool = True) -> FastAPI:
    if settings.database_url is None:
        if not settings.in_memory:
            raise SystemExit("Set DATABASE_URL to a Postgres URL, or OE_IN_MEMORY=true to keep data in memory.")
        logger.warning("OE_IN_MEMORY is set: data is kept in memory and lost when the service stops")
        return create_app(InMemoryStore(), console_dir=settings.console_dir)

    url = settings.database_url
    engine = create_engine(url, transaction_pooler=settings.transaction_pooler, pool_pre_ping=True)
    store = PostgresStore(engine)

    async def startup() -> None:
        if migrate_at_startup:
            migrate(url, transaction_pooler=settings.transaction_pooler)
            if await store.role_bypasses_row_level_security():
                logger.warning(
                    "The database role can bypass row-level security (superuser or BYPASSRLS). "
                    "Connect with a role that cannot, so Workspace isolation does not rely on the service alone."
                )

    return create_app(store, console_dir=settings.console_dir, on_startup=startup, on_shutdown=engine.dispose)


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    settings = Settings.from_env()
    uvicorn.run(build_app(settings), host=settings.host, port=settings.port, proxy_headers=True)


if __name__ == "__main__":
    main()
