"""Starting the service: configuration, migrations at startup, health."""
from __future__ import annotations

import psycopg
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from openentitlement_service.main import Settings, build_app


def test_settings_come_from_the_environment(tmp_path) -> None:  # type: ignore[no-untyped-def]
    settings = Settings.from_env(
        {
            "PORT": "9000",
            "OE_HOST": "0.0.0.0",
            "DATABASE_URL": "postgresql://oe:oe@db:5432/oe",
            "OE_DATABASE_TRANSACTION_POOLER": "true",
            "OE_CONSOLE_DIR": str(tmp_path),
        }
    )
    assert settings == Settings(
        port=9000,
        host="0.0.0.0",
        database_url="postgresql://oe:oe@db:5432/oe",
        transaction_pooler=True,
        console_dir=tmp_path,
    )


def test_defaults_listen_locally_without_a_database() -> None:
    settings = Settings.from_env({})
    assert (settings.port, settings.host, settings.database_url, settings.transaction_pooler) == (
        8787,
        "127.0.0.1",
        None,
        False,
    )


def test_service_applies_its_migrations_at_startup(fresh_database_url: str) -> None:
    with TestClient(build_app(Settings(database_url=fresh_database_url))) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
    dsn = make_url(fresh_database_url).set(drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(dsn) as conn:
        assert conn.execute("select version_num from alembic_version").fetchone() == ("0001_baseline",)


def test_health_is_service_unavailable_when_the_database_is_gone() -> None:
    app = build_app(Settings(database_url="postgresql://oe:oe@127.0.0.1:1/oe"), migrate_at_startup=False)
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["type"] == "https://openentitlement.dev/problems/service-unavailable"
