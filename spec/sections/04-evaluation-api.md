# 4. Evaluation API

## Overview

Three calls answer almost every question an application asks, mirroring OpenFeature's typed getters:

```ts
client.isEnabled("sso", ctx)                          // → boolean
client.getLimit("seat_max", ctx)                     // → number | UNLIMITED
client.requireWithin("seat_max", current, 1, ctx)    // → details, or throws EntitlementLimitExceeded
```

Each one has a `…Details` form that returns the full **resolution details**, the counterpart of OpenFeature's `FlagEvaluationDetails`. Four more round out the API: `requireEnabled` (throws instead of returning `false`), `getEnum`, `guard` ([§5](05-concurrency.md)), and `requiredPlan`.

### 4.1. Client

#### Requirement 4.1.1

> An SDK MUST provide a way to create a client from a provider and a catalog. It MAY also accept a default context, hooks, a clock, and a lock.

#### Requirement 4.1.2

> The client MUST expose the metadata of its provider (at least `name`).

#### Requirement 4.1.3

> Evaluation methods MUST follow their language's idiom for I/O. An SDK whose providers may perform network I/O SHOULD expose evaluation as asynchronous.

### 4.2. Methods

#### Requirement 4.2.1

> `isEnabled(featureCode, context?) → boolean` and `isEnabledDetails(featureCode, context?) → ResolutionDetails<boolean>` MUST evaluate per [Requirement 3.2.1](03-resolution.md#requirement-321). They MUST NOT throw.

#### Requirement 4.2.2

> `requireEnabled(featureCode, context?) → ResolutionDetails<boolean>` MUST throw `FeatureNotEntitled` when `isEnabled` would return `false`, and return the details otherwise.

#### Requirement 4.2.3

> `getLimit(privilegeKey, context?) → integer | UNLIMITED` and `getLimitDetails(privilegeKey, context?)` MUST NOT throw. Called on a privilege that is not of type `integer`, they MUST return `0` with reason `ERROR` and error code `TYPE_MISMATCH`.

#### Requirement 4.2.4

> `requireWithin(privilegeKey, current, requested, context?) → ResolutionDetails<Limit>` MUST evaluate per [§3.3](03-resolution.md#33-limit-checks). It MUST return the details when the check passes, and MUST throw `EntitlementLimitExceeded` ([§8.1](08-errors.md#81-error-types)) when it fails.

#### Requirement 4.2.5

> `getEnum(privilegeKey, context?) → string` and `getEnumDetails(privilegeKey, context?)` MUST NOT throw. Called on a privilege that is not of type `enum`, they MUST return the empty string with reason `ERROR` and error code `TYPE_MISMATCH`.

#### Requirement 4.2.6

> `requiredPlan(privilegeKey, need, context?) → planId | absent` MUST return the plan defined by [§3.4](03-resolution.md#34-required-plan), where `need` is `true`, a `{current, requested}` pair, or an enum option.

#### Requirement 4.2.7

> `getDetails(privilegeKey, context?) → ResolutionDetails` MUST resolve a privilege of any type, with no type expectation, and MUST NOT throw. For a privilege that is not in the catalog, the value MUST be absent (`null`), with reason `ERROR` and error code `PRIVILEGE_NOT_FOUND`.

This is the generic call that admin tools, support consoles, and the conformance suite use.

### 4.3. Resolution details

#### Requirement 4.3.1

> Resolution details MUST contain:
>
> | field | type | meaning |
> |---|---|---|
> | `privilege` | string | the privilege key that was resolved (the gate, for `isEnabled`) |
> | `value` | boolean · integer · `UNLIMITED` · string | the resolved value |
> | `reason` | Reason | why this value ([§4.4](#44-reasons)) |
> | `grants` | list of `{id, amount, subjectId?}` | grants that were added, possibly empty |
> | `staleOverrides` | list of override ids | [Requirement 3.1.9](03-resolution.md#requirement-319), possibly empty |

#### Requirement 4.3.2

> Resolution details MUST contain the following fields when they apply, and MUST omit them otherwise: `feature` (when evaluated through `isEnabled`), `planId`, `planValue` ([Requirement 3.1.8](03-resolution.md#requirement-318)), `overrideId` (when the reason is `OVERRIDE`, or `GRANT` on top of an override), `requiredPlan` ([Requirement 3.4.1](03-resolution.md#requirement-341)), `errorCode`, and `errorMessage` (when the reason is `ERROR`).

#### Requirement 4.3.3

> Resolution details MUST be serializable to JSON, with `UNLIMITED` encoded per [Requirement 1.2.3](01-data-model.md#requirement-123).

### 4.4. Reasons

#### Requirement 4.4.1

> `reason` MUST be one of:
>
> | reason | when |
> |---|---|
> | `PLAN` | the value is the plan value |
> | `OVERRIDE` | an override replaced the plan value |
> | `GRANT` | grants were added to a finite base (plan, override, or default) |
> | `FIXED` | a fixed provider answered, for example a self-hosted install where everything is on and nothing can be overridden |
> | `DEFAULT` | no plan, or the plan sets no value, so the privilege's `default` was used |
> | `ERROR` | resolution failed, so the `default` was used ([Requirement 3.1.11](03-resolution.md#requirement-3111)) |

### 4.5. Error codes

#### Requirement 4.5.1

> `errorCode` MUST be one of `PROVIDER_NOT_READY`, `PRIVILEGE_NOT_FOUND`, `FEATURE_NOT_FOUND`, `TYPE_MISMATCH`, `INVALID_CONTEXT`, or `GENERAL`.
