---
title: user-entitlements-unavailable
description: "Personal terms and Grants for application users need Cloud Enterprise."
---

`https://openentitlement.dev/problems/user-entitlements-unavailable` · HTTP **403**

On OpenEntitlement Cloud, user-level entitlements are part of Cloud Enterprise. A Workspace on Cloud Pro has Organization entitlements: Tier variants and Organization terms. This problem answers a request to add an application user, or to change one's Personal terms or Grants, in a Cloud Pro Workspace. A self-hosted install is never refused.

Nothing changed. After a move to Cloud Pro, existing application users are kept but their values are not served, and they can still be removed.

## Members

| Member | Meaning |
|---|---|
| `serviceTier` | The Workspace's Cloud service tier: `pro`. |

```json
{
  "type": "https://openentitlement.dev/problems/user-entitlements-unavailable",
  "title": "User entitlements unavailable",
  "status": 403,
  "detail": "Personal terms and Grants for application users need Cloud Enterprise. Organization terms stay available on Cloud Pro.",
  "instance": "/api/workspaces/1b5e…/organizations/acme/products/7c1d…/users/idp%7Calice",
  "serviceTier": "pro"
}
```

## What to do

Give the exception to the whole Organization with Organization terms, or ask a Platform administrator to move the Workspace to Cloud Enterprise.
