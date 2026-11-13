---
title: sign-in-failed
description: "The OpenID Connect sign-in could not be completed. Start again."
---

`https://openentitlement.dev/problems/sign-in-failed` · HTTP **401**

The OpenID Connect sign-in could not be completed. The sign-in started more than 10 minutes ago or was already used, the browser returned without the cookie the sign-in set, the identity provider reported an error, or its answer did not pass verification (state, PKCE verifier, ID token signature, issuer, audience, expiry or nonce, or a UserInfo subject that differs from the ID token's). Nothing was signed in.

```json
{
  "type": "https://openentitlement.dev/problems/sign-in-failed",
  "title": "Sign-in failed",
  "status": 401,
  "detail": "Sign-in failed. Start again.",
  "instance": "/auth/callback"
}
```

## What to do

Start again from the console's Sign in button. Operators: if it keeps failing, check `OE_OIDC_ISSUER`, `OE_OIDC_CLIENT_ID`, the client's registered redirect URI (`OE_APP_URL` followed by `/auth/callback`) and the clocks of both servers.
