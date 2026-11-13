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
| [`not-found`](/problems/not-found/) | 404 | Nothing exists at the requested address. |
| [`method-not-allowed`](/problems/method-not-allowed/) | 405 | The address exists but does not accept this HTTP method. |
| [`internal-error`](/problems/internal-error/) | 500 | The service failed unexpectedly. |
| [`service-unavailable`](/problems/service-unavailable/) | 503 | The service cannot reach its database. |
