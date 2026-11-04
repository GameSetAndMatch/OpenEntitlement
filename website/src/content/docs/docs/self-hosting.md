---
title: Self-host the service
description: Learn about self-host the service in OpenEntitlement.
---

The entitlement service is a Node application. The static documentation website is a separate deployment; hosting this website on Cloudflare does not deploy the entitlement API.

## In-memory demo

Follow the [quickstart](/docs/quickstart/). Memory is useful for examples and tests; changes disappear on restart.

## Persistent Postgres deployment

The server uses the shared `oe_*` schema and migrates it on startup. Use a dedicated database and retain backups.

```sh
# From the repository root, install the storage SDK workspace too.
npm ci --prefix sdk-js
cd console
npm ci
npm run build
OE_PROVIDER=postgres \
DATABASE_URL=postgresql://oe:oe@localhost:5432/oe \
OE_ADMIN_TOKEN=replace-with-admin-token \
OE_EVAL_TOKEN=replace-with-distinct-evaluation-token \
OE_HOST=127.0.0.1 PORT=8787 npm start
```

The Postgres instance starts without demo plans. Create them through the audited administrative API, a seed, or a migration. The current console also supports plan creation and default editing; a future restricted plan-management model is not yet implemented.

## Configuration

| Variable | Purpose |
|---|---|
| `OE_PROVIDER` | `memory` (default), `postgres`, or `fixed` |
| `DATABASE_URL` | Required for Postgres |
| `OE_CATALOG` | Path to the application's catalog JSON |
| `OE_ADMIN_TOKEN` | Bearer token for `/api/*` |
| `OE_EVAL_TOKEN` | Distinct bearer token for `/oerep/*` |
| `OE_HOST` | Bind address; defaults to `127.0.0.1` |
| `PORT` | Defaults to `8787` |
| `OE_SEED` | `demo` for empty demo instances; otherwise `none` |
| `OE_FIXED_VALUES` | JSON values required by a fixed provider's finite integer privileges |

Use `OE_HOST=0.0.0.0` for container networking and terminate HTTPS at a reverse proxy. Configure both tokens for a hosted service; anonymous defaults are intended for local demos. Enter the admin token in the console's connection settings.

## Credential boundary

Evaluation tokens cover every organization in the service instance. They are for trusted backend services, not per-tenant browser access. Your application authenticates users and authorizes organization access before evaluating entitlements. Use separate admin and evaluation credentials.

OEREP does not lock your application's usage database. Use a shared application lock for multiple application instances.
