# 9. Layering and interoperability

## Overview

Four layers answer four different questions. They fail differently, are owned by different teams, and change at different speeds. Merging any two of them is the most common design error in this space. Some vendors build entitlements as feature flags with billing rules attached, which ties "is the code released?" to "has the customer paid?".

| Layer | Question | Owner | Failure |
|---|---|---|---|
| Authentication | who are you? | identity | 401 |
| Feature flag | is the code released (to you)? | engineering | 404 |
| Role / RBAC | may this **person** do X? | the customer's admin | 403 |
| **Entitlement** | may this **organization** do X, and how much? | the commercial agreement | 403 `entitlement_required` |

### 9.1. Separation

#### Requirement 9.1.1

> An implementation MUST NOT evaluate feature flags, roles, or permissions as part of resolution, and MUST NOT authenticate.

#### Requirement 9.1.2

> A provider MUST NOT be implemented by evaluating feature flags in an OpenFeature-compatible system *for the same keys the application also gates as flags* *(not mechanically testable)*.

Providers backed by a flag system are allowed (Schematic's model is close to this). Using the *same* key as both a release flag and an entitlement isn't: rolling a feature back would then revoke a paid entitlement, and granting a customer an entitlement would release unreleased code.

### 9.2. Recommended order of checks *(informative)*

```
authenticate → 401
is the feature flag on?           (OpenFeature)     → 404
may this person do it?            (RBAC)            → 403 forbidden
may this organization do it?      (OpenEntitlement) → 403 entitlement_required (+ requiredPlan)
```

Flags come before RBAC and entitlements, so unreleased features stay invisible (404) instead of advertising themselves through an upsell. RBAC comes before entitlements, so that a person who could never use the feature isn't shown an upgrade prompt they can't act on. Applications MAY invert the last two when the product wants to upsell to everyone.

### 9.3. OpenFeature

#### Requirement 9.3.1

> An SDK MUST NOT require OpenFeature, and MUST be usable alongside it.

*(informative)* When both are used:

- OpenFeature's `targetingKey` is usually the *user*. OpenEntitlement's `organizationId` is the *customer*. Map `subjectId` ↔ `targetingKey` and pass the organization as a flag-context attribute.
- A flag MAY target on entitlement state (for example "beta for every `enterprise` customer") by reading `planId` from resolution details into the flag context. The reverse MUST NOT happen ([Requirement 9.1.1](#requirement-911)).
- The hook model is deliberately the same, so one telemetry hook implementation can serve both.

### 9.4. Remote evaluation

[OEREP v1 (§10)](10-remote-evaluation.md) defines the remote contract, following [OFREP](https://github.com/open-feature/protocol)'s separation between generic SDK providers and compatible servers. OpenEntitlement supplies its own open-source entitlement server, backed by memory or Postgres, and a console for administration. The SDKs use a generic `RemoteProvider`; applications may also embed the reference storage providers.
