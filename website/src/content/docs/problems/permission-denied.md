---
title: permission-denied
description: "The signed-in Account's Role does not allow this action."
---

`https://openentitlement.dev/problems/permission-denied` · HTTP **403**

The signed-in Account can see what it asked for, but its Role does not allow this action. Owners administer the whole Workspace. A Product's Managers change its Catalog, Tiers, Organization terms and API keys; its Users read it. A Product where the Account has no Role is reported as [`not-found`](/problems/not-found/) instead, so its existence is never revealed.

## Members

| Member | Meaning |
|---|---|
| `permission` | The permission the action needs: `product:read`, `product:edit` or `products:manage`. |

```json
{
  "type": "https://openentitlement.dev/problems/permission-denied",
  "title": "Permission denied",
  "status": 403,
  "detail": "Only the Workspace's Owners can create, rename, archive, restore or delete Products.",
  "instance": "/api/workspaces/1b5e…/products",
  "permission": "products:manage"
}
```

## What to do

Ask an Owner of the Workspace, or a Manager of the Product, to make the change or to give you the Role it needs.
