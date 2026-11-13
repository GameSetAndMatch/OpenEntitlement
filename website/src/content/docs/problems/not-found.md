---
title: not-found
description: Nothing exists at the requested address, or you cannot see it.
---

`https://openentitlement.dev/problems/not-found` · HTTP **404**

Nothing exists at the requested address. Addresses under `/api/`, `/oerep/` and `/mcp/` never fall back to the console page, so a mistyped API path returns this problem rather than HTML.

A Workspace you are not a member of, and a Product where you have no Role, are also not found: the service never reveals whether they exist.

```json
{
  "type": "https://openentitlement.dev/problems/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "Nothing exists at this address.",
  "instance": "/api/nothing-here"
}
```

## What to do

Check the path against the API reference.
