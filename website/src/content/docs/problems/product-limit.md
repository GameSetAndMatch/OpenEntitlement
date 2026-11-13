---
title: product-limit
description: "Cloud Pro allows one Product."
---

`https://openentitlement.dev/problems/product-limit` · HTTP **409**

On OpenEntitlement Cloud, a Workspace's Cloud service tier limits its Products: Cloud Pro allows one, Cloud Enterprise any number. A self-hosted install has no limit. This problem answers two requests:

- creating a Product in a Cloud Pro Workspace that already has one;
- moving a Workspace to Cloud Pro while it has more than one Product, archived ones included.

Nothing changed.

## Members

| Member | Meaning |
|---|---|
| `serviceTier` | The Cloud service tier whose limit applies: `pro`. |
| `limit` | How many Products that tier allows. |
| `products` | The Workspace's Products, each with its `id`, `key` and `name`. |

```json
{
  "type": "https://openentitlement.dev/problems/product-limit",
  "title": "Product limit reached",
  "status": 409,
  "detail": "Cloud Pro allows 1 Product, and this Workspace has 2: Analytics, Storage. Keep one and delete the others. Archive a Product customers use and move them off it before deleting it.",
  "instance": "/api/workspaces/1b5e…/service-tier",
  "serviceTier": "pro",
  "limit": 1,
  "products": [
    { "id": "7c1d…", "key": "analytics", "name": "Analytics" },
    { "id": "4e8f…", "key": "storage", "name": "Storage" }
  ]
}
```

## What to do

To add a Product, ask a Platform administrator to move the Workspace to Cloud Enterprise. To move to Cloud Pro, keep one Product and delete the others. A Product that customers use cannot be deleted: archive it, move its customers to the Product you keep, then delete it.
