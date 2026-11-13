---
title: product-forbidden
description: "The API key belongs to another Product."
---

`https://openentitlement.dev/problems/product-forbidden` · HTTP **403**

Every API key evaluates one Product: the one it was created for. This problem answers an [OEREP](/docs/oerep/) request whose path names any other Product. The body is the same whether that Product exists or not, and whether the requested Privilege exists or not, so a key cannot be used to discover a Workspace's Products or their Privileges.

```json
{
  "type": "https://openentitlement.dev/problems/product-forbidden",
  "title": "Product not allowed for this key",
  "status": 403,
  "detail": "This API key cannot evaluate this Product. Each key evaluates the one Product it was created for.",
  "instance": "/oerep/v1"
}
```

## What to do

Check the Product key your application's `RemoteProvider` is constructed with. An application that evaluates two Products uses two keys and two providers. SDKs treat this problem as a transport error: evaluation fails closed, with no upgrade suggestion.
