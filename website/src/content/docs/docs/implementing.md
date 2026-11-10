---
title: Implementing the contract
description: Build an entitlement provider or OEREP service and demonstrate semantic compatibility.
---

An integration should preserve the entitlement model's meaning, not just rename fields from another API. This guide describes how to evaluate a new implementation against the current draft; it is not a certification program.

## Choose the boundary

- **SDK provider:** implement the [provider interface](/specification/06-providers/), including resolution details and accurate capability declarations. Facts-based providers can reuse the reference resolver.
- **Remote service:** implement [OEREP v1](/specification/10-remote-evaluation/) so generic SDK providers can request decisions without vendor-specific client code.

A remote service also needs equivalent resolution semantics. Passing an OpenAPI schema check alone does not demonstrate that.

## Document the mapping

For a prospective integration, record:

| Concept | Question the integration must answer |
|---|---|
| Organization | Which identifier selects the entitled customer? |
| Catalog | How do feature keys, types, defaults, and enum order agree with the application? |
| Plan assignment | How is the current plan selected without putting payment-state rules into the application API? |
| Override | Does it replace the value, support the required scopes/dates, and become stale on family mismatch? |
| Grant | Does it add quota, survive plan changes, and remain limited to the matching subject? |
| Unlimited | Can it preserve the distinct unlimited value without substituting null or a large integer? |
| Failure | Does an error use the declared default and suppress upgrade suggestions? |
| Administration | Are supported mutations attributed, validated, and audited? |

State unsupported capabilities explicitly. A backend that always takes the most generous override does not implement a contractual cap; a consumed balance is not automatically a plan limit. Do not silently approximate either.

## Run the shared scenarios

Start with the [Gherkin suite](https://github.com/open-entitlement/OpenEntitlement/tree/main/spec/assets/gherkin) and its [execution rules](https://github.com/open-entitlement/OpenEntitlement/blob/main/spec/assets/gherkin/README.md). Scenarios are tagged by requirement and provider capability.

The reference harnesses supply examples of target setup, fact seeding, and test counters:

- [TypeScript targets](https://github.com/open-entitlement/OpenEntitlement/blob/main/sdk-js/conformance/targets.ts).
- [Python targets](https://github.com/open-entitlement/OpenEntitlement/blob/main/sdk-python/conformance/targets.py).

Run every applicable scenario. Explain capability-based skips; do not remove an untagged test to make an implementation pass. For a remote implementation, also test over a real HTTP boundary: encoding, authentication, invalid context, timeouts, malformed responses, and single/bulk consistency.

Use a disposable database for conformance tests. Existing Postgres harnesses reset fixtures; never point them at application or production data.

## Publish evidence with the implementation

A useful compatibility report identifies the specification revision, implementation revision, backend/runtime, declared capabilities, command used, passed/failed scenarios, and reasons for skips. Include wire tests separately from semantic tests so their coverage is clear.

OpenEntitlement currently supplies reference SDKs and a reference service. It does not maintain a certified vendor directory or assert compatibility for third-party products without evidence.

## Keep responsibilities clear

The application still authenticates users, authorizes tenant access, owns usage storage, and coordinates check-and-act transactions. Evaluation service credentials are not tenant-scoped browser credentials. See [self-hosting](/docs/self-hosting/) and [guards](/docs/guards/) for the operational boundary.
