# Prior art

*Researched 2026-11-03.* Sources: web search; GitHub search (`gh search repos`) for `entitlements spec`, `entitlement specification`, `open entitlements`, `openentitlement`, `entitlements sdk provider`, `plan limits sdk`, `entitlements openfeature`, `entitlements`, `entitlements billing`; Hacker News search through the Algolia API for `open entitlements`, `entitlements spec`, `entitlements standard`, `entitlements open source`, `plan limits sdk`, `openfeature entitlements`, `entitlement service open source`; and a CNCF landscape search. Web search returned no relevant Reddit threads, and Reddit was not queried directly.

## Verdict: no open entitlements *standard* exists, so we proceed

There is no vendor-neutral entitlements **specification** with swappable providers, nothing that does for entitlements what OpenFeature does for flags. What exists falls into five groups:

1. **Commercial entitlement SaaS** (Stripe Entitlements, Stigg, Schematic, Planship). Each has its own model and SDK.
2. **Open-source billing platforms with an entitlement module** (Lago, OpenMeter, Flexprice, Autumn, Kill Bill, Polar). Each is a *system*, with its own server, data model, and API. Adopting one means adopting that vendor, open source or not.
3. **Embedded, single-implementation libraries** (Limitr; framework-bound gems and packages for Rails, Laravel, and Rust). They are not specs and have no provider model.
4. **Authorization engines that can *model* entitlements** (OpenFGA, Oso, Cerbos, SpiceDB). They fold entitlement into the RBAC/ReBAC layer, which this spec deliberately keeps separate ([§9](spec/sections/09-interoperability.md)).
5. **Unrelated uses of the word.** Apple and iOS code-signing entitlements, GitHub's `entitlements-app` (IAM), "Kill Bill entitlement" (a subscription's service start and end dates), and mobile in-app-purchase entitlements (RevenueCat, Adapty, Qonversion: store-receipt based, with SDKs per vendor).

None of them is a standard. Every group-2 project could *implement* OpenEntitlement as a provider (or, from v0.2, as an [OEREP](spec/README.md#roadmap) server) instead of being replaced by it. That is the "don't fork the ecosystem" outcome: this is a layer *under* those projects, not a competitor to them.

### What we found

| Project | Kind | License | Status (2026-11-03) | Why it isn't the standard |
|---|---|---|---|---|
| [Stripe Entitlements](https://docs.stripe.com/billing/entitlements) | SaaS feature list | proprietary | active | Boolean features only, derived from Stripe subscriptions |
| [Stigg](https://docs.stigg.io) | SaaS | proprietary | active | Vendor model and SDK |
| [Schematic](https://docs.schematichq.com) | SaaS | proprietary | active | Vendor model, and entitlements *are* its flags |
| Planship ([Stripe app](https://marketplace.stripe.com/apps/planship)) | SaaS | proprietary (client SDKs MIT) | active | Vendor model |
| [Lago](https://github.com/getlago/lago) | OSS billing | AGPL-3.0 | active, ~10.8k★ | A billing system. Argues entitlements and billing [*should be the same system*](https://getlago.com/blog/lago-entitlements) |
| [OpenMeter](https://github.com/openmeterio/openmeter) | OSS metering and billing | Apache-2.0 | active, ~2.4k★. Cloud is now *Kong Konnect Metering & Billing* | A system. Entitlements depend on its meters |
| [Flexprice](https://github.com/flexprice/flexprice) | OSS billing | AGPL-3.0 (open core) | active, ~6.9k★ | A system |
| Autumn ([docs](https://docs.useautumn.com)) | OSS billing on Stripe | MIT SDKs | main repo `useautumn/autumn` returns 404; only SDK repos are public | A system, `check`/`track` API |
| [Kill Bill](https://github.com/killbill/killbill) | OSS billing | Apache-2.0 | active | "Entitlement" means subscription state, not feature limits |
| [Polar](https://github.com/polarsource/polar) | OSS billing | Apache-2.0 | active | Billing with "benefits", not a spec |
| [Keygate](https://github.com/tabloy/keygate) | OSS license server | AGPL-3.0 | active | License keys, a system |
| [Limitr](https://jsr.io/@formata/limitr) | embedded policy engine | Apache-2.0 | active (0.5.x) | **Closest in spirit**: embedded and billing-agnostic. But it is one engine with its own policy DSL (Stof), not a spec with providers |
| Spackle ("open-source entitlements for Stripe Billing", [Show HN 2024](https://news.ycombinator.com/item?id=39839438)) | OSS | n/a | spackle.so unreachable, no public repo found: **appears defunct** | Was Stripe-bound |
| pricing_plans (Rails), eloquent-entitlements (Laravel), tideway (Rust) | framework libs | various | active | One framework, one storage, no provider model |
| OpenFGA ([entitlements guide](https://openfga.dev/docs/modeling/advanced/entitlements)), Oso, Cerbos | authz engines | Apache-2.0 | active | Merge entitlement into authorization |
| [OpenFeature](https://openfeature.dev) | flag standard | Apache-2.0 | CNCF incubating | Flags only. Our model. |
| [Flipt](https://docs.flipt.io/v1/integration/openfeature) | flag server | FCL-1.0-MIT (v2) | active | Flags. See the lesson below |

CNCF landscape: no entitlements, billing, or metering *standard* is listed. OpenMeter events use CloudEvents, which is an event envelope, not an entitlement model. Hacker News: no thread proposing a standard. The closest is ["Ask HN: Managing Entitlement/Billing with Feature Flags – Pros and Cons?"](https://news.ycombinator.com/item?id=38907509) (2024, no replies).

### Lago, read at the code level

The Lago entitlement module lives in [`getlago/lago-api`](https://github.com/getlago/lago-api) (`app/models/entitlement/*`, `app/queries/entitlement/subscription_entitlement_query.rb`, from mid-2025). Its data model is the closest of any vendor to OpenEntitlement:

| Lago (tables) | OpenEntitlement |
|---|---|
| `entitlement_features` (code, name, description) | Feature |
| `entitlement_privileges` (code, `value_type` integer/string/boolean/select, `config.select_options`) | Privilege (`enum` = `select`) |
| `entitlement_entitlements` + `_values` with `plan_id` | Plan values |
| the same tables with `subscription_id` | Override, organization scope, *replaces* the plan value |
| `entitlement_subscription_feature_removals` | Override of the gate to `false` / `0` |
| resolution: plan ⟗ subscription, `COALESCE(sv.value, pv.value)`, returning `value`, `plan_value`, `subscription_value` | `value`, `planValue`, `overrideId` in resolution details |
| plan `parent_id` (per-customer plan overrides create child plans) | Plan family |

What Lago doesn't have: `UNLIMITED`, grants (wallets are monetary), dated overrides, a mandatory reason or audit trail, subject- or resource-scoped values, a check API with reasons, and a usage check. A **Lago provider** is therefore straightforward. The subscription is the assignment, the parent plan is the family, and subscription values are organization overrides. It reads `GET /api/v1/subscriptions/{external_id}/entitlements` and writes through `PATCH …/entitlements`. It would talk to Lago over HTTP only: Lago is AGPL-3.0, so no Lago code may be copied into this Apache-2.0 repository.

### The Flipt lesson

Flipt is a feature-flag server that chose to be **an implementation of the standard instead of a standard of its own**. It maintains its OpenFeature providers in the `open-feature/*-sdk-contrib` repositories for 7 languages, and it was an early adopter of **OFREP**, the OpenFeature Remote Evaluation Protocol, so any OFREP-capable SDK talks to it with no Flipt-specific code. Two consequences for us:

1. **A spec is adopted when products can implement it cheaply.** That is why OpenEntitlement is a spec plus conformance suite first, and SDKs second ([ADR-0001](ADR-0001.md)).
2. **A wire protocol multiplies reach.** One HTTP endpoint on Lago, OpenMeter, or Flexprice would serve every SDK. OEREP is the top item for v0.2 ([§9.4](spec/sections/09-interoperability.md#94-remote-evaluation-informative-roadmap)).

## Vendor mapping

How each vendor's concepts map onto the OpenEntitlement model. 🟥 marks a place where billing leaks into the entitlement model.

| OpenEntitlement | Stripe Entitlements | Lago | Stigg | Schematic | OpenMeter |
|---|---|---|---|---|---|
| **Feature** | `entitlements.feature` (`name`, `lookup_key`) | Feature (`code`, `name`, `description`, `privileges[]`) | Feature (types: Boolean, Configuration, Metered, Enum) | Feature (types: boolean, event-based, trait-based). 🟥 Each feature *is* a flag with the same key | Feature |
| **Privilege / limit** | none: features are **boolean only**, with no quantity or value | Privilege (`code`, `value_type` ∈ integer/**string**/boolean/select, `config.select_options`): **a near-exact match**. Values are stored as strings and cast on read (`lago-api` `entitlement_entitlement_values.value`) | Configuration value, `usageLimit`, `hasUnlimitedUsage` flag, enum values | Entitlement value: on/off, a metered allocation, or a trait comparison | Entitlement type: boolean, static (free JSON config), metered (`usagePeriod`, soft limit) |
| **Unlimited** | n/a | none in the schema: an integer is just an integer | `hasUnlimitedUsage: true`, a separate flag | not documented in the pages reviewed | n/a (no allowance means no limit) |
| **Plan** | 🟥 Product + Price. Features attach to *products*. There's no plan object independent of what is sold | Plan, with entitlements per plan. 🟥 the plan is also the pricing object | Plan (free / paid / custom) + add-ons. 🟥 a plan bundles entitlements *and prices* | Plan, versioned (draft/published/archived) + add-ons. "Only the newest version can be subscribed" | Plan (in OpenMeter billing) |
| **Assignment** | 🟥 derived from Subscription status (active, cancelled, failed payment). No subscription means no entitlement | 🟥 Subscription (`external_id`) | 🟥 Subscription. `AccessDeniedReason.NoActiveSubscription` | Company → one plan + add-ons | Customer subscribes to plans |
| **Per-customer override** | none. Workaround: a custom product per customer | Subscription entitlement values that **replace** plan values (`COALESCE(sub_value, plan_value)`, the same rule as ours), plus per-subscription *feature removals*. No dates, no required reason. 🟥 keyed by *subscription*, not by customer | Promotional entitlements: per customer, time-limited or lifetime. They are **additive**, so they can't lower a limit | Company overrides, time-limited, "more or less". But checks take **"the most generous"** of plan and override, so an override can't cap below the plan | Per-customer entitlement with its own config |
| **Grant / credit** | 🟥 Billing credit grants are *monetary* (invoice credits), not quota | 🟥 Wallets / prepaid credits are monetary | Credit grants: currency, pool, priority, effective/expiry dates, ledger. 🟥 credits are a *currency* consumed through price mappings | Credit grants, burndown soonest-expiring first, ledger, preflight / reservation / lease | Grants: amount, priority, `effectiveAt`, expiration, rollover. **The closest match to our grants** |
| **Metered usage** | separate product (Billing Meters), not connected to entitlements | 🟥 Billable metrics (usage *is* billing) | Meters (aggregation of events) or app-calculated usage | `track` events (event-based features) or traits | 🟥 OpenMeter meters are required |
| **Trial** | 🟥 subscription status `trialing` | 🟥 plan `trial_period` (billing) | trial configuration on plans and products. Trial subscriptions contribute entitlements | 🟥 Trial on the plan. Conversion depends on "payment required up front". Trial expiry plan | n/a |
| **Shared pool / per-user** | n/a | n/a | customer *resources* (workspace/project) with their own entitlements and usage | users inherit company entitlements and can be tracked separately | `subject` (usage key) vs `customer` |
| **Denial shape** | n/a: you diff a list | n/a | `hasAccess`, `accessDeniedReason` ∈ {`NoActiveSubscription`, `InsufficientCredits`, `BudgetExceeded`, `Revoked`, …}. 🟥 billing states as denial reasons | boolean flag check plus usage and allocation | `hasAccess`, `balance`, `overage` |
| **Audit** | Stripe event log | soft delete (`deleted_at`) only | n/a | credit ledger | grant ledger |
| **Self-hosted** | ❌ | ✅ (AGPL server) | ❌ | ❌ | ✅ (Apache server) |

### Where billing leaks, and what the spec does about it

| Leak | Seen in | OpenEntitlement rule |
|---|---|---|
| No subscription means no entitlement, so contract and self-hosted customers can't be expressed | Stripe, Lago, Stigg | Assignment is its own fact with an opaque `channel`. Payment method never affects resolution ([Req 1.4.2](spec/sections/01-data-model.md#requirement-142)). A `FixedProvider` covers self-hosted installs ([§6.4](spec/sections/06-providers.md#64-the-fixed-provider)) |
| Plan = product = price | Stripe, Lago, Stigg | A plan is a set of privilege values. Prices live elsewhere |
| Feature changes wait for the next billing period ("Existing subscriptions will create active entitlements for any product feature changes at the start of the next billing period") | Stripe | Plan values are runtime data and take effect immediately ([Req 1.3.5](spec/sections/01-data-model.md#requirement-135)) |
| Overrides keyed to a subscription object | Lago | Overrides are keyed to a subject *and* bound to a plan family, and go stale instead of vanishing ([§1.5](spec/sections/01-data-model.md#15-overrides)) |
| "Most generous wins" / additive-only exceptions, so a contractual cap is impossible | Schematic, Stigg | An override *replaces* the plan value, and may be lower ([Req 1.5.2](spec/sections/01-data-model.md#requirement-152)) |
| Entitlement = feature flag | Schematic | The layers are orthogonal ([§9](spec/sections/09-interoperability.md)). Flags are for releases, entitlements are for commercial terms |
| Credits are a currency (money-like) | Stripe, Lago, Stigg | Grants are quota in the privilege's own unit. Converting money to quota is the billing system's job, before it writes a grant |
| Trials as a billing status | Stripe, Lago, Schematic | A trial is a *plan variant* in the same family ([Req 1.3.3](spec/sections/01-data-model.md#requirement-133)). When to end it is billing's decision |
| Usage = billable metric | Lago, OpenMeter | The spec defines the *check*, not the meter ([Req 1.7.1](spec/sections/01-data-model.md#requirement-171)) |
| Denial reasons are billing states | Stigg | Denials carry the limit, usage, and `requiredPlan` for an upsell UI ([§8](spec/sections/08-errors.md)). Billing state isn't an entitlement reason |

### Gaps we accept in v0.1

- **Add-ons** (Stigg, Schematic). Model a quantity add-on as a grant without expiry, and a capability add-on as an override. A first-class add-on object is on the roadmap.
- **Free-form configuration** (Stigg "Configuration", OpenMeter "static" JSON). It is deliberately excluded: an uncomparable value can't be upsold. Use `enum`, or keep it in flags or settings.
- **Recurring grants / usage periods** (OpenMeter `usagePeriod`, rollover). The caller supplies usage for the current period. Period resets belong to the meter.
- **Preflight / reservation / lease** (Schematic). `guard` covers the synchronous case. Long-running reservations are a candidate for v0.3.
- **Stripe can't express `false` or a plan id.** The adapter maps a missing boolean to `false`/PLAN when the customer has other active entitlements, and has no `planCatalog`, so it gives no `requiredPlan` ([sdk adapters](sdk-python/README.md#stripe-adapter)).

## Link check of the brief

All 14 URLs in the brief were fetched on 2026-11-03. Each returned HTTP 200 with a relevant page title, so none are dead and none moved to unrelated content. Six of them redirect to canonical URLs:

| URL | Result |
|---|---|
| https://docs.stripe.com/billing/entitlements | ✅ 200 "Entitlements \| Stripe Documentation" |
| https://getlago.com/blog/lago-entitlements | ✅ 200 "Entitlements and billing should be the same system \| Lago" |
| https://getlago.com/docs/guide/lago-cli/commands/features-and-entitlements | ✅ 200 "Features and entitlements - Lago" |
| https://getlago.com/blog/saas-entitlements | ✅ 200 "How do entitlements work in SaaS? \| Lago" |
| https://docs.stigg.io | ↪️ 308 → `/documentation/getting-started/welcome-to-stigg` (200) |
| https://docs.schematichq.com | ↪️ 307 → `/overview` (200) |
| https://openfeature.dev/specification/ | ✅ 200 |
| https://github.com/open-feature/spec | ✅ 200 |
| https://openfeature.dev/docs/reference/intro | ↪️ 301 → trailing slash (200) |
| https://openfeature.dev/docs/reference/concepts/provider | ↪️ 301 → trailing slash (200) |
| https://openfeature.dev/docs/reference/concepts/hooks | ↪️ 301 → trailing slash (200) |
| https://openfeature.dev/docs/reference/concepts/evaluation-context | ↪️ 301 → trailing slash (200) |
| https://github.com/open-feature/spec/tree/main/specification/assets/gherkin | ✅ 200 (contains `evaluation.feature`, `evaluation_v2.feature`, `hooks.feature`, `contextMerging.feature`, `metadata.feature`, `test-flags.json`) |
| https://docs.flipt.io/v1/integration/openfeature | ✅ 200 "OpenFeature - Flipt" (a `/v1/` path: Flipt v2 docs live elsewhere) |
