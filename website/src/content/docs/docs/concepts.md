---
title: Core concepts
description: How plan values, overrides, grants, and defaults produce an explainable entitlement decision.
---

## Definitions in code, values as data

A **feature** is a named capability. A **privilege** is one typed dimension: a boolean, an integer (negative values allowed), or an ordered enum. The **catalog** declares these definitions and defaults.

`project_max` might be an integer privilege. `sso_enabled` might be a boolean gate. `report_retention` might be an enum ordered as `7d`, `90d`, `365d`.

## The resolution model

```text
plan value (or declared default)
  → replace with an active, matching override
  → add active grants for integer privileges
  → return the value and its explanation
```

An **assignment** connects an organization to a plan. The payment channel is opaque and does not change entitlement resolution.

An **override** replaces a value and may raise or lower it. In the current implementation it binds to a plan family. A family mismatch makes the override **stale**: kept and visible, but inert. Overrides can also be scoped to a subject or resource and have start/expiry dates.

A **grant** adds quota. It survives a plan change and may expire or be revoked. Subject grants apply only to the matching subject; the subject draws its own allowance before the organization's shared pool.

## Unlimited is a value

`UNLIMITED` is a distinct singleton in the SDKs and `{"unlimited":true}` on the wire. It is not null, infinity, or a large integer. Use `isUnlimited` / `is_unlimited` when inspecting it.

## Explain the decision

Resolution details contain the effective value, reason, plan value, applied grants, stale overrides, and any error. An upgrade suggestion identifies an eligible public plan when one exists.

An evaluation failure uses the privilege's declared default and must not advertise an upgrade. Choose defaults deliberately: a permissive default can still permit access during an outage.

## Deterministic time

Provide `now` to test expiration or replay a decision. The remote protocol accepts an RFC 3339 timestamp with a timezone. Without it, the SDK/server uses an injectable clock.

See the [glossary](/reference/glossary/) and [normative resolution specification](/specification/03-resolution/).
