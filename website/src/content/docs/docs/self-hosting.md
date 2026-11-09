---
title: Self-host the service
description: Run the entitlement service with Postgres and separate administrative and evaluation credentials.
---

The entitlement service is a Node application. The static documentation website is a separate deployment; hosting this website on Cloudflare does not deploy the entitlement API.

## Docker Compose

The repository ships two Compose files in [`deploy/`](https://github.com/GameSetAndMatch/openentitlement/tree/main/deploy). Both start with an empty workspace and open the console's setup screen.

| File | Storage | Use it for |
|---|---|---|
| `compose.memory.yaml` | In memory: data is lost on restart | Trying the console and the OEREP API |
| `compose.postgres.yaml` | Postgres in a named volume | Anything you want to keep |

```sh
# Throwaway
docker compose -f deploy/compose.memory.yaml up

# Persistent
cp deploy/.env.example deploy/.env      # set real tokens and a database password
docker compose -f deploy/compose.postgres.yaml --env-file deploy/.env up -d
```

Pin a release with `OE_VERSION` (for example `OE_VERSION=0.1.0`). Add `OE_SEED=demo` to the memory setup to load the sample organizations instead of the setup screen. The in-memory provider cannot persist to a volume: use Postgres for data you want to keep.

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
| `OE_SEED` | `demo` loads sample plans and organizations into a memory instance; the default (`none`) starts empty |
| `OE_FIXED_VALUES` | JSON values required by a fixed provider's finite integer privileges |

Use `OE_HOST=0.0.0.0` for container networking and terminate HTTPS at a reverse proxy. Configure both tokens for a hosted service; anonymous defaults are intended for local demos. Enter the admin token in the console's connection settings.

## Credential boundary

Evaluation tokens cover every organization in the service instance. They are for trusted backend services, not per-tenant browser access. Your application authenticates users and authorizes organization access before evaluating entitlements. Use separate admin and evaluation credentials.

OEREP does not lock your application's usage database. Use a shared application lock for multiple application instances.
