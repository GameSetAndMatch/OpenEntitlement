"""Shared fixtures for the Python service tests (ADR-0009 test seams).

Postgres tests need ``OE_PG_DSN`` (for example ``postgresql://oe:oe@127.0.0.1:55432/oe``) and a
role allowed to create databases and roles. Each test session migrates a fresh database and
drops it afterwards. Without ``OE_PG_DSN`` they are skipped.
"""
from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Iterator

import psycopg
import pytest
from sqlalchemy.engine import make_url

from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.repositories.postgres import PostgresStore, create_engine, migrate
from openentitlement_service.services.repositories import Store

ADMIN_DSN = os.environ.get("OE_PG_DSN")


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def _fresh_database() -> Iterator[str]:
    if not ADMIN_DSN:
        pytest.skip("set OE_PG_DSN to run the Postgres tests")
    name = f"oe_service_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    url = make_url(ADMIN_DSN).set(drivername="postgresql+asyncpg", database=name)
    try:
        yield url.render_as_string(hide_password=False)
    finally:
        with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)')


@pytest.fixture(scope="session")
def migrated_postgres_url() -> Iterator[str]:
    """A database migrated once for the session, dropped at the end."""
    for url in _fresh_database():
        migrate(url)
        yield url


@pytest.fixture
def fresh_database_url() -> Iterator[str]:
    """An empty database that no migration has touched, dropped after the test."""
    yield from _fresh_database()


def _sync_dsn(url: str) -> str:
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


@pytest.fixture
def clean_postgres_url(migrated_postgres_url: str) -> str:
    """The migrated database, emptied for this test."""
    with psycopg.connect(_sync_dsn(migrated_postgres_url), autocommit=True) as admin:
        admin.execute("truncate products, workspaces cascade")
    return migrated_postgres_url


@pytest.fixture
async def postgres_store(clean_postgres_url: str) -> AsyncIterator[PostgresStore]:
    engine = create_engine(clean_postgres_url)
    try:
        yield PostgresStore(engine)
    finally:
        await engine.dispose()


@pytest.fixture(params=["memory", "postgres"])
async def store(request: pytest.FixtureRequest) -> AsyncIterator[Store]:
    """Every repository contract runs against both implementations."""
    if request.param == "memory":
        yield InMemoryStore()
        return
    engine = create_engine(request.getfixturevalue("clean_postgres_url"))
    try:
        yield PostgresStore(engine)
    finally:
        await engine.dispose()
