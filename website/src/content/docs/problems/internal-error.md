---
title: internal-error
description: The service failed unexpectedly; the response never reveals the cause.
---

`https://openentitlement.dev/problems/internal-error` · HTTP **500**

The service failed in a way it did not expect. The response never includes the cause, a stack trace or internal names: the service logs those for its operators.

```json
{
  "type": "https://openentitlement.dev/problems/internal-error",
  "title": "Internal error",
  "status": 500,
  "detail": "The service failed to complete this request.",
  "instance": "/api/products"
}
```

## What to do

Retry later. If it keeps failing, report it to the service's operators with the time and the `instance` path; on a self-hosted service, the log has the full error.
