---
title: invitation-for-another-email
description: "The invitation is for another verified email address."
---

`https://openentitlement.dev/problems/invitation-for-another-email` · HTTP **403**

An invitation can only be accepted by the email address it was created for, verified by the identity provider. The signed-in Account has another email. The invitation stays valid for the invited person. The invited address is not revealed, and this problem has no parameters.

```json
{
  "type": "https://openentitlement.dev/problems/invitation-for-another-email",
  "title": "Invitation for another email",
  "status": 403,
  "detail": "This invitation is for another email address. Sign in with the invited email to accept it.",
  "instance": "/api/invitations/accept"
}
```

## What to do

Sign out and sign in with the invited email address, or ask for an invitation for the email you use.
