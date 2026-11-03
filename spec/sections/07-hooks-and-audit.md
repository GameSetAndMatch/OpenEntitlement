# 7. Hooks and audit

## Overview

Hooks use OpenFeature's [hook model](https://openfeature.dev/specification/sections/hooks), with four stages: `before`, `after`, `error`, and `finally`. There are two kinds:

- **Evaluation hooks** run around every resolution (telemetry, logging, caching, metrics such as "how often do we deny `seats.max`?").
- **Mutation hooks** run around every administrative change. This is where the **audit trail** lives: every plan-value, assignment, override, and grant mutation emits `{actor, reason, before, after, at}`.

### 7.1. Evaluation hooks

#### Requirement 7.1.1

> An evaluation hook MAY implement `before(hookContext)`, `after(hookContext, details)`, `error(hookContext, error)`, and `finally(hookContext, details?)`. The hook context MUST provide the privilege key, the privilege's value type, the feature code (for `isEnabled`), the merged evaluation context, and the provider metadata.

#### Requirement 7.1.2

> Hooks MUST be registrable on the client. `before` hooks MUST run in registration order. `after`, `error`, and `finally` hooks MUST run in reverse registration order.

#### Requirement 7.1.3

> `after` MUST run when resolution returns a reason other than `ERROR`. `error` MUST run when resolution returns reason `ERROR`, or when a `before` hook throws. `finally` MUST run unconditionally.

#### Requirement 7.1.4

> A failed limit check is a successful evaluation. Hooks for the underlying resolution MUST run `after` (not `error`) before `EntitlementLimitExceeded` is thrown.

#### Requirement 7.1.5

> If a `before` hook throws, the SDK MUST skip resolution and return the default with reason `ERROR` and code `GENERAL`. If an `after`, `error`, or `finally` hook throws, the SDK MUST NOT change the evaluation result, and SHOULD log the error.

### 7.2. Mutation hooks

#### Requirement 7.2.1

> A mutation hook MAY implement `before(mutationContext)`, `after(mutationContext, auditEvent)`, `error(mutationContext, error)`, and `finally(mutationContext)`. The mutation context MUST provide the operation name, its arguments, `actor`, and `reason`.

#### Requirement 7.2.2

> If a mutation hook's `before` throws, the mutation MUST NOT be applied. The SDK MUST run `error` and `finally` and rethrow. This lets a policy hook veto a change (for example, "overrides above 1000 seats need approval").

#### Requirement 7.2.3

> `after` MUST run exactly once per successful mutation, with its audit event. `error` MUST run when the provider rejects the mutation. `finally` MUST run unconditionally.

#### Requirement 7.2.4

> A mutation hook's `after` that throws MUST NOT undo a mutation that has already committed. Durable audit is the provider's job ([Requirement 6.3.5](06-providers.md#requirement-635)). Hooks are for forwarding (to a SIEM, Slack, or a data warehouse).

### 7.3. Audit event

#### Requirement 7.3.1

> An audit event MUST contain:
>
> | field | meaning |
> |---|---|
> | `actor` | who made the change (a user id, a service name, `stripe-webhook`) |
> | `reason` | why (free text, required) |
> | `entity` | one of `plan`, `planValue`, `assignment`, `override`, `grant` |
> | `entityId` | the id of the entity (for `planValue`: `planId:privilegeKey`, for `assignment`: the organization id) |
> | `action` | one of `create`, `update`, `delete`, `revoke` |
> | `before` | the entity's state before the change, or `null` on `create` |
> | `after` | the entity's state after the change, or `null` on `delete` |
> | `at` | when the change took effect (from the client's clock) |
>
> `before` and `after` MUST be JSON-serializable per [Requirement 1.2.3](01-data-model.md#requirement-123).

#### Requirement 7.3.2

> Setting a plan value that has never been set MUST produce `action: create` with `before: null`. Changing an existing value MUST produce `action: update` with both `before` and `after`.

#### Requirement 7.3.3

> Assigning a plan to an organization that has none MUST produce `action: create`. Changing an existing assignment MUST produce `action: update`. Removing it MUST produce `action: delete`.
