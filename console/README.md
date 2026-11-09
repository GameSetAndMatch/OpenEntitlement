# OpenEntitlement service and console

Our open-source entitlement server owns plans, assignments, negotiated overrides, additive grants, and audit records. It exposes OEREP v1 for generic SDK clients and a separate administrative API and web console. No billing vendor is required.

## Local demo

Requires Node >=22.18 (Node 24 recommended).

```sh
cd console
npm ci
npm run build
OE_SEED=demo npm start
```

Open http://localhost:8787. Without `OE_SEED=demo`, the memory backend starts empty and the console shows a setup screen. With it, the console loads five example organizations:

| Organization | Plan | Example entitlement |
|---|---|---|
| hooli | Free | 3 seats, 1 project, SSO disabled |
| globex | Pro | 20 seats, 5 projects, 150,000 API calls with organization grant; Hank has another 5,000 |
| initech | Pro trial | 8 projects through an override |
| acme | Business | 250 negotiated seats; unlimited API calls; SSO enabled |
| umbrella | Business after downgrade | 50 projects; old Enterprise override remains visible as stale |

Use Organizations to inspect values and reasons, Plans to compare limits, and Evaluate to check a feature or test current usage against a limit. Memory data resets on restart.

## Docker

See the [container setup and publishing guide](../docs/maintainers/docker-releases.md) to build locally, run the demo, configure PostgreSQL, and publish to Docker Hub through GitHub Actions.

## Persistent service

```sh
OE_PROVIDER=postgres DATABASE_URL=postgresql://oe:oe@localhost:55432/oe \
  OE_ADMIN_TOKEN=your-admin-token OE_EVAL_TOKEN=your-service-evaluation-token npm start
```

The server migrates its `oe_*` tables at startup. Set `OE_CATALOG` to a catalog JSON file. Postgres starts without demo data; create plans and assignments through the console. Configure the admin token in the console connection settings. `OE_SEED=demo` is intended for empty demo instances only. `OE_HOST` defaults to `127.0.0.1`; set it explicitly for container hosting. `PORT` defaults to 8787. Use TLS at a reverse proxy outside localhost.

`OE_PROVIDER=fixed` supports embedded self-hosted policies (`OE_FIXED_VALUES` supplies required finite limits). It has no mutations or inspection.

## OEREP v1

```sh
curl http://localhost:8787/oerep/v1/resolve/seats.max \
  -H 'Content-Type: application/json' \
  -d '{"context":{"organizationId":"acme"}}'
```

```ts
import { createClient, RemoteProvider } from "@openentitlement/core";
const client = createClient({ catalog, provider: new RemoteProvider({ baseUrl: "http://localhost:8787", token: process.env.OE_EVAL_TOKEN }) });
const seats = await client.getLimit("seats.max", { organizationId: "acme" });
```

```python
from openentitlement import create_client, RemoteProvider
client = create_client(catalog=catalog, provider=RemoteProvider("http://localhost:8787", token=eval_token))
seats = client.get_limit("seats.max", {"organization_id": "acme"})
```

Both clients use the application's catalog and validate remote values against it. They do not cache decisions. See the [protocol](../spec/sections/10-remote-evaluation.md) and [OpenAPI](../spec/oerep.openapi.json) for bulk resolution and suggestions.

## Administration and credentials

`/api/*` requires `OE_ADMIN_TOKEN` when configured. `/oerep/*` independently requires `OE_EVAL_TOKEN` when configured. Local demos allow anonymous access by default. Evaluation tokens are backend service credentials covering the entire instance, not per-tenant/browser tokens; the calling application must authorize organization access. Use distinct tokens in deployments.

The administrative API supports plans (`/api/plans`), organizations and plan assignments (`/api/organizations`), overrides and grants, evaluation (`/api/evaluate`, `/api/require`), and audit (`/api/audit`). Mutations go through SDK audit hooks and require a reason. `/api/meta` exposes the catalog and storage capabilities. Administration is not standardized by OEREP v1.

## Customer contracts

The console can attach private agreement/SLA PDFs and link them to negotiated overrides and grants. This service-only feature requires an admin token and does not change OEREP. See [contracts and PDF evidence](CONTRACTS.md) for setup, storage, and access details.

`DATABASE_URL` takes precedence over raw `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` connection fields. The Compose example uses raw fields so passwords containing URL-reserved characters remain intact.

## Validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:setup
```

HTTP integration tests exercise the actual service through the TypeScript SDK. Python's `tests/test_remote.py` starts the same service and exercises it through the Python SDK.
