---
title: revision-conflict
description: "The record changed since it was read, so the change was not saved."
---

`https://openentitlement.dev/problems/revision-conflict` · HTTP **409**

Each record carries a version, and a change names the version it was made from. Someone changed this record after you read it, so your change was not saved and did not overwrite theirs.

## Members

| Member | Meaning |
|---|---|
| `kind` | The kind of record, for example `Product`. |
| `id` | The record's ID. |

```json
{
  "type": "https://openentitlement.dev/problems/revision-conflict",
  "title": "Changed elsewhere",
  "status": 409,
  "detail": "This Product changed elsewhere. Reload it before saving.",
  "instance": "/api/workspaces/1b5e…/products/7c1d…",
  "kind": "Product",
  "id": "7c1d…"
}
```

## What to do

Read the record again, reapply your change and save with its current version.
