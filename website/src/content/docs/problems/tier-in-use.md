---
title: tier-in-use
description: "Organizations or the status policy use the Tier, so it can be archived but not deleted."
---

`https://openentitlement.dev/problems/tier-in-use` · HTTP **409**

Organizations use this Tier, or the Product's status policy falls back to one of its variants, so it cannot be deleted. Nothing was changed.

## Members

| Member | Meaning |
|---|---|
| `id` | The Tier's ID. |
| `variantId` | Present when the status policy is the reason: the variant it falls back to. |

```json
{
  "type": "https://openentitlement.dev/problems/tier-in-use",
  "title": "Tier in use",
  "status": 409,
  "detail": "Customers use this Tier. Archive it instead of deleting it.",
  "instance": "/api/workspaces/1b5e…/products/7c1d…/tiers/pro",
  "id": "pro"
}
```

## What to do

Archive the Tier instead: its current Organizations keep it with all its variants, and it can no longer be given to a new one. It can be restored later. When the status policy is the reason, choose another fallback first.
