# 10. OpenEntitlement Remote Evaluation Protocol (OEREP)

OEREP v1 is the draft HTTP/JSON contract between generic SDK providers and an entitlement server. It follows OFREP's architecture, with entitlement semantics from §§1–8. OpenEntitlement ships its own [server and console](../../console/README.md); other servers can implement the same contract. The machine-readable contract is [OpenAPI](../oerep.openapi.json).

`Application → SDK → RemoteProvider → OEREP server → entitlement storage`

### 10.1. Requests

#### Requirement 10.1.1

> Servers MUST accept `POST /oerep/v1/resolve/{privilege}` for one privilege and `POST /oerep/v1/resolve` for all catalog privileges. The body MUST be a JSON object containing `context`. `context.organizationId` MUST be a non-empty string. Optional `subjectId` and `resourceId` MUST be non-empty strings. Optional `now` MUST be an RFC 3339 timestamp with a timezone. When absent, the server MUST select one timestamp for the request, including all bulk results.

```json
{"context":{"organizationId":"acme","subjectId":"alice","now":"2026-11-03T12:00:00Z"}}
```

Keys use percent encoding as one path segment. Unknown context fields are ignored for forward compatibility. Clients and servers must share compatible catalog definitions; a request never supplies privilege definitions or plan values.

#### Requirement 10.1.2

> Requests MUST use `Content-Type: application/json`. Servers MUST reject invalid JSON or context with HTTP 400, unsupported media types with 415, oversized bodies with 413, unsupported methods with 405, and unknown endpoints or privileges with 404. The reference body limit is 1,000,000 bytes. Transport errors MUST return `{error: string, message: string}`.

### 10.2. Responses

#### Requirement 10.2.1

> A single resolution MUST return HTTP 200 with §4.3 resolution details, including `privilege`, `value`, `reason`, `grants`, and `staleOverrides`. Bulk MUST return HTTP 200 with `{privileges: ResolutionDetails[]}`, one result per catalog privilege. Values MUST use §1.2 JSON encoding, including `{"unlimited":true}`. Resolution errors MUST use reason `ERROR` and an §8 error code; an ordinary disabled feature or exhausted quota is not a transport error.

```json
{"privilege":"seat_max","value":250,"reason":"OVERRIDE","planId":"business","planValue":100,"overrideId":"override_42","grants":[],"staleOverrides":[]}
```

#### Requirement 10.2.2

> Servers MUST send `Cache-Control: no-store`. Clients MUST validate privilege identity, value types against their local catalog, reasons, grant amounts, and metadata before using responses. HTTP errors, timeouts, malformed JSON, and invalid responses MUST follow SDK fail-closed behavior (§3.1.11), with no upgrade suggestion on evaluation errors.

Bulk results share evaluation time but do not promise an atomic snapshot of concurrent administrative writes.

#### Requirement 10.2.3

> Generic providers MUST NOT cache decisions unless the application opts in with a finite, positive time-to-live. With that opt-in, a client MAY reuse a successful, validated resolution for the same privilege and context (`organizationId`, `subjectId`, `resourceId`) for at most the configured TTL, from either single or bulk resolution, and MUST bound the number of entries. Clients MUST NOT cache HTTP errors, timeouts, invalid responses or resolutions with reason `ERROR`, and MUST NOT serve stale entries when a request fails. Clients MUST NOT cache requests with an explicit caller-supplied evaluation time (`now`). Upgrade suggestions MUST NOT be cached.

#### Requirement 10.2.4

> Check-and-act decisions MUST NOT be served from a decision cache. `guard`, `require_within`/`requireWithin`, `require_enabled`/`requireEnabled` and any other check that decides whether a write may proceed MUST fetch the current value from the server; that fetch MAY refresh the cached entry. Only read paths (`is_enabled`, `get_limit`, `get_enum`, `get_details` and bulk resolution for display) MAY be served from the cache.

A cached value can be up to the TTL stale, so administrative changes take up to that long to reach read paths. Short TTLs (for example 5–30 seconds) keep that window small. Check-and-act paths bypass the cache because the application lock (§5) keeps usage counts consistent but not the limit itself: a stale limit would let writes exceed a lowered limit for up to the TTL. The reference SDKs preserve whether `now` came from the caller or the SDK clock, without comparing it to wall time. Direct provider calls with `now` bypass the cache unless the caller explicitly identifies SDK-generated time. A failed current-time refresh evicts the previous success for every affected privilege; an invalid bulk response evicts all requested entries. Provider transport authority and credentials are fixed at construction.

### 10.3. Upgrade suggestions

#### Requirement 10.3.1

> Servers MUST accept `POST /oerep/v1/suggest/{privilege}` with `{context, need}`. `need` MUST be `true` for a boolean privilege, a non-negative safe integer representing the required **plan value** for an integer privilege, or a declared enum option. Selection MUST follow §3.4. Responses MUST be `{requiredPlan: string | null}`. Evaluation failure or no eligible plan MUST yield null.

The SDK computes integer need from current usage and resolved grants (§3.3) before requesting a suggestion. This endpoint never reserves or consumes quota.

### 10.4. Deployment boundary

#### Requirement 10.4.1

> When bearer authentication is configured, the server MUST reject missing or invalid credentials with 401. Evaluation credentials MUST NOT authorize administrative mutations. Clients MUST NOT forward bearer tokens through redirects. Deployments SHOULD use HTTPS outside localhost and authorize callers for the organizations they can evaluate.

The reference service has separate evaluation and administration bearer tokens. These are service credentials: an evaluation token can evaluate every organization served by that instance. Do not expose it to browsers or untrusted tenants; applications enforce tenant access before calling the server. Transport authentication is separate from entitlement resolution (§9.1.1).

#### Requirement 10.4.2

> OEREP MUST NOT claim a lock over application usage. `guard`, usage counting, and check-and-act transactions MUST remain in the application with a suitable lock (§5). Administrative mutations and inspection MUST remain outside `/oerep/v1/`.

The reference server exposes administration at `/api/`, with audited mutations and its own credentials. This administrative API is implementation-specific in v1. Events (for cache invalidation), reservations, and metering are outside this protocol version; opt-in client decision caching follows §10.2.3–10.2.4.
