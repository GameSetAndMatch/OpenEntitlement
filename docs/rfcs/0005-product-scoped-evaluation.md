# RFC-0005: Product-scoped remote evaluation

- **Status:** accepted direction (2026-11-12); all design questions answered. Not implemented. Follows [ADR-0008](../../ADR-0008.md).
- **Version:** amends OEREP in the draft specification 0.1. It is not a new protocol version: the specification is pre-1.0 (minor versions may break compatibility) and has no production users.
- **Date:** 2026-11-12
- **Tracks:** [PRD.md](../../PRD.md)

## Why

Under [ADR-0008](../../ADR-0008.md), a Workspace has one or more Products, and each has its own Privilege Catalog. The same key, such as `sso`, can be a different Privilege in two Products. OEREP today ([§10](../../spec/sections/10-remote-evaluation.md)) has no notion of a Product: one server serves one Catalog. An application must therefore say which Product it evaluates, and its API key must allow only that Product.

## Proposal

### Requests name the Product

OEREP names the Product and the Privilege in the path, and the action comes last:

```
POST /oerep/v1/products/{product}/privileges/{privilege}/resolve    one Privilege
POST /oerep/v1/products/{product}/privileges/resolve                every Privilege of the Product
POST /oerep/v1/products/{product}/privileges/{privilege}/upgrade    the cheapest Tier that meets a need
```

`{product}` is the Product's identifier and `{privilege}` is the Privilege's key, both matching `^[a-z][a-z0-9_]*$`. The requests stay POST because the body carries the evaluation context.

`upgrade` replaces the `suggest` endpoint (§10.3): it names what the request is for. Its body (`{context, need}`) and response (`{requiredPlan}`) do not change. Wire field names such as `requiredPlan` keep their existing spelling. The protocol is named OEREP 0.1, after the specification version. The `/v1/` in the path is the API's own version and stays as it is; documentation stops calling the protocol "OEREP v1".

The Product is not part of the evaluation context. The context says who is evaluated and when (§2). The Product says which Catalog the privilege key belongs to. Bodies, responses, error shapes and caching rules do not change.

### API keys belong to one Product

An evaluation key is created for one Workspace and one Product. An application that serves two Products uses two keys. If a request names a different Product, the server responds 403, whether or not that Product exists, so that a key cannot be used to discover the Workspace's Products. An unknown privilege within the key's Product still returns 404.

### Resolution within a Product

Resolution follows §3, using the Organization's Tier variant in that Product. `requiredPlan` names a Tier of the same Product, and never an Archived Tier.

An Organization that has no Tier in the requested Product is an ordinary case, not an error. It resolves like an Organization with no plan (§3.1.3): each Privilege's Catalog default with reason `DEFAULT`, or, for a Privilege without a default, the most restrictive value (`false`, `0` or the first enum option). Values from two Products are never combined.

### SDKs

A `RemoteProvider` takes the Product when it is constructed, together with its base URL and key:

```ts
new RemoteProvider({ baseUrl, apiKey, product: "analytics" })
```

Application code that calls `isEnabled` or `getLimit` does not change. Decision caches are per provider, so the Product is part of every cache key.

### Conformance

New Gherkin scenarios cover:
- the paths, including `upgrade`;
- the 403 for another Product;
- the same key resolving to different Privileges in two Products;
- an Organization with no Tier in the requested Product.
