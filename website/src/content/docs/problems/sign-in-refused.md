---
title: sign-in-refused
description: "The identity provider vouched for the person, but this service does not let them sign in."
---

`https://openentitlement.dev/problems/sign-in-refused` · HTTP **403**

The identity provider vouched for the person, but this service does not let them sign in.

## Members

| Member | Meaning |
|---|---|
| `reason` | `email-not-verified`: the provider did not confirm the email address (`email_verified` is not `true`). `domain-not-allowed`: the address's domain is not in the service's list of allowed domains. |

```json
{
  "type": "https://openentitlement.dev/problems/sign-in-refused",
  "title": "Sign-in refused",
  "status": 403,
  "detail": "Sign-in requires a verified email address.",
  "instance": "/auth/callback",
  "reason": "email-not-verified"
}
```

## What to do

Use an account whose email address the provider has verified, from an allowed domain. Operators set the allowed domains with `OE_SIGNUP_DOMAINS`; when it is empty, every domain may sign in.
