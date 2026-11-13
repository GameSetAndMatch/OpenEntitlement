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

# The console built by `npm run build` in console/, when running from a checkout.
_CHECKOUT_CONSOLE = Path(__file__).resolve().parents[5] / "console" / "web" / "dist"

_TRUE = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    port: int = 8787
    host: str = "127.0.0.1"
    #: Postgres URL. Without one, the service keeps its data in memory and loses it on exit.
    database_url: str | None = None
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
            transaction_pooler=env.get("OE_DATABASE_TRANSACTION_POOLER", "").lower() in _TRUE,
            console_dir=Path(console) if console else (_CHECKOUT_CONSOLE if _CHECKOUT_CONSOLE.is_dir() else None),
        )


def build_app(settings: Settings, *, migrate_at_startup: bool = True) -> FastAPI:
    if settings.database_url is None:
        logger.warning("DATABASE_URL is not set: data is kept in memory and lost when the service stops")
        return create_app(InMemoryStore(), console_dir=settings.console_dir)

    url = settings.database_url
    engine = create_engine(url, transaction_pooler=settings.transaction_pooler)

    async def startup() -> None:
        if migrate_at_startup:
            migrate(url)

    return create_app(PostgresStore(engine), console_dir=settings.console_dir, on_startup=startup, on_shutdown=engine.dispose)


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    settings = Settings.from_env()
    uvicorn.run(build_app(settings), host=settings.host, port=settings.port, proxy_headers=True)


if __name__ == "__main__":
    main()
