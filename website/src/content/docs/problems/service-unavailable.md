---
title: service-unavailable
description: The service is running but cannot reach its database, or sign-in is not configured.
---

`https://openentitlement.dev/problems/service-unavailable` · HTTP **503**

The service is running but cannot reach its database. The health check (`GET /healthz`) returns this problem, so an orchestrator can take the instance out of rotation.

`GET /auth/login` also returns it, with the detail "Sign-in is not configured on this service.", when the service has no OpenID Connect issuer.

```json
{
  "type": "https://openentitlement.dev/problems/service-unavailable",
  "title": "Service unavailable",
  "status": 503,
  "detail": "The service cannot reach its database.",
  "instance": "/healthz"
}
```

## What to do

Retry later. Operators: check that `DATABASE_URL` points to a reachable Postgres and that its credentials are valid. For sign-in, set `OE_OIDC_ISSUER` and `OE_APP_URL`.
