Connect to our [entitlement service](../console/README.md) using the generic `RemoteProvider` (included in core). See [OEREP v1](../spec/sections/10-remote-evaluation.md). Embedded storage providers remain available.

# OpenEntitlement, TypeScript SDK

Reference implementation of [OpenEntitlement spec v0.1.0](../spec/README.md). Node ≥ 20 (ESM), async API.

| Package | Depends on | Contents |
|---|---|---|
| `@openentitlement/core` | nothing | API, provider interface, `InMemoryProvider`, `FixedProvider`, `InProcessLock`, hooks, `resolveFromFacts` |
| `@openentitlement/postgres` | peer `pg` | `PostgresProvider`, `PostgresAdvisoryLock`, `migrate()`, `schema.sql` (same schema as Python) |
| `@openentitlement/stripe` | nothing (`fetch`, `node:crypto`) | `StripeEntitlementsProvider`, `verifyWebhook` |

## Typed authoring

Use the optional `@openentitlement/core/authoring` subpath with Zod for `PrivilegeSchema` and `PrivilegeCatalogSchema`. Runtime imports do not load Zod. See the [Python-first ACME case study](../docs/guides/acme-workspace.md) for equivalent JSON, Groups/Tags and the complete Workspace model.

## Quick start

```ts
import pg from "pg";
import { Catalog, createClient, feature, boolean, integer, enumeration, EntitlementDenied, toHttpProblem, UNLIMITED } from "@openentitlement/core";
import { PostgresProvider, PostgresAdvisoryLock } from "@openentitlement/postgres";

const catalog = new Catalog([
  feature("seats", "Seats", [integer("seat_max", { default: 1, unlimitedAllowed: true })]),
  feature("projects", "Projects", [integer("project_max")]),
  feature("sso", "Single sign-on", [boolean("sso_enabled"), integer("sso_connection_max")], { gate: "sso_enabled" }),
  feature("reports", "Reports", [boolean("reports_enabled"), enumeration("report_retention", ["7d", "90d", "365d"])], { gate: "reports_enabled" }),
]);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = createClient({
  provider: new PostgresProvider({ pool, autoMigrate: true }),
  catalog,
  lock: new PostgresAdvisoryLock({ pool }),
});

// values are data, audited
const meta = { actor: "alice@back-office", reason: "launch pricing" };
await client.admin.upsertPlan({ id: "pro", name: "Pro", rank: 10 }, meta);
await client.admin.setPlanValue("pro", "seat_max", UNLIMITED, meta);
await client.admin.assignPlan("acme", "pro", { ...meta, channel: "card" });

// gate
const ctx = { organizationId: "acme" };
await client.isEnabled("sso", ctx);
await client.getLimit("seat_max", ctx); // UNLIMITED, which JSON.stringify writes as {"unlimited":true}

// Express-style error mapping
app.use((err, req, res, next) => {
  if (err instanceof EntitlementDenied) {
    const { status, body } = toHttpProblem(err);
    return res.status(status).type("application/problem+json").send(body);
  }
  next(err);
});
```

`UNLIMITED` is a frozen singleton, not a number. `JSON.stringify` encodes it as `{"unlimited":true}`, and coercing it to a number throws. Use `isUnlimited()` and `fits()`.

`guard(privilege, requested, ctx, { count, act })` serializes check-then-act per `(organization, privilege)`. With `PostgresAdvisoryLock`, `count` and `act` receive the `PoolClient` of one transaction that holds `pg_advisory_xact_lock`.

## Development

```bash
npm install
npm run typecheck
npm test                                    # unit tests + conformance (in-memory, fixed, Stripe fake)
OE_PG_DSN=postgresql://... npm test         # + Postgres conformance
npm run build                               # emits dist/ for publishing
```

Sources are erasable-syntax TypeScript, so Node runs them directly (`--conditions=source` picks `src/` over `dist/` in the workspace). The conformance runner ([`conformance/`](conformance)) runs the same Gherkin files as the Python SDK.
