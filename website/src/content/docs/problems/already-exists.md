---
title: already-exists
description: "Another record already uses this unique key."
---

`https://openentitlement.dev/problems/already-exists` · HTTP **409**

Another record already uses this unique key, for example a Product key within its Workspace. Nothing was created.

## Members

| Member | Meaning |
|---|---|
| `kind` | The kind of record, for example `Product`. |
| `key` | The key that is already taken. |

```json
{
  "type": "https://openentitlement.dev/problems/already-exists",
  "title": "Already exists",
  "status": 409,
  "detail": "Another Product already uses the key storage.",
  "instance": "/api/workspaces/1b5e…/products",
  "kind": "Product",
  "key": "storage"
}
```

## What to do

Choose another key, or change the existing record.
