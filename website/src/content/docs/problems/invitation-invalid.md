---
title: invitation-invalid
description: "The invitation link does not exist, was already used, or expired."
---

`https://openentitlement.dev/problems/invitation-invalid` · HTTP **404**

An invitation link works once, within seven days of its creation. This one does not exist, was already used, or expired; the three cases are not told apart. Deleting the Product an invitation was for also ends the invitation. This problem has no parameters.

```json
{
  "type": "https://openentitlement.dev/problems/invitation-invalid",
  "title": "Invitation not valid",
  "status": 404,
  "detail": "This invitation link is not valid. It may have expired or been used. Ask for a new one.",
  "instance": "/api/invitations/accept"
}
```

## What to do

Ask an Owner, or a Manager of the Product, for a new invitation link.
