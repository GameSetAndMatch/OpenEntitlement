"""Postgres repositories: SQLAlchemy Core on the asyncpg driver, migrated by Alembic.

Every transaction switches to the ``openentitlement_service`` role, which never bypasses
row-level security, and binds the Workspace in ``openentitlement.workspace_id``. Postgres then
filters every query, including raw SQL, to that Workspace.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from ...services.models import Product, Workspace
from ...services.problems import ServiceUnavailable
from ...services.repositories import Repositories, ensure_bound_workspace
from .migrate import migrate
from .rls import SERVICE_ROLE, WORKSPACE_SETTING
from .tables import products, workspaces


__all__ = ["PostgresStore", "create_engine", "migrate", "asyncpg_url", "SERVICE_ROLE", "WORKSPACE_SETTING"]


def asyncpg_url(url: str) -> str:
    """Accept ``postgresql://`` and ``postgres://`` URLs and select the asyncpg driver."""
    parsed = make_url(url.replace("postgres://", "postgresql://", 1) if url.startswith("postgres://") else url)
    return parsed.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)


def create_engine(url: str, *, transaction_pooler: bool = False) -> AsyncEngine:
    """An async engine on asyncpg.

    Behind a transaction-mode pooler (for example PgBouncer), a connection may change between
    statements, so prepared statements cannot be cached or named per connection.
    """
    connect_args: dict[str, object] = {}
    if transaction_pooler:
        connect_args = {
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__oe_{uuid4().hex}__",
        }
    return create_async_engine(asyncpg_url(url), connect_args=connect_args, pool_pre_ping=True)


class PostgresWorkspacesRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID) -> None:
        self.connection, self._workspace_id = connection, workspace_id

    async def add(self, workspace: Workspace) -> None:
        ensure_bound_workspace(self._workspace_id, workspace.id)
        await self.connection.execute(workspaces.insert().values(**workspace.model_dump(by_alias=False)))

    async def get(self) -> Workspace | None:
        row = (await self.connection.execute(select(workspaces))).mappings().first()
        return Workspace.model_validate(dict(row)) if row else None


class PostgresProductsRepository:
    def __init__(self, connection: AsyncConnection, workspace_id: UUID) -> None:
        self.connection, self._workspace_id = connection, workspace_id

    async def add(self, product: Product) -> None:
        ensure_bound_workspace(self._workspace_id, product.workspace_id)
        await self.connection.execute(products.insert().values(**product.model_dump(by_alias=False)))

    async def list(self) -> Sequence[Product]:
        rows = (await self.connection.execute(select(products).order_by(products.c.key))).mappings()
        return [Product.model_validate(dict(row)) for row in rows]


@dataclass(frozen=True)
class PostgresRepositories(Repositories):
    """The repositories of one transaction, plus that transaction's connection."""

    connection: AsyncConnection


class PostgresStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    @asynccontextmanager
    async def transaction(self, workspace_id: UUID) -> AsyncIterator[Repositories]:
        async with self.engine.begin() as connection:
            await connection.execute(text(f"set local role {SERVICE_ROLE}"))
            await connection.execute(
                text("select set_config(:setting, :workspace, true)"),
                {"setting": WORKSPACE_SETTING, "workspace": str(workspace_id)},
            )
            yield PostgresRepositories(
                workspaces=PostgresWorkspacesRepository(connection, workspace_id),
                products=PostgresProductsRepository(connection, workspace_id),
                connection=connection,
            )

    async def role_bypasses_row_level_security(self) -> bool:
        """Whether the connecting role is a superuser or has BYPASSRLS, and could leave the service role."""
        async with self.engine.connect() as connection:
            query = text("select rolsuper or rolbypassrls from pg_roles where rolname = current_user")
            return bool((await connection.execute(query)).scalar())

    async def ping(self) -> None:
        try:
            async with self.engine.connect() as connection:
                await connection.execute(text("select 1"))
        except (OperationalError, DBAPIError, OSError) as exc:
            raise ServiceUnavailable() from exc
