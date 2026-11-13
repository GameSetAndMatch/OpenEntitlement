---
title: validation-failed
description: The request body or parameters are not valid; errors lists each field as a JSON Pointer.
---

`https://openentitlement.dev/problems/validation-failed` · HTTP **400**

The service rejected the request before doing anything: the body is not valid JSON, a required field is missing, or a value has the wrong type or shape. Nothing was changed.

## Members

| Member | Meaning |
|---|---|
| `errors` | One entry per rejected field. |
| `errors[].pointer` | A [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901) to the field in the request body, for example `/tiers/1/name`. An empty pointer (`""`) means the whole body. A field outside the body starts with its location, for example `/query/limit`. |
| `errors[].detail` | Why this field was rejected. |

```json
{
  "type": "https://openentitlement.dev/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request is not valid. See errors.",
  "instance": "/api/products",
  "errors": [
    { "pointer": "/key", "detail": "Field required" },
    { "pointer": "/tiers/1/name", "detail": "Field required" }
  ]
}
```

## What to do

Correct each field named in `errors` and send the request again. Field names follow the API's camelCase JSON.
