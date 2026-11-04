---
title: Introduction
description: Learn about introduction in OpenEntitlement.
---

OpenEntitlement answers one question: **may this organization do X, and how much of it?**

It combines an open-source entitlement service, a remote evaluation protocol (OEREP), and reference SDKs for TypeScript and Python. Applications declare their features and typed privileges in code. The service resolves plan values, negotiated overrides, and additive grants.

## Choose your path

- [Run the demo in five minutes](/docs/quickstart/).
- [Understand plans, overrides, and grants](/docs/concepts/).
- [Connect a TypeScript application](/docs/typescript/) or [Python application](/docs/python/).
- [Host the service with Postgres](/docs/self-hosting/).
- [Implement the remote protocol](/docs/oerep/).

## One layer, done well

Entitlements describe the commercial agreement. Authentication identifies a caller. RBAC describes what that person may do. Feature flags control release. Keep those decisions separate.

OpenEntitlement does not invoice customers, process payments, aggregate usage, or reserve quota. Applications own usage counting and check-and-act transactions.

## Draft status

The specification is **v0.1.0, experimental**. OEREP v1 is a draft protocol. The service and SDKs are reference implementations in this repository; these guides use a source checkout rather than assuming published package releases.

The current model uses plan variants and family-bound overrides. A refined trial/plan model is planned separately; it is not implemented by this documentation website.
