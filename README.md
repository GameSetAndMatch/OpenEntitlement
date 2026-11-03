<img src="assets/icon.svg" width="64" height="64" alt="">

# OpenEntitlement

**A vendor-neutral standard for entitlements: what an organization may do, and how much of it.**
OpenEntitlement is to entitlements what [OpenFeature](https://openfeature.dev) is to feature flags: one evaluation API, swappable providers, hooks, an evaluation context, and a conformance suite.

```ts
const client = createClient({ provider: new PostgresProvider({ pool }), catalog });

if (await client.isEnabled("sso", { organizationId })) { /* show SSO settings */ }

await client.guard("projects.max", 1, { organizationId }, {
  count: (tx) => countProjects(tx, organizationId),
  act:   (tx) => insertProject(tx, input),
}); // throws EntitlementLimitExceeded { limit, current, requested, requiredPlan: "business" }
```

Write gates once, then swap Stripe for Stigg, Lago, your own Postgres tables, or a `FixedProvider` on self-hosted installs without touching them.

## What's here

| Path | What |
|---|---|
| [`spec/`](spec/README.md) | The specification: 9 sections of numbered RFC 2119 requirements |
| [`spec/assets/gherkin/`](spec/assets/gherkin/README.md) | Conformance suite: 11 feature files, tagged by requirement and provider capability |
| [`sdk-python/`](sdk-python/README.md) | `openentitlement` (core, zero deps), `openentitlement-postgres`, `openentitlement-stripe` |
| [`sdk-js/`](sdk-js/README.md) | `@openentitlement/core` (zero deps), `@openentitlement/postgres`, `@openentitlement/stripe` |
| [`PRIOR_ART.md`](PRIOR_ART.md) | What exists, the vendor mapping table, where billing leaks, link check |
| [`ADR-0001.md`](ADR-0001.md) | Why a spec plus providers, not another service, and how we changed the starting model |

## The model in one screen

- **Layers stay separate.** Authentication (401), RBAC (403), **entitlement (403 `entitlement_required` + `requiredPlan`)**, and feature flags (404). This spec covers only the entitlement layer.
- **Definitions in code, values as data.** Features and privileges (`seats.max`, `sso.enabled`, `reports.retention`) are declared by the app. Plan values, overrides, and grants are runtime data, audited.
- **Plan** → a value per privilege. A trial is a *variant* of a plan. The payment channel never affects resolution.
- **Override** → *replaces* the plan value for an org, user, or resource. It is dated, needs a reason, and is bound to the plan family. It goes **stale, not deleted**, when the plan changes.
- **Grant** → *adds* quota (+500 API calls until Friday). It survives plan changes. Subject-scoped grants are personal allowances drawn before the shared pool.
- **`UNLIMITED`** is its own value (`{"unlimited": true}`), never `MAX_INT` or `null`.
- **Downgrades** gate new consumption only: decrements always pass, and nothing is hidden or deleted.
- **Errors fail closed** to the privilege default, with no upsell on `ERROR`.

## Status

`v0.1.0`, a draft. Both SDKs pass the full conformance suite on every provider for the capabilities it declares:

| Target | Python | TypeScript |
|---|---|---|
| in-memory | ✅ 110/110 | ✅ 110/110 |
| Postgres (16) | ✅ 110/110 | ✅ 110/110 |
| Stripe adapter (fake account) | ✅ 41/41 | ✅ 41/41 |
| fixed provider | ✅ 6/6 | ✅ 6/6 |

The Stripe adapter is tested against a fake account built from the response shapes in Stripe's docs, not against live Stripe.

Roadmap: OEREP (a remote evaluation protocol, so billing servers implement it once), add-ons, change events. See [spec/README.md](spec/README.md#roadmap).

## License

[Apache-2.0](LICENSE)
