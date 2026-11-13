---
title: request-too-large
description: "The request body is over the service's limit."
---

`https://openentitlement.dev/problems/request-too-large` · HTTP **413**

An [OEREP](/docs/oerep/) request body is at most 1,000,000 bytes. An evaluation request carries only its context, so a larger body is not an evaluation request.

## Members

| Member | Meaning |
|---|---|
| `limit` | The largest body accepted, in bytes. |

```json
{
  "type": "https://openentitlement.dev/problems/request-too-large",
  "title": "Request too large",
  "status": 413,
  "detail": "The request body is over 1000000 bytes.",
  "instance": "/oerep/v1/products/analytics/privileges/resolve",
  "limit": 1000000
}
```

## What to do

Send only `context` (and `need` for an upgrade request).
