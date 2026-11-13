---
title: Introduction
description: Define entitlement behavior independently of billing vendors, then evaluate it through a shared API.
---

OpenEntitlement answers one question: **may this organization do X, and how much of it?**

It defines a vendor-neutral entitlement model and evaluation contract. OEREP specifies the HTTP boundary; the self-hosted service and TypeScript/Python SDKs are reference implementations. Applications declare their features and typed privileges in code. The service resolves plan values, negotiated overrides, and additive grants.

## Choose your path

- [Read the specification overview](/docs/specification/).

- [Run the demo in five minutes](/docs/quickstart/).
- [Understand plans, overrides, and grants](/docs/concepts/).
- [Connect a TypeScript application](/docs/typescript/) or [Python application](/docs/python/).
- [Host the service with Postgres](/docs/self-hosting/).
- [Implement the contract and demonstrate compatibility](/docs/implementing/).

## What the model covers

Entitlements describe the commercial agreement. Authentication identifies a caller. RBAC describes what that person may do. Feature flags control release. Keep those decisions separate.

OpenEntitlement does not invoice customers, process payments, aggregate usage, or reserve quota. Applications own usage counting and check-and-act transactions.

## Draft status

The specification is **v0.1.0, experimental**, and OEREP 0.1 is a draft protocol. These guides use the reference implementations from a source checkout. Read [project status](/docs/project/) before adopting the draft.
