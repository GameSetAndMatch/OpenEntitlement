---
title: Problem types
description: Every error the OpenEntitlement service returns is an RFC 9457 Problem Details object with a stable type.
sidebar:
  order: 0
---

Every error the OpenEntitlement service returns is a [Problem Details](https://www.rfc-editor.org/rfc/rfc9457) object, sent with the media type `application/problem+json`:

```json
{
  "type": "https://openentitlement.dev/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request is not valid. See errors.",
  "instance": "/api/products",
  "errors": [{ "pointer": "/key", "detail": "Field required" }]
}
```

- `type` is the stable identifier. Branch on it in your code, never on `title` or `detail`. Each type has a page on this site at its own address.
- `title` names the type. `detail` explains this occurrence. Both are for people and may change wording.
- `status` repeats the HTTP status code.
- `instance` is the path of the request that failed.
- Any other member is a parameter of that type, documented on its page.

The Python service returns these types. It is in development on the `service/python` branch ([ADR-0009](https://github.com/open-entitlement/OpenEntitlement/blob/main/ADR-0009.md)); the Node service still answers with its earlier `{error, message}` bodies.

| Type | Status | Meaning |
|---|---|---|
| [`validation-failed`](/problems/validation-failed/) | 400 | The request body or parameters are not valid. |
| [`sign-in-required`](/problems/sign-in-required/) | 401 | The request needs a signed-in session. |
| [`sign-in-failed`](/problems/sign-in-failed/) | 401 | The OpenID Connect sign-in could not be completed. |
| [`sign-in-refused`](/problems/sign-in-refused/) | 403 | The identity may not sign in here. |
| [`csrf-rejected`](/problems/csrf-rejected/) | 403 | A change did not come from the console. |
| [`permission-denied`](/problems/permission-denied/) | 403 | The Role does not allow this action. |
| [`invitation-for-another-email`](/problems/invitation-for-another-email/) | 403 | The invitation is for another verified email address. |
| [`not-found`](/problems/not-found/) | 404 | Nothing exists at the requested address, or you cannot see it. |
| [`invitation-invalid`](/problems/invitation-invalid/) | 404 | The invitation link does not exist, was used, or expired. |
| [`method-not-allowed`](/problems/method-not-allowed/) | 405 | The address exists but does not accept this HTTP method. |
| [`already-exists`](/problems/already-exists/) | 409 | Another record already uses this unique key. |
| [`revision-conflict`](/problems/revision-conflict/) | 409 | The record changed since it was read. |
| [`product-in-use`](/problems/product-in-use/) | 409 | Customers use the Product, so it can only be archived. |
| [`tier-in-use`](/problems/tier-in-use/) | 409 | Organizations or the status policy use the Tier, so it can only be archived. |
| [`last-product`](/problems/last-product/) | 409 | A Workspace keeps at least one Product. |
| [`last-owner`](/problems/last-owner/) | 409 | A Workspace keeps at least one Owner. |
| [`product-limit`](/problems/product-limit/) | 409 | Cloud Pro allows one Product. |
| [`internal-error`](/problems/internal-error/) | 500 | The service failed unexpectedly. |
| [`service-unavailable`](/problems/service-unavailable/) | 503 | The service cannot reach its database, or sign-in is not configured. |
