"""Postgres repositories: row-level security, migrations and connection settings."""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import psycopg
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from openentitlement_service.repositories.postgres import PostgresRepositories, PostgresStore, create_engine, migrate
from openentitlement_service.repositories.postgres.migrate import check
from openentitlement_service.services.models import Account, Member, Product, Workspace

pytestmark = pytest.mark.anyio
NOW = datetime(2026, 11, 12, 9, 30, tzinfo=UTC)


async def two_workspaces_with_a_product_each(store: PostgresStore) -> tuple[Workspace, Workspace]:
    pair = (Workspace(id=uuid4(), name="ACME", created_at=NOW), Workspace(id=uuid4(), name="Globex", created_at=NOW))
    for ws in pair:
        async with store.transaction(ws.id) as repos:
            await repos.workspaces.add(ws)
            await repos.products.add(Product(id=uuid4(), workspace_id=ws.id, key="analytics", name="Analytics", created_at=NOW))
    return pair


async def test_raw_sql_in_a_workspace_transaction_sees_only_that_workspace(postgres_store: PostgresStore) -> None:
    acme, globex = await two_workspaces_with_a_product_each(postgres_store)
    async with postgres_store.transaction(globex.id) as repos:
        assert isinstance(repos, PostgresRepositories)
        rows = (await repos.connection.execute(text("select workspace_id from products"))).all()
        assert [r.workspace_id for r in rows] == [globex.id]
        stolen = await repos.connection.execute(
            text("select * from products where workspace_id = :id"), {"id": acme.id}
        )
        assert stolen.all() == []
        assert (await repos.connection.execute(text("select id from workspaces"))).scalars().all() == [globex.id]


async def test_raw_sql_cannot_write_into_another_workspace(postgres_store: PostgresStore) -> None:
    acme, globex = await two_workspaces_with_a_product_each(postgres_store)
    with pytest.raises(DBAPIError, match="row-level security"):
        async with postgres_store.transaction(globex.id) as repos:
            assert isinstance(repos, PostgresRepositories)
            await repos.connection.execute(
                text("insert into products values (:id, :ws, 'storage', 'Storage', 1, now())"),
                {"id": uuid4(), "ws": acme.id},
            )


async def test_raw_sql_cannot_leave_its_workspace(postgres_store: PostgresStore) -> None:
    acme, globex = await two_workspaces_with_a_product_each(postgres_store)
    async with postgres_store.transaction(globex.id) as repos:
        assert isinstance(repos, PostgresRepositories)
        moved = await repos.connection.execute(text("update products set name = 'Taken' where workspace_id = :id"), {"id": acme.id})
        assert moved.rowcount == 0


async def test_an_account_transaction_reads_only_its_own_memberships_and_writes_nothing(postgres_store: PostgresStore) -> None:
    acme, globex = await two_workspaces_with_a_product_each(postgres_store)
    async with postgres_store.transaction() as repos:
        alice = await repos.accounts.sign_in(
            Account(id=uuid4(), issuer="https://id.test", subject="alice", email="a@acme.test", created_at=NOW)
        )
        bob = await repos.accounts.sign_in(
            Account(id=uuid4(), issuer="https://id.test", subject="bob", email="b@acme.test", created_at=NOW)
        )
    for ws, who in ((acme, alice), (globex, bob)):
        async with postgres_store.transaction(ws.id) as repos:
            await repos.members.add(Member(workspace_id=ws.id, account_id=who.id, owner=True, created_at=NOW))
    async with postgres_store.transaction(account_id=alice.id) as repos:
        assert isinstance(repos, PostgresRepositories)
        assert (await repos.connection.execute(text("select id from workspaces"))).scalars().all() == [acme.id]
        assert (await repos.connection.execute(text("select account_id from members"))).scalars().all() == [alice.id]
        assert (await repos.connection.execute(text("select id from products"))).all() == []
    with pytest.raises(DBAPIError, match="row-level security"):
        async with postgres_store.transaction(account_id=alice.id) as repos:
            assert isinstance(repos, PostgresRepositories)
            await repos.connection.execute(
                text("insert into members values (:ws, :account, true, now())"), {"ws": globex.id, "account": alice.id}
            )
    async with postgres_store.transaction(account_id=alice.id) as repos:
        assert isinstance(repos, PostgresRepositories)
        changed = await repos.connection.execute(text("update members set owner = false"))
        assert changed.rowcount == 0


def test_every_workspace_table_has_row_level_security_forced(clean_postgres_url: str) -> None:
    dsn = make_url(clean_postgres_url).set(drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(dsn) as conn:
        tables = conn.execute(
            """
            select c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   exists (select from pg_policy p where p.polrelid = c.oid) as has_policy
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and (c.relname = 'workspaces' or exists (
                select from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped))
            """
        ).fetchall()
    assert {t[0] for t in tables} >= {"workspaces", "products", "members", "product_roles"}
    assert [t for t in tables if not (t[1] and t[2] and t[3])] == []


def test_tables_and_migrations_do_not_drift(clean_postgres_url: str) -> None:
    check(clean_postgres_url)


def test_migrating_again_is_harmless(clean_postgres_url: str) -> None:
    migrate(clean_postgres_url)


async def test_engine_works_behind_a_transaction_mode_pooler(clean_postgres_url: str) -> None:
    engine = create_engine(clean_postgres_url, transaction_pooler=True)
    try:
        store = PostgresStore(engine)
        ws = Workspace(id=uuid4(), name="ACME", created_at=NOW)
        for _ in range(3):  # the same statement, repeated, is never served from a cache
            async with store.transaction(ws.id) as repos:
                await repos.workspaces.get()
        await store.ping()
    finally:
        await engine.dispose()


async def test_an_unreachable_database_is_service_unavailable() -> None:
    from openentitlement_service.services.problems import ServiceUnavailable

    engine = create_engine("postgresql://oe:oe@127.0.0.1:1/oe")
    try:
        with pytest.raises(ServiceUnavailable):
            await PostgresStore(engine).ping()
    finally:
        await engine.dispose()


def test_sign_in_migration_can_roll_back_and_reapply(clean_postgres_url: str) -> None:
    from alembic import command

    from openentitlement_service.repositories.postgres.migrate import alembic_config

    command.downgrade(alembic_config(clean_postgres_url), "0001_baseline")
    migrate(clean_postgres_url)
    check(clean_postgres_url)
