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
POST /oerep/v1/products/{product}/privileges/{privilege}/upgrade    the lowest-ranked eligible Tier that meets a need (§3.4)
```

`{product}` is the Product's identifier and `{privilege}` is the Privilege's key. Each is one percent-encoded path segment, and the server validates the decoded value against `^[a-z][a-z0-9_]*$`. The requests stay POST because the body carries the evaluation context.

`upgrade` replaces the `suggest` endpoint (§10.3): it names what the request is for. Its body (`{context, need}`) and response (`{requiredPlan}`) do not change. Wire field names such as `requiredPlan` keep their existing spelling. The protocol is named OEREP 0.1, after the specification version. The `/v1/` in the path is the API's own version and stays as it is; documentation stops calling the protocol "OEREP v1".

The Product is not part of the evaluation context. The context says who is evaluated and when (§2). The Product says which Catalog the privilege key belongs to. Request bodies, successful response bodies and caching rules do not change; error responses adopt Problem Details as described below.

### API keys belong to one Product

An evaluation key is created for one Workspace and one Product. An application that serves two Products uses two keys.

The server checks a request in this order:

1. Missing or invalid credentials return 401.
2. The key's Workspace and Product are compared with the requested Product before any Catalog lookup. Any mismatch returns 403 with the same Problem Details body, whether or not the Product or the Privilege exists. A key therefore cannot be used to discover the Workspace's Products or their Privileges.
3. Only then does an unknown Privilege return 404.

SDKs treat the 403 as a transport error: evaluation fails closed (§3.1.11), with no upgrade suggestion.

### Errors are Problem Details

Under [ADR-0009](../../ADR-0009.md), every OEREP error response is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details object (`application/problem+json`) instead of `{error, message}` (§10.1.2). The problem `type` is the stable identifier SDKs branch on. The 403 above is the problem type `https://openentitlement.dev/problems/product-forbidden`, with the same body for every mismatch.

Validation failures use HTTP 400 and the `validation-failed` problem type. [ADR-0010](../../ADR-0010.md) records accepted Product status/grace and uncapped additive Grant clarifications. This is direction, not evidence of released transport support.

### Resolution within a Product

Resolution follows §3, using the Organization's Tier variant in that Product.

Every lookup is scoped to the key's Workspace and Product: assignments, Plans, Families, overrides and grants. A Tier is a Plan, a Tier variant is a Plan with `variantOf` set to its Tier, and a Tier's variants share its Family. Plan and Family identifiers are interpreted within the Product, so two Products can both have a `business` Tier and a `seat_max` Privilege without ever matching each other's records. `variantOf` and `planFamily` cannot reference another Product.

`requiredPlan` names a Tier of the same Product, selected by §3.4 (variants are never candidates), and never an Archived Tier.

An Organization that has no Tier in the requested Product is an ordinary case, not an error. It resolves like an Organization with no plan (§3.1.3). The base value is the Privilege's Catalog default, with reason `DEFAULT`. For a Privilege without a default, it is the most restrictive value (`false`, `0` or the first enum option). The other rules then apply as usual. A grant scoped to that Product still adds to the base (§3.1.7). An override has no matching assignment, so it is stale. Values from two Products are never combined.

### SDKs

A `RemoteProvider` takes the Product when it is constructed, together with its base URL and key:

```ts
new RemoteProvider({ baseUrl, apiKey, product: "analytics" })
```

```python
RemoteProvider(base_url, token=api_key, product="analytics")
```

Application code that calls `isEnabled` or `getLimit` does not change. The Product, transport authority and credentials are fixed for the provider's lifetime. The decision cache's namespace includes that binding. All existing cache rules still apply: TTL, explicit time, eviction and fresh reads for check-and-act (§10.2.3–10.2.4).

### Conformance

The implementation must add Gherkin scenarios covering:
- the three paths, including `upgrade`, and the 401/403/404 order on each;
- the same Privilege key resolving to different Privileges in two Products;
- cache isolation between providers bound to different Products;
- an Organization with no Tier in the requested Product, including a retained grant;
- `upgrade` candidates limited to the Product's non-archived Tiers.

### Implementation handoff

This RFC is accepted direction only. Before the change is described as implemented, these change together in one release:
- §10 and the protocol name (OEREP 0.1), including the Problem Details error shape that replaces `{error, message}` in Requirement 10.1.2;
- `spec/oerep.openapi.json`, including the new routes and 403 responses;
- both SDKs' `RemoteProvider`, including reading Problem Details;
- the shared conformance suite.
