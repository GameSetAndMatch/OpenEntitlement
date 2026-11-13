---
title: method-not-allowed
description: The address exists but does not accept this HTTP method.
---

`https://openentitlement.dev/problems/method-not-allowed` · HTTP **405**

The address exists, but not for this HTTP method. The `Allow` response header lists the methods it accepts.

## Members

| Member | Meaning |
|---|---|
| `method` | The method of the rejected request. |
| `allowed` | The methods this address accepts. |

```json
{
  "type": "https://openentitlement.dev/problems/method-not-allowed",
  "title": "Method not allowed",
  "status": 405,
  "detail": "This address does not accept DELETE.",
  "instance": "/healthz",
  "method": "DELETE",
  "allowed": ["GET"]
}
```

## What to do

Send the request with one of the `allowed` methods.
