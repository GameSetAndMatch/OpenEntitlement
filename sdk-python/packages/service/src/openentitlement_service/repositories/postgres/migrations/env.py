"""Alembic environment: async engine on asyncpg, target metadata from ``tables``."""
from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.pool import NullPool

from openentitlement_service.repositories.postgres import create_engine
from openentitlement_service.repositories.postgres.tables import metadata

config = context.config


def run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def main() -> None:
    engine = create_engine(
        config.attributes["url"],
        transaction_pooler=config.attributes.get("transaction_pooler", False),
        poolclass=NullPool,
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run)
            await connection.commit()
    finally:
        await engine.dispose()


asyncio.run(main())
