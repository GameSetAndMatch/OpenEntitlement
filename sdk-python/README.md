Connect to our [entitlement service](../console/README.md) using the generic `RemoteProvider` (included in core). See [OEREP v1](../spec/sections/10-remote-evaluation.md). Embedded storage providers remain available.

# OpenEntitlement, Python SDK

Reference implementation of [OpenEntitlement spec v0.1.0](../spec/README.md). Python ≥ 3.10, synchronous API.

| Package | Depends on | Contents |
|---|---|---|
| `openentitlement` | nothing | API, provider interface, `InMemoryProvider`, `FixedProvider`, `InProcessLock`, hooks, `resolve_from_facts` |
| `openentitlement-postgres` | `psycopg>=3.1` | `PostgresProvider`, `PostgresAdvisoryLock`, `migrate()`, [`schema.sql`](packages/openentitlement-postgres/src/openentitlement_postgres/schema.sql) |
| `openentitlement-stripe` | nothing (stdlib HTTPS) | `StripeEntitlementsProvider`, `verify_webhook` |

## Quick start

```python
from openentitlement import (
    Catalog, Plan, UNLIMITED, EntitlementLimitExceeded, create_client, feature, boolean, integer, enum, to_http_problem,
)
from openentitlement_postgres import PostgresProvider, PostgresAdvisoryLock

# 1. Definitions live in code (spec §1.1)
catalog = Catalog([
    feature("seats", "Seats", [integer("seats.max", default=1, unlimited_allowed=True)]),
    feature("projects", "Projects", [integer("projects.max")]),
    feature("sso", "Single sign-on", [boolean("sso.enabled"), integer("sso.connections.max")], gate="sso.enabled"),
    feature("reports", "Reports", [boolean("reports.enabled"), enum("reports.retention", ["7d", "90d", "365d"])], gate="reports.enabled"),
])

dsn = "postgresql://localhost/app"
client = create_client(PostgresProvider(dsn, auto_migrate=True), catalog, lock=PostgresAdvisoryLock(dsn))

# 2. Values are data, changed at runtime and audited (spec §1.3, §7.3)
admin = dict(actor="alice@back-office", reason="launch pricing")
client.admin.upsert_plan(Plan("pro", "Pro", rank=10), **admin)
client.admin.set_plan_value("pro", "projects.max", 5, **admin)
client.admin.assign_plan("acme", "pro", channel="contract", **admin)
client.admin.create_override("acme", "projects.max", 12, actor="sales", reason="MSA #42, 12 projects")
client.admin.create_grant("acme", "projects.max", 3, actor="support", reason="goodwill", subject_id="u_7")

# 3. Gate (spec §4)
ctx = {"organizationId": "acme", "subjectId": "u_7"}
client.is_enabled("sso", ctx)                    # False, details carry required_plan when a plan unlocks it
client.get_limit("projects.max", ctx)            # 15 (override 12 + personal grant 3)

try:
    result = client.guard(                       # serialized check-then-act (spec §5)
        "projects.max", 1, ctx,
        count=lambda tx: tx.execute("select count(*) from projects where org_id = %s", ["acme"]).fetchone()[0],
        act=lambda tx: tx.execute("insert into projects (org_id) values (%s) returning id", ["acme"]).fetchone()[0],
    )
except EntitlementLimitExceeded as e:
    status, body = to_http_problem(e)            # 403 {"error": "entitlement_required", "requiredPlan": "business", ...}
```

`require_within(privilege, current, requested, ctx)` is the check-only form. It is **not atomic** with whatever you do next (spec §5.1). Use `guard` whenever the count and the insert must not race.

### Self-hosted

```python
from openentitlement import FixedProvider
client = create_client(FixedProvider(catalog, {"projects.max": 10_000, "sso.connections.max": 100}), catalog)
```

### Hooks

Evaluation hooks subclass `Hook` (`before`, `after`, `error`, `finally_after`). Mutation hooks subclass `MutationHook`, receive an `AuditEvent` in `after`, and can veto a change by raising in `before`. Python has no method named `finally` (it is a keyword), so the `finally` stage is `finally_after`.

## Stripe adapter

```python
from openentitlement_stripe import StripeEntitlementsProvider, verify_webhook

stripe = StripeEntitlementsProvider(
    os.environ["STRIPE_SECRET_KEY"],
    customer_for=lambda org_id: db.stripe_customer_id(org_id),
    mapping={"legacy-bundle": {"seats.max": 25}},   # optional, for lookup keys you can't rename
)
# webhook endpoint:
event = verify_webhook(request.body, request.headers["Stripe-Signature"], os.environ["STRIPE_WEBHOOK_SECRET"])
stripe.handle_event(event)  # refreshes the cache on entitlements.active_entitlement_summary.updated
```

Stripe features are boolean `lookup_key`s attached to products. The adapter reads values from a naming convention: `sso.enabled`, `seats.max:50`, `seats.max:unlimited`, `reports.retention:365d`. Several matches resolve to the most generous value. Capabilities: none of `overrides`, `grants`, `mutations`, `planCatalog` (Stripe has no such concepts), so there is no `required_plan` either. A boolean missing from a customer that has other active entitlements resolves to `False` with reason `PLAN`. To combine Stripe limits with your own overrides, write a provider that composes this one with a facts source, and pass a `PostgresAdvisoryLock` for `guard`.

For seats bought in Stripe's billing portal (spec Req 1.8.3), set the portal's quantity maximum from `get_limit("seats.max")`, and check observed quantities in your `customer.subscription.updated` webhook with `require_within`.

## Development

```bash
uv sync
uv run pytest                                   # unit tests + conformance (in-memory, fixed, Stripe fake)
OE_PG_DSN=postgresql://... uv run pytest        # + Postgres conformance
uv run ruff check packages
```

The conformance runner ([`conformance/`](conformance)) has no dependencies: a small Gherkin parser, step definitions, and one `Target` per provider. To certify your own provider, add a `Target` in `conformance/targets.py`.

## Commit hooks and dependency checks

From the repository root:

```bash
uv sync --project sdk-python --locked
uv run --project sdk-python pre-commit install
uv run --project sdk-python pre-commit run --all-files
```

Installation enables both `pre-commit` and `commit-msg` hooks. Following [Substrate](https://github.com/superlinear-ai/substrate), Commitizen checks Conventional Commit messages (for example `feat(python): add remote provider`) and `uv lock --check` detects stale dependency locks. We also run [Deptry](https://deptry.com/) separately for each Python distribution, so an adapter's dependencies cannot hide a missing dependency in core. Tools run from the locked development environment; they are not SDK runtime dependencies. CI runs the lock and dependency hooks too.

Deptry scans package source against each package's metadata. It does not replace tests or verify all dynamic imports. Commitizen runs for new commit messages, not the repository's historical commits.
