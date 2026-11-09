---
title: OEREP HTTP API
description: HTTP endpoints, request context, resolution details, and error behavior in OEREP v1.
---

OEREP is the OpenEntitlement Remote Evaluation Protocol. A generic SDK provider speaks HTTP/JSON to a compatible server. Implement the contract once rather than maintaining a provider per language.

[Download the OpenAPI 3.1 contract](/oerep.openapi.json).

## Resolve one privilege

```http
POST /oerep/v1/resolve/seat_max
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

`POST /oerep/v1/resolve` accepts the same body and returns `{"privileges": [...]}`. All entries share the request timestamp, but concurrent administrative changes are not guaranteed to form one atomic snapshot.

## Suggest an upgrade

`POST /oerep/v1/suggest/{privilege}` accepts `context` and `need`. For a boolean, `need` is true; for an enum, a declared option; for an integer, the required **plan value**, after accounting for applicable grants. SDKs calculate this for you.

The result is `{"requiredPlan":"business"}` or `{"requiredPlan":null}` when no eligible candidate exists or evaluation fails.

## Context and failures

`organizationId` is required. `subjectId` and `resourceId` are optional non-empty strings. `now` is an optional RFC 3339 timestamp with timezone.

Ordinary entitlement decisions return 200. Request/transport failures use HTTP 400, 401, 404, 405, 413, 415, or 500 with `{error, message}`. Resolution errors carry reason `ERROR` in the details. Responses use `Cache-Control: no-store`; the generic providers do not cache decisions.

The `/api/` administration endpoints are separate and implementation-specific. They are not part of OEREP v1.

Read the [normative protocol requirements](/specification/10-remote-evaluation/).
