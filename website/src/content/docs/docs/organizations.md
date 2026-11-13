---
title: Organizations
description: Assign each customer a Tier variant, record the terms of their deal, and see where every value came from.
---

An **Organization** is one of your customers. Each one is assigned one [Tier](/docs/tiers/) variant and inherits its values. When a deal needs something different, record it on the Organization instead of cloning the Tier.

## Own terms

An Organization's **own terms** override inherited values, up or down. Globex is on Business standard, which includes 25 seats. Its contract says 40:

| Privilege | Catalog default | Business standard | Globex | Result |
| --- | --- | --- | --- | --- |
| `seat_max` | 5 | 25 | 40 | 40, Organization override |
| `ai_tokens` | 1,000 | 10,000 | — | 10,000, Tier value |

Own terms belong to the Tier the deal was made on. If Globex moves to another Tier, its terms are kept but stop applying until it returns.

## Application users

Inside an Organization, an **application user** (for example `idp|alice`) can have personal terms and **grants**. A grant adds to a limit instead of replacing it: Alice with personal terms of 15,000 tokens and a grant of 2,000 resolves to 17,000, while her colleagues inherit 10,000. User exceptions are scoped to their Organization, so the same user ID elsewhere inherits nothing.

## Every value is explained

Each result says where it came from: Catalog default, Tier value, Organization override, or a restriction from the environment, such as `MCP_INSTALLED=false` vetoing an enabled boolean. Every change records who made it in the Workspace’s Audit log, and changes to contract terms also record why.

Organizations, users and their terms describe entitlement only. OpenEntitlement does not create accounts, assign roles, take payments or count usage.

See the [ACME walkthrough](/docs/acme-workspace/#4-assign-organizations) for the whole flow, and the [resolution specification](/specification/03-resolution/) for the normative rules.
