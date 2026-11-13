---
title: last-product
description: "A Workspace keeps at least one Product."
---

`https://openentitlement.dev/problems/last-product` · HTTP **409**

A Workspace always has at least one Product, and this is its last one. Nothing was deleted.

## Members

| Member | Meaning |
|---|---|
| `id` | The Product's ID. |

```json
{
  "type": "https://openentitlement.dev/problems/last-product",
  "title": "Last Product",
  "status": 409,
  "detail": "A Workspace keeps at least one Product. Create another one before deleting this one.",
  "instance": "/api/workspaces/1b5e…/products/7c1d…",
  "id": "7c1d…"
}
```

## What to do

Create another Product first, or keep this one (rename it if its name no longer fits).
