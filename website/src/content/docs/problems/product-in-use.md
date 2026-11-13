---
title: product-in-use
description: "An Organization uses the Product, so it can be archived but not deleted."
---

`https://openentitlement.dev/problems/product-in-use` · HTTP **409**

An Organization uses this Product, so it cannot be deleted. Nothing was changed.

## Members

| Member | Meaning |
|---|---|
| `id` | The Product's ID. |

```json
{
  "type": "https://openentitlement.dev/problems/product-in-use",
  "title": "Product in use",
  "status": 409,
  "detail": "Customers use this Product. Archive it instead of deleting it.",
  "instance": "/api/workspaces/1b5e…/products/7c1d…",
  "id": "7c1d…"
}
```

## What to do

Archive the Product instead: its current customers keep it, and it can no longer be given to a new one. It can be restored later.
