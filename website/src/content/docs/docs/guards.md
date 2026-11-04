---
title: Guards & usage
description: Serialize resolve, count, check, and act around application-owned usage.
---

OpenEntitlement resolves limits. Your application stores and counts consumption. A separate count followed by an insert can race, so a production check-and-act must use a lock shared by all competing callers.

## Guard sequence

```text
acquire (organization, privilege) lock
  → resolve once
  → count application usage
  → check the resolved limit
  → perform the action if allowed
release lock
```

`guard` returns the action result and resolution details, or throws an entitlement denial without running the action. A failed action releases the lock.

## TypeScript example

The following callbacks are application-specific. With `PostgresAdvisoryLock`, `tx` is the `PoolClient` of a transaction holding an advisory lock.

```ts
await client.guard('projects.max', 1, { organizationId }, {
  count: async (tx) => {
    const { rows } = await tx.query(
      'select count(*)::integer as n from projects where organization_id = $1',
      [organizationId],
    );
    return rows[0].n;
  },
  act: async (tx) => tx.query(
    'insert into projects (organization_id, name) values ($1, $2)',
    [organizationId, 'New project'],
  ),
});
```

Configure the client with `lock: new PostgresAdvisoryLock({ pool })` from `@openentitlement/postgres`. Without it, the default in-process lock protects only that client lock instance, not multiple processes or independent clients.

Python provides the same pattern using `PostgresAdvisoryLock`, `count(tx)`, and `act(tx)` callbacks.

## Pools and personal allowances

Supply `{pool, subject}` where `pool` is consumption of the shared pool by everyone, and `subject` is consumption of this subject's own allowance. Personal allowance is drawn first. Organization-wide grants join the pool.

`poolUsage` / `pool_usage` helps compute pool draw from usage and per-subject allowances. It does not store or meter usage.

## Scope for now

Consumption idempotency, reset periods, quota windows, reservations, and metering are application responsibilities. OEREP v1 does not supply those services. All code paths that create the gated resource must participate in the same locking strategy.

See the [concurrency specification](/specification/05-concurrency/).
