# OpenEntitlement conformance suite

Gherkin scenarios that any SDK and provider can run to prove they implement the spec, in the style of [OpenFeature's test assets](https://github.com/open-feature/spec/tree/main/specification/assets/gherkin).

| File | Covers |
|---|---|
| [`resolution.feature`](resolution.feature) | plan values, defaults, errors, channel independence (§3.1, §1.4) |
| [`unlimited.feature`](unlimited.feature) | `UNLIMITED` semantics and encoding, value validation (§1.2, §1.5.6) |
| [`features.feature`](features.feature) | `isEnabled`, gates, `requireEnabled`, `requiredPlan` for locked features (§3.2, §3.4) |
| [`overrides.feature`](overrides.feature) | replacement, staleness, trials, dates, specificity, conflicts (§1.5, §3.1) |
| [`grants.feature`](grants.feature) | stacking, dates, subject scoping, plan changes, revocation (§1.6, §3.1.7) |
| [`limits.feature`](limits.feature) | `requireWithin`, the downgrade rule, error shape, `requiredPlan` (§3.3, §3.4, §8.1) |
| [`pools.feature`](pools.feature) | shared pools, personal allowances, draw order (§3.3.3, §3.3.4) |
| [`audit.feature`](audit.feature) | mutations, audit events, veto hooks (§6.3, §7) |
| [`concurrency.feature`](concurrency.feature) | `guard` linearizability (§5) |
| [`fixed.feature`](fixed.feature) | the fixed provider (§6.4) |
| [`http.feature`](http.feature) | `toHttpProblem` (§8.2) |

Fixtures: [`../catalog.json`](../catalog.json) (the catalog the application "declares") and [`../plans.json`](../plans.json) (the plans seeded by `Given the standard plans`).

## Tags

- `@spec-x.y.z` names the requirement a scenario tests.
- **Capability tags** gate scenarios on the [provider's declared capabilities](../../sections/06-providers.md#requirement-613):
  - `@overrides`, `@grants`, `@mutations`, `@plan-catalog`: the scenario runs only against providers that declare that capability. A scenario or feature with several tags needs all of them.
  - `@fixed`: runs **only** against fixed providers, and fixed providers run **only** `@fixed` scenarios.
- A scenario without capability tags MUST pass on every non-fixed provider.

## Seeding

`Given` steps that create plans, values, assignments, overrides, or grants are *seeding* steps. A harness MAY implement them through the SDK's admin interface (for providers with `mutations`), or through any provider-specific back door (a fake Stripe account, SQL fixtures). Errors in `Given` steps fail the scenario. Errors in `When` steps are captured and MUST be asserted by a later `Then the operation fails with "<CODE>"`. An unasserted captured error fails the scenario.

`When` mutation steps clear the recorded audit log before the first mutation of the scenario's `When` phase, so `Then an audit event records …` sees only what the scenario did.

## Step vocabulary

Values are written `true`, `false`, an integer, `unlimited`, or a quoted enum option (`"365d"`). A *scope* is one of:

```
organization "<org>"
subject "<subject>" of organization "<org>"
resource "<resource>" of organization "<org>"
subject "<subject>" and resource "<resource>" of organization "<org>"
```

Reference runners with the full step implementations: [`sdk-python/conformance`](../../../sdk-python/conformance) and [`sdk-js/conformance`](../../../sdk-js/conformance). Each one is about 300 lines with no Gherkin dependency, so porting to another language is mechanical.
