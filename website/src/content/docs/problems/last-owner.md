---
title: last-owner
description: "A Workspace keeps at least one Owner."
---

`https://openentitlement.dev/problems/last-owner` · HTTP **409**

The member is the Workspace's only Owner. Removing them, or giving them a Product Role instead, would leave nobody able to administer the Workspace. Nothing changed.

## Members

| Member | Meaning |
|---|---|
| `id` | The Account ID of the only Owner. |

```json
{
  "type": "https://openentitlement.dev/problems/last-owner",
  "title": "Last Owner",
  "status": 409,
  "detail": "A Workspace keeps at least one Owner. Make another member Owner first.",
  "instance": "/api/workspaces/1b5e…/members/9a2c…",
  "id": "9a2c…"
}
```

## What to do

Make another member Owner first, then change or remove this one.
