# openentitlement-service

The Python service that replaces the Node service in `console/server` ([ADR-0009](../../../ADR-0009.md)). It is in development on the `service/python` branch and is not released.

It has three layers, and dependencies point inward:

| Package | Contents | May import |
|---|---|---|
| `openentitlement_service.interfaces` | The HTTP API (FastAPI): routes, the single Problem Details handler, the per-request Workspace transaction (`WorkspaceTransaction`), the console's static files | the service layer |
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
| `OE_DATABASE_TRANSACTION_POOLER` | `false` | Set to `true` behind a transaction-mode pooler such as PgBouncer: turns off asyncpg's prepared-statement cache, for requests and startup migrations alike. |
| `PORT` | `8787` | Listening port. |
| `OE_HOST` | `127.0.0.1` | Listening address. |
| `OE_CONSOLE_DIR` | `console/web/dist` in a checkout, when built | The built React console (`npm run build` in `console/`). Without it, only the API is served. |
| `OE_OIDC_ISSUER` | none | The OpenID Connect issuer people sign in with. Without it, nobody can sign in (`/auth/login` answers `service-unavailable`). |
| `OE_APP_URL` | none | The console's origin, required with `OE_OIDC_ISSUER`, for example `https://console.example.com`. Register `OE_APP_URL/auth/callback` as the client's redirect URI. |
| `OE_OIDC_CLIENT_ID` | `openentitlement` | The OIDC client ID. |
| `OE_OIDC_CLIENT_SECRET` | none | The client secret, sent with HTTP Basic authentication. Without it the client is public (PKCE only). |
| `OE_OIDC_LOCAL_HTTP` | `false` | `true` allows plain HTTP for the issuer and app URL on loopback only, for local development. Otherwise both must be HTTPS. |
| `OE_PLATFORM_ADMIN_SUBJECT` | none | The OIDC subject that becomes a Platform administrator when it signs in. |
| `OE_SIGNUP_DOMAINS` | all | Comma-separated email domains allowed to sign in. |

`GET /healthz` answers `{"status": "ok"}`, or the [`service-unavailable`](https://openentitlement.dev/problems/service-unavailable/) problem when the database cannot be reached.

The container image builds the console and the service: from the repository root, `docker build -f service.Dockerfile .`.

For local sign-in, start the development issuer from `console/` (`OE_APP_URL=http://localhost:8787 npm run dev:issuer`) and run the service with `OE_OIDC_ISSUER=http://localhost:18790 OE_APP_URL=http://localhost:8787 OE_OIDC_LOCAL_HTTP=true OE_PLATFORM_ADMIN_SUBJECT=local-admin`. Sign in as `local-admin` or `local-user` with any password.

## Sign-in and authorization

`GET /auth/login` starts the OpenID Connect authorization code flow with PKCE (S256), state and nonce; `GET /auth/callback` verifies the ID token (signature from the issuer's keys, issuer, audience, expiry, nonce) and the UserInfo email, which must be verified, then sets the `oe_session` cookie (HttpOnly, SameSite=Lax, Secure over HTTPS, 12 hours) and returns to `/app/`. `POST /auth/logout` ends the session. Sign-in flows and sessions are stored as SHA-256 hashes only.

Every `/api/` route needs the session. A request that changes something must also send the console's `Origin` and the session's CSRF token in `X-OE-CSRF`; `GET /api/session` returns that token with the Account.

Routes take `CurrentAccount` (the signed-in Account) or `WorkspaceAccess` (one transaction in the Workspace of the path, opened as that Account). A non-member gets `not-found`. The service layer then asks the `Actor` for each operation (`services/access.py`): Owners and Platform administrators may do everything, a Product's Manager edits it, its User reads it. A Product where the Actor has no Role is `not-found`; a visible one the Role cannot change is `permission-denied`.

| Route | Who |
|---|---|
| `GET /api/workspaces` · `POST /api/workspaces` | Any signed-in Account: list your Workspaces (every one for a Platform administrator) or create one, which starts with one Product and makes you its Owner |
| `GET /api/workspaces/{id}` · `GET …/products` · `GET …/products/{product}` | Members, with the Products where they have a Role |
| `POST …/products` · `PATCH …/products/{product}` · `POST …/products/{product}/archive` · `…/restore` · `DELETE …/products/{product}?version=` | Owners: create, rename, archive, restore and delete Products. Changes name the version they were made from (`revision-conflict` otherwise); a Product's ID and key never change; a used Product or the last one cannot be deleted |


Every error is a typed exception in `services/problems.py` with a stable `type` URI, a status, a title and parameters. One handler (`interfaces/http/problems.py`) renders it as `application/problem+json` (RFC 9457). An HTTP error raised by the framework itself that no problem type describes (for example 413) becomes RFC 9457's untyped `about:blank` problem. Anything else becomes a generic [`internal-error`](https://openentitlement.dev/problems/internal-error/) and is logged, never returned. A new problem type needs a page in `website/src/content/docs/problems/`.

Product deletions serialize within their Workspace before checking the remaining count, so concurrent deletions cannot remove its last Product. Edits to different Products remain independent.

## Data and row-level security

Each table is a SQLAlchemy Core `Table` in `repositories/postgres/tables.py`. Each record has its own `version` for optimistic concurrency.

Accounts, sessions and sign-in flows belong to no Workspace and have no row-level security. `Store.transaction(account_id=…)` binds an Account in `openentitlement.account_id`, which only lets it read its own memberships and the Workspaces they belong to (every Workspace for a Platform administrator): the Workspace switcher. Writes stay bound to the transaction's Workspace.

`Store.transaction(workspace_id)` opens one transaction bound to one Workspace; on the HTTP API a route takes `repos: WorkspaceTransaction` to get one per request. It commits when the route returns and rolls back when it raises, both before the response is sent, so a failed COMMIT becomes an `internal-error` problem rather than a success. A duplicate unique key raises `AlreadyExists` from either implementation. On Postgres it switches to the `openentitlement_service` role (created by the first migration, never allowed to bypass row-level security) and sets `openentitlement.workspace_id`. Every Workspace table has a forced row-level security policy on that setting, so even a raw SQL query in the transaction sees and writes only that Workspace's rows.

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


### Product Catalog (OPE-39)

`GET /api/workspaces/{workspace_id}/products/{product_id}/catalog` returns the canonical
`catalog`, per-kind `versions`, and Catalog-facing `variants` (values and versions).
`PUT` at the same address accepts `{kind, entry, version, variantValues?}`. `kind` is
`groups`, `tags` or `privileges`; `entry` is the SDK's camelCase Group, Tag or typed Privilege.
Use version `0` to create, or the record's last-read version to edit. A stale save returns
`revision-conflict` with the record kind and ID. Different records have independent versions.

The console Catalog uses the selected Product and its Role. Managers edit their Product;
Users read it; Owners administer every Product. Validation uses the SDK Catalog models,
including acyclic Group references, unique Tags, typed defaults and restrictive boolean
prerequisites. Catalog saves ask for no contract-term reason. `validation-failed` errors
point at the submitted JSON (`/entry/default`, `/entry/parentId`, `/entry/tags/1`,
`/variantValues/{variant_id}/value`), never at SDK union or discriminator branch names.

A required Privilege can supply `variantValues: {variant_id: {version, value}}` in the same
save. All existing variants must have valid values; a missing value or stale variant rolls
back the entire save. A Read-only Privilege uses its Catalog default (RFC-0002): its
variant values are neither validated nor accepted in `variantValues`, and stored ones are kept
unchanged with no effect. They are validated again if the Privilege becomes editable. Clearing
them, with a console confirmation, is the separate OPE-54 policy. `catalog_variant_values` is the Catalog-facing value storage seam for
OPE-40's Tier lifecycle, which must take the same Product lock before creating/changing
variants. No Tier creation API is introduced here. Write audit facts include the real Account,
Product, target name, before/after definition and variant values; the repositories read them back
per Product (`changes`); the filtered audit view is OPE-43.

Run `uv run pytest -q tests/service/test_catalog_service.py tests/service/test_http_catalog.py`
from `sdk-python` for the shared memory/Postgres behavior tests. Set `OE_PG_DSN` for Postgres.
`npm run test:python-service` from `console` exercises real sign-in and the Catalog in Chromium.
