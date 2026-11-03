# 6. Providers

## Overview

A **provider** answers resolution requests from one source of truth: memory, a Postgres schema, Stripe, Stigg, Lago, or an in-house service. The SDK owns the API surface, the checks, hooks, errors, and locking. The provider owns *facts and resolution*.

There are two ways to write one:

- **Facts-based:** implement a small *fact source* (assignment, plan, plan value, overrides, grants, plans) and reuse the SDK's `resolveFromFacts`. The in-memory and Postgres reference providers work this way, and conformance mostly comes for free.
- **Resolving:** implement `resolve` directly, for vendors that compute entitlements themselves (the Stripe adapter, for example).

```ts
interface Provider {
  metadata: { name: string };
  capabilities: Capabilities;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
  resolve(privilege: PrivilegeDefinition, ctx: ResolvedContext): Promise<ResolutionDetails>;
  suggestPlan?(privilege: PrivilegeDefinition, need: Need, ctx: ResolvedContext): Promise<string | undefined>;
  mutations?: Mutations;   // present when capabilities.mutations
}
```

### 6.1. Interface

#### Requirement 6.1.1

> A provider MUST expose `metadata` with a `name`.

#### Requirement 6.1.2

> A provider MUST implement `resolve(privilegeDefinition, context)`, where the context's `now` is already set, and MUST follow [§3](03-resolution.md) for every fact it supports.

#### Requirement 6.1.3

> A provider MUST declare its capabilities, each of them `true` or `false`:
>
> | capability | meaning |
> |---|---|
> | `overrides` | the provider stores overrides and applies them |
> | `grants` | the provider stores grants and applies them |
> | `mutations` | the provider implements the mutation interface ([§6.3](#63-mutations)) |
> | `planCatalog` | the provider can enumerate plans and implements `suggestPlan` |
> | `fixed` | the provider is a fixed provider ([§6.4](#64-the-fixed-provider)) |

#### Requirement 6.1.4

> A provider without the `overrides` capability MUST NOT return reason `OVERRIDE`. A provider without the `grants` capability MUST NOT return reason `GRANT`.

#### Requirement 6.1.5

> A provider SHOULD NOT throw from `resolve`. The SDK MUST catch anything a provider throws and convert it into reason `ERROR` with code `GENERAL` (or `PROVIDER_NOT_READY` if the provider signalled it).

#### Requirement 6.1.6

> If the provider has an `initialize` function, the SDK MUST call it before the first evaluation, and evaluations MUST NOT reach `resolve` before it completes. If `initialize` fails, evaluations MUST return reason `ERROR` with code `PROVIDER_NOT_READY`.

### 6.2. Plan changes

#### Requirement 6.2.1

> On a plan change, a provider MUST NOT delete or modify overrides or grants, and MUST NOT delete, hide, or lock application data.

Overrides go stale ([Requirement 1.5.4](01-data-model.md#requirement-154)). Grants keep applying ([Requirement 1.6.3](01-data-model.md#requirement-163)).

### 6.3. Mutations

Mutations are the administrative surface: the back office, support tooling, and billing webhooks.

```ts
interface Mutations {
  upsertPlan(plan, meta): Promise<MutationResult>;
  setPlanValue(planId, privilegeKey, value, meta): Promise<MutationResult>;
  assignPlan(organizationId, planId | null, channel | undefined, meta): Promise<MutationResult>;
  createOverride(input, meta): Promise<MutationResult>;
  deleteOverride(overrideId, meta): Promise<MutationResult>;
  createGrant(input, meta): Promise<MutationResult>;
  revokeGrant(grantId, meta): Promise<MutationResult>;
}
type MutationMeta = { actor: string; reason: string };
```

#### Requirement 6.3.1

> A provider with the `mutations` capability MUST implement every operation above. Clients MUST NOT call them directly on the provider: they MUST go through the SDK's admin interface, so that mutation hooks run ([§7.2](07-hooks-and-audit.md#72-mutation-hooks)).

#### Requirement 6.3.2

> Every mutation MUST require a non-empty `actor` and a non-empty `reason`, and MUST fail with `INVALID_ARGUMENT` when either is missing.

#### Requirement 6.3.3

> Every successful mutation MUST return an [audit event](07-hooks-and-audit.md#73-audit-event) describing it.

#### Requirement 6.3.4

> A provider MUST fail with `NOT_FOUND` when a mutation references a plan, override, or grant that doesn't exist, and with `INVALID_VALUE` when a value violates [Requirement 1.5.6](01-data-model.md#requirement-156) or [Requirement 1.6.2](01-data-model.md#requirement-162). A failed mutation MUST NOT change any state.

#### Requirement 6.3.5

> A provider SHOULD persist the audit event atomically with the mutation, so that no committed change can exist without its audit record.

#### Requirement 6.3.6

> Calling a mutation on the admin interface of a provider without the `mutations` capability MUST throw `NotSupported`.

### 6.4. The fixed provider

Self-hosted and on-premise installs often have no billing system to ask. In that case everything is on and nothing can be overridden.

#### Requirement 6.4.1

> SDKs MUST ship a fixed provider. It resolves `boolean` privileges to `true`. It resolves `integer` privileges to `UNLIMITED` when `unlimitedAllowed` is set, and otherwise to an explicitly configured value. It resolves `enum` privileges to their last (most generous) option, unless configured otherwise. The reason MUST be `FIXED`.

#### Requirement 6.4.2

> Creating a fixed provider for a catalog that contains an `integer` privilege with `unlimitedAllowed: false` and no configured value MUST fail.

#### Requirement 6.4.3

> The fixed provider MUST declare `fixed: true` and every other capability `false`.

### 6.5. Adapters

#### Requirement 6.5.1

> Adapters for third-party vendors MUST be distributed separately from the core SDK. The core SDK MUST NOT depend on any vendor SDK *(packaging requirement)*.

#### Requirement 6.5.2

> An adapter MUST document how it maps the vendor's concepts onto this model, including which capabilities it lacks.
