---
title: sign-in-required
description: "The request needs a signed-in console session, and it has none."
---

`https://openentitlement.dev/problems/sign-in-required` · HTTP **401**

The request needs a signed-in console session, and it has none: the `oe_session` cookie is missing, unknown, expired (sessions last 12 hours) or ended by signing out.

```json
{
  "type": "https://openentitlement.dev/problems/sign-in-required",
  "title": "Sign-in required",
  "status": 401,
  "detail": "Sign in to continue.",
  "instance": "/api/workspaces"
}
```

## What to do

Sign in again through `/auth/login`. The console does this for you by showing its sign-in page.
