---
title: Architecture & scope
description: Learn about architecture & scope in OpenEntitlement.
---

```text
Application
  → OpenEntitlement SDK
    → RemoteProvider
      → OEREP server
        → memory or Postgres entitlement facts
```

SDKs may also embed memory, Postgres, or fixed providers. The core packages have no runtime dependencies. Storage integrations are separate packages.

## One responsibility

The service owns entitlement facts and resolution: plans, assignments, overrides, grants, and audit records. The application owns usage and check-and-act transactions.

Authentication, RBAC, release flags, pricing, payment, invoicing, usage aggregation, and reservations remain separate. You can use OpenFeature alongside OpenEntitlement; neither is required by the other.

## Why a protocol?

The architecture follows OFREP's separation between generic SDK providers and compatible servers, while using entitlement-specific semantics. OpenEntitlement is an independent project, not an OpenFeature or CNCF project.

[ADR-0001](https://github.com/GameSetAndMatch/openentitlement/blob/main/ADR-0001.md) records the architectural decision.

## Current draft and future work

The implemented draft uses `variantOf` for trials and binds overrides to plan families. The proposed refinement—backend-owned plans with stable codes, explicit trial transitions, and exact-plan override binding—needs a separate implementation and specification change.

Quota windows, consumption idempotency, and usage storage are deferred. These docs describe current behavior rather than promises of a future metering platform.
