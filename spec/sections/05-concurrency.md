# 5. Concurrency

## Overview

`requireWithin` is **check-then-act**. Take two parallel requests, each creating the 5th project of a 5-project plan. Both count 4, both pass, and the organization ends up with 6. This spec cannot fix that inside `requireWithin`, because the *act* (inserting the project) happens in the application's own storage, after the check returns.

The spec therefore separates two things:

- **`requireWithin`**: a pure check, with no atomicity guarantee.
- **`guard`**: check-then-act, serialized per `(organizationId, privilege)` through a pluggable **lock**, with the count and the act running inside the lock.

Serialization depends on *where the usage lives* (usually the application's database), not on where the limits come from. So the lock is a client option and not a provider capability. A remote service can supply the limits while a Postgres advisory lock in the application serializes the inserts.

### 5.1. requireWithin is not atomic

#### Requirement 5.1.1

> SDKs MUST document that `requireWithin` alone does not prevent concurrent requests from exceeding a limit *(not mechanically testable)*.

### 5.2. guard

```ts
await client.guard("project_max", 1, ctx, {
  count: (tx) => tx.query("select count(*) from projects where org_id = $1", [orgId]),
  act:   (tx) => tx.query("insert into projects ...", [...]),
});
```

#### Requirement 5.2.1

> SDKs MUST provide `guard(privilegeKey, requested, context, {count, act})`. Its steps are:
>
> 1. acquire the lock for the key `(organizationId, privilegeKey)`,
> 2. resolve the privilege,
> 3. call `count(tx)` to get `current` (an integer or a usage breakdown),
> 4. apply the `requireWithin` check,
> 5. if the check passes, call `act(tx)`,
> 6. release the lock.
>
> When the check passes, `guard` MUST return the result of `act` together with the resolution details. When it fails, `guard` MUST throw `EntitlementLimitExceeded` without calling `act`.

#### Requirement 5.2.2

> For a fixed lock domain, concurrent `guard` calls on the same key MUST be linearizable. Their outcome MUST equal that of some serial execution of the same calls.

Conformance: with a limit of `L` and a usage counter starting at `0`, `N > L` concurrent guards that each request `1` and increment the counter in `act` MUST result in exactly `L` successes, and the counter MUST end at `L`.

#### Requirement 5.2.3

> The lock key MUST include `organizationId` and `privilegeKey`. It MUST NOT include `subjectId` or `resourceId`.

A shared pool is shared across subjects, so locking per subject would let two users overdraw it together.

#### Requirement 5.2.4

> The lock MUST be released when `count`, the check, or `act` throws, and the error MUST propagate to the caller.

### 5.3. Locks

#### Requirement 5.3.1

> A lock MUST implement `run(key, fn(tx)) → result`. It MUST run `fn` with exclusive ownership of `key` within its domain, and MUST pass the same `tx` handle to both `count` and `act`. A transactional lock MUST run `count` and `act` in the same transaction and MUST commit only after `act` succeeds.

#### Requirement 5.3.2

> SDKs MUST ship an in-process lock and MUST document that it serializes only within one process. A client created without an explicit lock MUST use the in-process lock.

#### Requirement 5.3.3

> A lock MUST declare its `domain` (for example `process` or `database`). Resolution details returned from `guard` SHOULD carry it, so operators can tell when a deployment runs on process-local locks.

### 5.4. Reference: Postgres

*(informative)* The reference Postgres lock opens a transaction, takes `pg_advisory_xact_lock(hashtextextended('oe:' || organization_id || ':' || privilege, 0))`, runs `count` and `act` on the same connection, and commits. The advisory lock is released at commit or rollback. Hash collisions only cause extra serialization, never incorrect results. Alternatives are an explicit lock row (`SELECT … FOR UPDATE` on a per-subject row) or `SERIALIZABLE` isolation with retry.
