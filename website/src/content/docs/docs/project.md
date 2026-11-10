---
title: Project status
description: Draft compatibility, reference implementations, and how to report problems with OpenEntitlement.
---

OpenEntitlement is an independent, Apache-2.0-licensed project developing a vendor-neutral entitlement specification and remote evaluation protocol.

## Compatibility

The semantic specification is **v0.1.0, experimental**. OEREP v1 is a draft. Until the specification reaches 1.0, minor versions may introduce incompatible changes. Review the specification and pin a repository revision when evaluating the reference implementations.

The guides use a source checkout. They do not assume packages have been published to npm or PyPI.

## Reference implementations

The repository includes a Node service with memory or Postgres storage, an administrative console, and TypeScript and Python SDKs. Shared conformance scenarios exercise resolution, overrides, grants, limit checks, and error behavior.

[Inspect the source](https://github.com/open-entitlement/OpenEntitlement), [read the specification](/specification/01-data-model/), or [view CI results](https://github.com/open-entitlement/OpenEntitlement/actions).

## Adoption boundaries

Application authentication and tenant authorization remain the caller's responsibility. Evaluation credentials are trusted service credentials covering the instance; do not expose them to a browser or untrusted tenant.

Applications own usage storage, counting, reset windows, and consumption idempotency. The protocol does not reserve quota or process payments. Remote clients do not cache decisions in the current draft.

The current plan model uses variants and family-bound overrides. Applications relying on those semantics should consult the data-model specification before integrating.

## Report a problem

[Open an issue](https://github.com/open-entitlement/OpenEntitlement/issues) with the specification version or commit, SDK language, expected behavior, and a minimal reproducible example. Remove credentials and customer information from reports.

Contributions to the model, protocol, implementations, and documentation are welcome. See [contributing](/docs/contributing/) for development checks.
