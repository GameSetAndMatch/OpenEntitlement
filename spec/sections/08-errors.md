# 8. Errors

## Overview

Entitlement errors are designed for **UIs that upsell**. A locked feature should show a lock and say which plan unlocks it, instead of disappearing. Every denial therefore carries enough information to render that: the privilege, the limit, the usage, and `requiredPlan`.

### 8.1. Error types

#### Requirement 8.1.1

> `EntitlementLimitExceeded` MUST carry `privilege`, `feature`, `limit` (the resolved value), `current` (as passed), `requested`, the full resolution `details`, and `requiredPlan` when [Requirement 3.4.1](03-resolution.md#requirement-341) yields one.

#### Requirement 8.1.2

> `FeatureNotEntitled` MUST carry `feature`, `privilege` (the gate), the resolution `details`, and `requiredPlan` when one is known.

#### Requirement 8.1.3

> `EntitlementLimitExceeded` and `FeatureNotEntitled` MUST share a common base type, `EntitlementDenied`, so an application can map every denial to one HTTP response.

#### Requirement 8.1.4

> SDKs MUST also define `TypeMismatch`, `InvalidArgument`, `NotSupported`, `NotFound`, `Conflict`, and `InvalidValue`. These signal programming or administrative errors and MUST NOT extend `EntitlementDenied`.

#### Requirement 8.1.5

> Every error defined in this section MUST expose a stable machine-readable `code`: `entitlement_limit_exceeded`, `feature_not_entitled`, `TYPE_MISMATCH`, `INVALID_ARGUMENT`, `NOT_SUPPORTED`, `NOT_FOUND`, `CONFLICT`, `INVALID_VALUE`.

### 8.2. HTTP mapping

#### Requirement 8.2.1

> SDKs MUST provide `toHttpProblem(error)`, which maps an `EntitlementDenied` to status `403` and a JSON body:
>
> ```json
> {
>   "type": "urn:openentitlement:problem:entitlement-required",
>   "title": "Entitlement required",
>   "status": 403,
>   "error": "entitlement_required",
>   "code": "entitlement_limit_exceeded",
>   "feature": "projects",
>   "privilege": "projects.max",
>   "limit": 5,
>   "current": 5,
>   "requested": 1,
>   "requiredPlan": "business"
> }
> ```
>
> The body follows [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details. `error` MUST be `entitlement_required`, so clients can tell an entitlement 403 from an RBAC 403. `limit` MUST use the `UNLIMITED` encoding of [Requirement 1.2.3](01-data-model.md#requirement-123). Fields that don't apply (`limit`, `current`, and `requested` for `FeatureNotEntitled`, or `requiredPlan` when unknown) MUST be omitted.

#### Requirement 8.2.2

> An entitlement denial MUST NOT map to `401` or `404` *(not mechanically testable for applications, testable for `toHttpProblem`)*.

`404` means the code isn't released (feature flag), and `401` means "who are you?". Using either for an entitlement leaks one layer into another, and the UI can no longer show the lock.

### 8.3. UI guidance *(informative)*

- When a denial or `isEnabled` details carry `requiredPlan`, show the feature as **locked**, with an upgrade path to that plan.
- When `reason` is `ERROR`, don't show an upsell: the customer may well be entitled, and the system just doesn't know right now.
- When the current usage is above the limit (after a downgrade), show the data, explain the limit, and offer to upgrade or clean up. Don't hide anything.
