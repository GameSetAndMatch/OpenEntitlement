---
title: OEREP HTTP API
description: HTTP endpoints, request context, resolution details, and error behavior in OEREP 0.1.
---

OEREP is the OpenEntitlement Remote Evaluation Protocol. A generic SDK provider speaks HTTP/JSON to a compatible server. Implement the contract once rather than maintaining a provider per language.

[Download the OpenAPI 3.1 contract](/oerep.openapi.json).

## Resolve one privilege

```http
POST /oerep/v1/products/analytics/privileges/seat_max/resolve
Content-Type: application/json
Authorization: Bearer <evaluation-token>

{"context":{"organizationId":"acme"}}
```

```json
{
  "privilege": "seat_max",
  "value": 250,
  "reason": "OVERRIDE",
  "planId": "business",
  "planValue": 100,
  "overrideId": "example-override-id",
  "grants": [],
  "staleOverrides": []
}
```

The example ID is illustrative. The privilege key is percent-encoded as one path segment.

## Resolve the catalog

`POST /oerep/v1/products/{product}/privileges/resolve` accepts the same body and returns `{"privileges": [...]}`. All entries share the request timestamp, but concurrent administrative changes are not guaranteed to form one atomic snapshot.

## Suggest an upgrade

`POST /oerep/v1/products/{product}/privileges/{privilege}/upgrade` accepts `context` and `need`. For a boolean, `need` is true; for an enum, a declared option; for an integer, the required **plan value**, after accounting for applicable grants. SDKs calculate this for you.

The result is `{"requiredPlan":"business"}` or `{"requiredPlan":null}` when no eligible candidate exists or evaluation fails.

## Context and failures

`organizationId` is required. `subjectId` and `resourceId` are optional non-empty strings. `now` is an optional RFC 3339 timestamp with timezone.

Ordinary entitlement decisions return 200. Request/transport failures use HTTP 400, 401, 403, 404, 405, 413, 415, or 500 with RFC 9457 Problem Details (`application/problem+json`). Resolution errors carry reason `ERROR` in the details. Responses use `Cache-Control: no-store`. The generic providers do not cache decisions unless an application opts in with a short TTL; even then, errors, explicit evaluation times, suggestions and check-and-act paths (`guard`, `requireWithin`, `requireEnabled`) are never served from the cache.

The `/api/` administration endpoints are separate and implementation-specific. They are not part of OEREP 0.1.

Read the [normative protocol requirements](/specification/10-remote-evaluation/).

The Product-scoped amendment is an unreleased `service/python` preview. Keys belong to one Workspace and Product: missing or invalid keys get 401, a mismatched Product gets a generic `product-forbidden` 403, and only an authorized Product can return 404 for a Privilege. Construct each RemoteProvider with its Product and key; its cache is isolated to that binding.
