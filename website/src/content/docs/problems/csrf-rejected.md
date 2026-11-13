---
title: csrf-rejected
description: "A request that changes something did not come from the console with the session's CSRF token."
---

`https://openentitlement.dev/problems/csrf-rejected` · HTTP **403**

A request that changes something (any method other than GET, HEAD and OPTIONS) must come from the console itself: its `Origin` header must be the console's origin, and its `X-OE-CSRF` header must carry the session's CSRF token, which `GET /api/session` returns. This one did not, so nothing was changed. It protects signed-in people from other sites sending requests with their cookie.

```json
{
  "type": "https://openentitlement.dev/problems/csrf-rejected",
  "title": "Request origin not allowed",
  "status": 403,
  "detail": "This request did not come from the console. Reload the page and try again.",
  "instance": "/api/workspaces"
}
```

## What to do

Reload the console. A client of the HTTP API reads `csrf` from `GET /api/session` and sends it in `X-OE-CSRF` with the console's `Origin`.
