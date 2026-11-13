"""Starting the service: configuration, migrations at startup, health."""
from __future__ import annotations

import psycopg
import pytest
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from openentitlement_service.interfaces.http import OidcSettings, SignInSettings
from openentitlement_service.main import Settings, build_app
from openentitlement_service.repositories.postgres.migrate import alembic_config

#: The latest migration.
HEAD = ScriptDirectory.from_config(alembic_config("")).get_current_head()


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


def test_defaults_listen_locally() -> None:
    settings = Settings.from_env({})
    assert (settings.port, settings.host, settings.database_url, settings.in_memory, settings.transaction_pooler) == (
        8787,
        "127.0.0.1",
        None,
        False,
        False,
    )


def test_refuses_to_start_without_a_database_unless_memory_is_chosen() -> None:
    with pytest.raises(SystemExit, match="DATABASE_URL"):
        build_app(Settings.from_env({}))
    with TestClient(build_app(Settings.from_env({"OE_IN_MEMORY": "true"}))) as client:
        assert client.get("/healthz").json() == {"status": "ok"}


def test_warns_when_the_database_role_could_bypass_row_level_security(
    migrated_postgres_url: str, caplog: pytest.LogCaptureFixture
) -> None:
    # The test role is a superuser, like the default role of the postgres image.
    with TestClient(build_app(Settings(database_url=migrated_postgres_url))):
        pass
    assert "bypass row-level security" in caplog.text


def test_service_applies_its_migrations_at_startup(fresh_database_url: str) -> None:
    with TestClient(build_app(Settings(database_url=fresh_database_url))) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
    dsn = make_url(fresh_database_url).set(drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(dsn) as conn:
        assert conn.execute("select version_num from alembic_version").fetchone() == (HEAD,)


def test_health_is_service_unavailable_when_the_database_is_gone() -> None:
    app = build_app(Settings(database_url="postgresql://oe:oe@127.0.0.1:1/oe"), migrate_at_startup=False)
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["type"] == "https://openentitlement.dev/problems/service-unavailable"


def test_startup_migrations_follow_the_transaction_pooler_setting(fresh_database_url: str) -> None:
    settings = Settings(database_url=fresh_database_url, transaction_pooler=True)
    with TestClient(build_app(settings)) as client:
        assert client.get("/healthz").json() == {"status": "ok"}


def test_sign_in_settings_come_from_the_environment() -> None:
    settings = Settings.from_env(
        {
            "OE_APP_URL": "https://console.acme.test/",
            "OE_OIDC_ISSUER": "https://id.acme.test/",
            "OE_OIDC_CLIENT_ID": "console",
            "OE_OIDC_CLIENT_SECRET": "s3cret",
            "OE_PLATFORM_ADMIN_SUBJECT": "root",
            "OE_SIGNUP_DOMAINS": " Acme.test, ,globex.test",
        }
    )
    assert settings.sign_in == SignInSettings(
        oidc=OidcSettings(app_url="https://console.acme.test", issuer="https://id.acme.test", client_id="console", client_secret="s3cret"),
        platform_admin_subject="root",
        allowed_domains=frozenset({"acme.test", "globex.test"}),
    )
    assert "s3cret" not in repr(settings)


def test_sign_in_is_off_without_an_issuer() -> None:
    assert Settings.from_env({"OE_APP_URL": "https://console.acme.test"}).sign_in is None


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"OE_OIDC_ISSUER": "https://id.acme.test"}, "OE_APP_URL"),
        ({"OE_OIDC_ISSUER": "http://id.acme.test", "OE_APP_URL": "https://console.acme.test"}, "HTTPS"),
        ({"OE_OIDC_ISSUER": "http://localhost:18790", "OE_APP_URL": "http://localhost:8787"}, "HTTPS"),
        ({"OE_OIDC_ISSUER": "https://id.acme.test", "OE_APP_URL": "https://console.acme.test/app"}, "origin"),
    ],
)
def test_refuses_unsafe_sign_in_settings(env: dict[str, str], message: str) -> None:
    with pytest.raises(SystemExit, match=message):
        Settings.from_env(env)


def test_loopback_http_is_allowed_only_when_asked() -> None:
    env = {"OE_OIDC_ISSUER": "http://localhost:18790", "OE_APP_URL": "http://localhost:8787", "OE_OIDC_LOCAL_HTTP": "true"}
    settings = Settings.from_env(env)
    assert settings.sign_in is not None and settings.sign_in.oidc.issuer == "http://localhost:18790"
