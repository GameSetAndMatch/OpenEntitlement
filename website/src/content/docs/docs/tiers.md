---
title: Tiers
description: Package the Privilege Catalog into reusable offers, with standard, trial and grace variants.
---

A **Tier** is one of your commercial offers, such as Business or Enterprise. It reuses the [Privilege Catalog](/docs/privilege-catalog/) and changes only what differs from it. Every Privilege a Tier leaves alone inherits the Catalog default.

| Privilege | Catalog default | Business standard | Enterprise standard |
| --- | --- | --- | --- |
| `seat_max` | 5 | 25 | Unlimited |
| `ai_tokens` | 1,000 | 10,000 | 50,000 |
| `mcp_enabled` | Disabled | Disabled | Enabled, subject to installation |

## Variants

A Tier holds its values in **variants**: standard, trial and grace. A trial or grace period is a way to be on a Tier, not another Tier. A Business trial could allow 5,000 tokens, and its grace variant 1,000. Grace days belong to the Tier; the policy after grace is a Workspace setting.

Hidden and read-only Privileges keep their Catalog defaults. An editable Privilege without a default needs a value in every variant.

## Organizations

Each [Organization](/docs/organizations/) is assigned one Tier variant. When a deal needs different terms, set them on the Organization instead of cloning the Tier.

Tiers are your offers to your customers. They are separate from OpenEntitlement Cloud's own service tiers.

See the [ACME walkthrough](/docs/acme-workspace/#3-build-acmes-commercial-offers) for the whole flow, and the [data model](/specification/01-data-model/) for the normative rules.
