---
title: unsupported-media-type
description: "The request body is not sent as JSON."
---

`https://openentitlement.dev/problems/unsupported-media-type` · HTTP **415**

[OEREP](/docs/oerep/) requests send their body with `Content-Type: application/json`. This problem answers a request with another media type, or none.

## Members

| Member | Meaning |
|---|---|
| `accepted` | The media type to send: `application/json`. |

```json
{
  "type": "https://openentitlement.dev/problems/unsupported-media-type",
  "title": "Unsupported media type",
  "status": 415,
  "detail": "Send the request body as application/json.",
  "instance": "/oerep/v1/products/analytics/privileges/resolve",
  "accepted": "application/json"
}
```

## What to do

Send the header `Content-Type: application/json`. The OpenEntitlement SDKs always do.
