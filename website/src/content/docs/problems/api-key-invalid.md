---
title: api-key-invalid
description: "The OEREP request has no valid API key."
---

`https://openentitlement.dev/problems/api-key-invalid` · HTTP **401**

An [OEREP](/docs/oerep/) request must send an API key as a bearer token: `Authorization: Bearer oek_…`. This problem answers a request whose key is missing, malformed, unknown or revoked; the four are not told apart. The response carries `WWW-Authenticate: Bearer`.

The key is checked first, before the Product or the request body, so the same request with a valid key may fail differently.

```json
{
  "type": "https://openentitlement.dev/problems/api-key-invalid",
  "title": "API key not valid",
  "status": 401,
  "detail": "Send a valid API key as a bearer token: Authorization: Bearer <key>.",
  "instance": "/oerep/v1/products/analytics/privileges/seats/resolve"
}
```

## What to do

Check that your application sends the whole key it was given when the key was created. If the key was revoked, a Product Manager or an Owner creates a new one under **Settings → API keys** and you replace it in your application's configuration. SDKs treat this problem as a transport error: evaluation fails closed.
