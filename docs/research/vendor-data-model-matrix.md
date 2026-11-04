# Entitlement data-model comparison

Reviewed **2026-11-04** against public first-party documentation. Repository-only research: this document is not published on the product website. It compares concepts and semantics, not prices, product quality, or a verified integration.

**OE baseline:** implemented specification v0.1.0 at repository revision `24bdb92`, especially [data model](../../spec/sections/01-data-model.md), [resolution](../../spec/sections/03-resolution.md), [providers](../../spec/sections/06-providers.md), and [OEREP](../../spec/sections/10-remote-evaluation.md). Later website commits do not change this model.

## Reading the matrices

- **Documented:** the source explicitly describes the vendor behavior.
- **Mapping inference:** our interpretation of how that behavior could map to OE; not proof of compatibility.
- **Not established:** the reviewed material does not settle the question. This does not mean the vendor lacks the capability.
- **Outside OE scope:** a vendor provides a broader function that OE currently leaves to the application or another system.

No row certifies a vendor as OEREP-compatible. Same names do not guarantee equivalent semantics. The comparison is limited to Stripe Entitlements, Lago, Stigg, Schematic, and OpenMeter; other platforms are not implicitly assessed.

## Our implemented model versus the proposed refinement

This distinction matters because the proposed plan model has **not** been implemented.

| Dimension | OE implemented today | Proposed refinement from the product brief | Difference / status |
|---|---|---|---|
| Plan identity | `id`, `name`; optional `rank`, `public`, `variantOf` | Backend-owned UUID, stable code, name, tier, `isTrial` | Proposal; current `id` is not required to be a UUID and no separate stable code exists. |
| Plan administration | Audited runtime mutations; current console can create plans/edit defaults | Migration/seed creation; console shows defaults and manages organization exceptions | UI restriction and lifecycle ownership remain future work. |
| Trial representation | Variant of a base plan; one-level family | Trial flag within a tier | Requires a model and transition change. |
| Trial conversion | Assignment changes; no dedicated `endTrial` operation | Idempotent `endTrial`; tier changes retain trial state | Proposed operation, not an existing SDK/API capability. |
| Override binding | Bound to **plan family**; survives trial-to-paid conversion within family | Bound to the **exact plan**; trial cap becomes stale on conversion | These rules conflict. The proposed rule must explicitly supersede the current requirement. |
| Trial end date | No dedicated trial schedule engine | Derive from start plus resolved duration privilege | Proposed domain behavior; do not claim it is implemented. |
| Quota windows / claims | Usage belongs to the application | Remain deferred under the current scope decision | No OE metering, resets, or claim-idempotency service is proposed by this matrix. |

## Stripe Entitlements

| Dimension | OE implemented model | Stripe documented model | Difference / mapping implication |
|---|---|---|---|
| Feature identity | Feature with one or more typed privileges | Feature has a unique `lookup_key`; products attach features. [S1] | One Stripe access feature can map to an OE boolean privilege; not automatically to a multi-privilege catalog. |
| Resolved value | Boolean, integer, ordered enum, or unlimited integer | Active Entitlement references a feature and lookup key, without a numeric limit/configuration value. [S2] | Native object represents access membership. Numeric values require a separate source or explicit convention. |
| Assignment | Organization-to-plan fact; payment channel is opaque | Customer access follows product-feature mappings and subscription lifecycle. [S1] | Application must define customer/organization mapping and synchronization policy. |
| Changes | Current runtime plan values drive resolution | Product-feature changes for existing subscriptions take effect at the next billing period. [S1] | Do not assume immediate OE-style value updates from a product attachment change. |
| Exceptions / grants | Replacement overrides and additive quota grants are distinct facts | An OE-shaped replacement or additive quota grant is not established by the Active Entitlement schema. [S2] | Not a claim that all Stripe products lack exceptions/credits; those need a separate model review. |
| Explanation | Reason, plan value, overrides, grants, stale overrides | Active Entitlement object provides access identity. [S2] | An adapter cannot infer OE provenance fields from that object alone. |

[S1]: https://docs.stripe.com/billing/entitlements.md?dashboard-or-api=api
[S2]: https://docs.stripe.com/api/entitlements/active-entitlement/object

## Lago

| Dimension | OE implemented model | Lago documented model | Difference / mapping implication |
|---|---|---|---|
| Feature / privilege | A feature requires typed privileges | Feature has code/name and optional privileges. [L1] | Close structural mapping; an unprivileged feature needs an explicit OE gate mapping. |
| Value types | Boolean, non-negative integer, ordered enum | Boolean, integer, string, select. [L1] | Free strings do not fit OE's ordered enum; select order needs semantic verification. |
| Plan values | Values per plan and privilege | Features/privilege values attached to plans. [L1] | Similar shape; OE keeps pricing outside the entitlement model. |
| Negotiated terms | Organization-scoped replacement override | Per-subscription entitlement values. [L1] | A subscription ID is not an organization ID; multiple subscriptions need a policy. |
| Removal | Override gate to false/zero, subject to catalog rules | A subscription entitlement can be removed. [L1] | Map removal to a defined gate value rather than dropping unrelated application data. |
| Quotas / grants | Additive grants; usage/reset logic external | Allowances and quotas belong to Lago's usage-based engine. [L1] | No evidence here of identical OE grant lifecycle, scope, or draw order. |
| Binding / timing | Dated, family-bound overrides become stale | Exact-plan/family staleness and dates are not established by this guide. [L1] | Verify these separately; neither current nor proposed OE binding should be assumed. |

[L1]: https://getlago.com/docs/guide/entitlements

The guide uses “unlimited invites” as an example, but does not establish the exact unlimited wire representation. The old prior-art statement that Lago has no unlimited concept is therefore too categorical; interoperability of the encoding remains unverified.

## Stigg

| Dimension | OE implemented model | Stigg documented model | Difference / mapping implication |
|---|---|---|---|
| Packaging | Entitlement plan values independent of price | Product catalog includes products, plans, add-ons, coupons, credits. [T1] | A broader monetization model; import entitlement facts without importing every billing concept. |
| Evaluation | Typed privilege value and details | SDK checks boolean, numeric, and metered entitlements; returns access and type-specific values. [T2] | Distinguish numeric configuration from a metered usage limit. |
| Unlimited | Distinct singleton / `{"unlimited":true}` | SDK exposes explicit unlimited indicators. [T2] | Translate the value explicitly; do not use sentinel integers. |
| Customer exception | Override replaces and may lower a limit | Promotional value and subscription value resolve toward the more generous entitlement. [T3] | Cannot represent a restrictive OE cap by a promotional entitlement alone. This is not simple quota addition either. |
| Expiration | Dated overrides and grants | Promotions can be time-limited or lifetime. [T3] | Similar scheduling intent; equivalent family binding is not established. |
| Consumption | Application counts usage; guard coordinates check-and-act | Metered checks accept requested usage, then usage/events are reported with idempotency keys. [T4] | Broader usage pipeline. Do not assume its check/report sequence is OE's locked transaction. |
| Scoping | Organization plus optional subject/resource | SDK supports a customer and optional resource identifier. [T2] | Resource IDs do not establish OE's subject-first allowance semantics. |

[T1]: https://docs.stigg.io/documentation/modeling-your-pricing-in-stigg/overview.md
[T2]: https://docs.stigg.io/api-and-sdks/integration/backend/nodejs.md
[T3]: https://docs.stigg.io/documentation/managing-customers-and-subscriptions/customers/managing-customers-promotional-entitlements.md
[T4]: https://docs.stigg.io/guides/i-want-to/enforce-metered-feature-limits.md

## Schematic

| Dimension | OE implemented model | Schematic documented model | Difference / mapping implication |
|---|---|---|---|
| Assignment | Organization-to-plan fact | Company plan can be managed with or without Stripe. [C1] | Do not claim Stripe is mandatory for every Schematic entitlement use case. |
| Customer exception | Replacement override, including a lower cap | Company override has typed value fields and optional expiration. [C2] | Shape alone is insufficient: precedence differs. |
| Override precedence | Active matching override replaces plan value | Plan changes preserve/reapply overrides; a more generous plan amount wins. [C1] | A restrictive OE cap and a generous-access exception are different contracts. |
| Plan version changes | No first-class version migration object | Companies may remain on an older plan version until migrated. [C1] | Do not equate Schematic plan version with OE plan family or `variantOf`. |
| Trial transition | Current OE trial variant shares a family | Trial ending can convert a company to the default plan. [C1] | Does not establish proposed OE same-tier/non-trial conversion behavior. |
| Usage periods | Application-defined consumption windows | Override API includes usage period/reset configuration. [C2] | Those fields concern usage behavior that OE leaves external. |
| Notes / audit | Mandatory mutation actor/reason and audit event | Override API offers optional notes and timestamps. [C2] | Reviewed endpoint does not prove equivalent atomic audit guarantees; verify separately. |

[C1]: https://docs.schematichq.com/catalog/managing-company-plans
[C2]: https://docs.schematichq.com/api-reference/entitlements/create-company-override

## OpenMeter

| Dimension | OE implemented model | OpenMeter documented model | Difference / mapping implication |
|---|---|---|---|
| Feature / entitlement | Feature contains typed privileges | Boolean, static, and metered entitlement types. [M1] | Feature-level entitlements need a deliberate mapping to privilege keys. |
| Configuration | Ordered enums, no free JSON configuration value | Static entitlement returns JSON configuration. [M1] | Arbitrary JSON is not equivalent to an ordered entitlement value. |
| Provisioning | Independent plan assignment and exception facts | Quickstart creates entitlements directly for customers. [M3] | Subscription creation is not a demonstrated prerequisite in that flow. |
| Evaluated amount | Resolved capacity; usage supplied by application | Metered response includes access, balance, usage, and overage. [M1] | Remaining balance is not the total OE limit. |
| Grants | Additive quota, with subject allowance before pool | Amount grants have effective time, expiry, priority, rollover, recurrence. [M2] | Similar quota intent, different lifecycle and consumption ordering. |
| Periods | No quota window/reset engine | Metered entitlements define usage periods and resets. [M1] | Broader responsibility, not an OE feature gap to silently emulate. |
| Unlimited | Explicit unlimited value | Equivalent unlimited encoding not established in reviewed pages | A successful access check or positive balance does not itself mean unlimited. |

[M1]: https://openmeter.io/docs/billing/entitlements/entitlement
[M2]: https://openmeter.io/docs/billing/entitlements/grant
[M3]: https://openmeter.io/docs/billing/entitlements/quickstart

## Semantic probes before considering an integration

These are proposed evaluation cases, not results from running vendor accounts:

| Probe | OE expected result today | What needs checking elsewhere |
|---|---|---|
| Plan 100, matching active override 20 | 20 | Replacement versus generous-value precedence. |
| Plan 100, override 20, organization grant 10 | 30 | Grant must add after replacement, not compete as another generous value. |
| Trial override 8, convert to paid base in the same family | Override survives under current spec | Proposed exact-plan binding would instead make it stale. |
| Plan changes to a different family | Override retained but inactive; grant survives | Vendor exception retention, binding and ledger behavior. |
| Another subject evaluates a personal grant | That grant does not apply | Customer/resource IDs must not accidentally share personal allowance. |
| Evaluation fails | Declared default, reason ERROR, no upgrade suggestion | Fallback semantics and the actual default chosen by the application. |
| Same request retries consumption | Not owned by OE | Usage-store idempotency; no claim that an evaluation check consumes quota. |

## Open questions and limits

- Audit durability, cache invalidation guarantees, exact unlimited encodings, and tenant/resource hierarchy are not comprehensively verified for every vendor here.
- No paid account, live transaction, source-code audit, load test, or adversarial test was run against these products. Docs may differ by version, plan, and deployment.
- “Outside OE scope” describes our chosen boundary; it is not a criticism of a broader vendor capability.
- OpenFeature and Ossie inform interoperability design but are not entitlement-model peers in this matrix. Flexprice, Autumn, Polar, Kill Bill, and Planship remain separate research work.
- Keep proposed plan/trial changes explicit in any later matrix update. This document changes neither SDK behavior nor the normative specification.
