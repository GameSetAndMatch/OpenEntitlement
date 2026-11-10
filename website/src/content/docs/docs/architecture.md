---
title: Architecture & scope
description: The entitlement model, evaluation protocol, and reference implementations as separate contracts.
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

[ADR-0001](https://github.com/open-entitlement/OpenEntitlement/blob/main/ADR-0001.md) records the architectural decision.

## A model that implementations can share

The specification defines features, typed privileges, plan values, overrides, grants, and the order in which they resolve. OEREP defines how a client requests a decision and how a server returns the value and explanation. Neither requires a particular billing vendor.

The included service and SDKs make the contract executable. The shared conformance scenarios check implementations against the same requirements. Alternative implementations must demonstrate conformance; sharing an HTTP shape alone is not enough.

## Interoperability

A shared contract lets developers evaluate entitlements without embedding a billing vendor's model throughout the application. Organizations can inspect the rules, test implementations against the same scenarios, and operate the reference service on their own infrastructure.

OpenFeature provides a complementary feature-flag API. OpenEntitlement is an independent project with no Apache or CNCF affiliation. Additional integrations must document their semantic mapping and demonstrate conformance before they can be described as compatible.

See [project status](/docs/project/) for the draft's compatibility and adoption boundaries.

## Protocol portability and hosted service

OpenEntitlement Cloud is intended as an economical hosted implementation, rather than a mandatory backend or a claim of enterprise compliance certification. The specification, SDK contract and conformance scenarios remain independent of its pricing, infrastructure and commercial tiers.

Organizations should be able to choose an implementation that meets their operational and compliance requirements while retaining application-facing entitlement checks. Switching providers requires verified semantic mappings, compatible evaluation behavior and portable Catalog/contract data; a similar API shape alone is insufficient. Publish actual provider capabilities and compatibility results rather than implying certification or guaranteed portability.

The hosted implementation's operating costs and commercial policies belong to that service. They do not define what another provider must charge or how it must deploy.
