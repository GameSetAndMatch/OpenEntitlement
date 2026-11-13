# openentitlement-service

The Python service that replaces the Node service in `console/server` ([ADR-0009](../../../ADR-0009.md)). It is in development on the `service/python` branch and is not released.

It has three layers, and dependencies point inward:

| Package | Contents | May import |
|---|---|---|
| `openentitlement_service.interfaces` | The HTTP API (FastAPI): routes, the single Problem Details handler, the per-request Workspace transaction (`workspace_transaction`), the console's static files | the service layer |
| `openentitlement_service.services` | Operations and rules, typed problems (`services/problems.py`), the records it works with and the repository protocols it needs (`services/repositories.py`) | Pydantic only: never FastAPI, FastMCP or SQLAlchemy |
| `openentitlement_service.repositories` | `memory`: in-memory repositories for fast tests. `postgres`: SQLAlchemy Core tables, asyncpg, Alembic migrations, row-level security | the service layer |

`openentitlement_service.main` wires them together. Interfaces and repositories never import each other. [import-linter](https://import-linter.readthedocs.io/) enforces the direction: run `uv run lint-imports` in this directory.

## Run it

From `sdk-python/`:

```sh
uv sync
DATABASE_URL=postgresql://oe:oe@127.0.0.1:55432/oe uv run openentitlement-service   # http://127.0.0.1:8787
OE_IN_MEMORY=true uv run openentitlement-service   # to try it out: data is lost on exit
```

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | none | Postgres URL (`postgresql://…`). Migrations are applied at startup. Required unless `OE_IN_MEMORY` is set. |
| `OE_IN_MEMORY` | `false` | `true` keeps data in memory, lost when the service stops. |
| `OE_DATABASE_TRANSACTION_POOLER` | `false` | Set to `true` behind a transaction-mode pooler such as PgBouncer: turns off asyncpg's prepared-statement cache. |
| `PORT` | `8787` | Listening port. |
| `OE_HOST` | `127.0.0.1` | Listening address. |
| `OE_CONSOLE_DIR` | `console/web/dist` in a checkout, when built | The built React console (`npm run build` in `console/`). Without it, only the API is served. |

`GET /healthz` answers `{"status": "ok"}`, or the [`service-unavailable`](https://openentitlement.dev/problems/service-unavailable/) problem when the database cannot be reached.

The container image builds the console and the service: from the repository root, `docker build -f service.Dockerfile .`.

## Errors

Every error is a typed exception in `services/problems.py` with a stable `type` URI, a status, a title and parameters. One handler (`interfaces/http/problems.py`) renders it as `application/problem+json` (RFC 9457). An HTTP error raised by the framework itself that no problem type describes (for example 413) becomes RFC 9457's untyped `about:blank` problem. Anything else becomes a generic [`internal-error`](https://openentitlement.dev/problems/internal-error/) and is logged, never returned. A new problem type needs a page in `website/src/content/docs/problems/`.

## Data and row-level security

Each table is a SQLAlchemy Core `Table` in `repositories/postgres/tables.py`. Each record has its own `version` for optimistic concurrency.

`Store.transaction(workspace_id)` opens one transaction bound to one Workspace; on the HTTP API the `workspace_transaction` dependency opens one per request, commits when the route returns and rolls back when it raises. On Postgres it switches to the `openentitlement_service` role (created by the first migration, never allowed to bypass row-level security) and sets `openentitlement.workspace_id`. Every Workspace table has a forced row-level security policy on that setting, so even a raw SQL query in the transaction sees and writes only that Workspace's rows.

Connect with a role that is **not** a superuser and has no `BYPASSRLS`: such a role could leave the `openentitlement_service` role with `RESET ROLE`. The service logs a warning at startup when it can. The connecting role must be allowed to create roles for the first migration (or an administrator creates `openentitlement_service` and grants it to that role beforehand).

### Change the schema

1. Edit `repositories/postgres/tables.py`.
2. Generate a migration from `sdk-python/packages/service`:

   ```sh
   export DATABASE_URL=postgresql://oe:oe@127.0.0.1:55432/oe
   uv run python -m openentitlement_service.repositories.postgres.migrate upgrade
   uv run python -m openentitlement_service.repositories.postgres.migrate revision "describe the change"
   ```

   Review the generated file in `repositories/postgres/migrations/versions/`.
3. A new Workspace table needs `rls.enable(table, "workspace_id")` in its migration. A test fails while any table with a `workspace_id` column lacks forced row-level security.
4. Tests fail when the tables and the migrations drift (`alembic check`).

## Tests

From `sdk-python/`, with a Postgres role allowed to create databases and roles:

```sh
OE_PG_DSN=postgresql://oe:oe@127.0.0.1:55432/oe uv run pytest tests/service
uv run ruff check packages/service tests/service
uv run mypy --strict packages/service/src
(cd packages/service && uv run lint-imports)
```

Without `OE_PG_DSN`, the Postgres tests are skipped. The tests sit at the seams of ADR-0009: the HTTP API as a black box, and a repository contract suite that runs against both the in-memory and the Postgres implementations.
