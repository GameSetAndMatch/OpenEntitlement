# RFC-0001: Entitlements spec v0.2

- **Status:** proposed. Not implemented; the normative spec remains v0.1.0 until this is accepted.
- **Date:** 2026-11-09
- **Replaces:** the drafts in PR #17 and PR #18.
- **Examples:** [`tier_variants.yaml`](examples/tier_variants.yaml), [`entitlements.yaml`](examples/entitlements.yaml)

This revision comes from running an entitlement layer in production: two tiers, trials, deals negotiated by Sales, card payments, and a self-hosted install. It keeps what worked and simplifies the rest. Sections 1 to 8 are the proposal. Sections 9 to 11 map it onto OpenEntitlement's current terms and behavior, and list what must still be settled.

In this document, **Organization** is the entitled party: the customer using the application, identified by `organizationId` (see [GLOSSARY.md](../../GLOSSARY.md)). Some source notes call this party a "tenant". In OpenEntitlement, Tenant means a customer of the hosted OpenEntitlement service. The two are different.

## 1. Concepts

Keep four concerns apart:

- **Tier:** the commercial level (Business, Enterprise).
- **Trial:** a time-limited variant of a tier, never a tier of its own.
- **Payment:** who collects the money.
- **Deployment:** where the software runs, never a tier.

A **tier variant** is a tier with or without its trial: Business, Business trial, Enterprise, Enterprise trial. It gives a default value to every privilege. An Organization is on exactly one tier variant.

The **contract** is the only link between payment and entitlements:

| Field | Content |
|---|---|
| `tier_variant` | what was sold |
| `terms` | the values that differ from the variant's defaults |
| `period` | start and end, both inclusive |
| `status` | `active`, `past_due` or `ended` |
| `source` | `{provider, ref}` or `{sales: ref}` |

- A payment provider (Stripe or another) is an adapter. Its events become contract changes. Entitlements never ask which provider was used.
- The billing arrangement ("paid online" or "invoice") changes no value.
- Buying more from inside the app is itself an entitlement: `self_serve_purchase_enabled`.

**No custom tier per customer.** A special deal is a contract on an existing tier variant, and its terms list what differs. A privilege added in a new release then reaches the customer through the variant. Code that reasons in tiers (upgrade path, `requiredTier`) never meets an unknown tier.

## 2. Where each thing lives

| Data | Where | Who changes it, and how |
|---|---|---|
| Privilege definitions | the application's code | developers, in a release |
| Tier variant defaults | **one versioned file** in the repository (`tier_variants.yaml`) | a reviewed PR and a release. **This is the only way.** No API and no migration changes a default. |
| Contracts and their terms | database | Sales and ops in the admin (SaaS); the install file (self-hosted) |
| Grants | database | ops, in the admin |
| History | database for Organization changes; git history for defaults | automatic |

Changing a default for everyone is rare and should be reviewed, so a release is the right path. Changing what one Organization gets is frequent and should not need a release, so it happens on that Organization's contract.

## 3. Privilege definitions: a JSON Schema subset

Each privilege is defined with a small subset of [JSON Schema 2020-12](https://json-schema.org/draft/2020-12):

- `type`: `boolean`, `integer` or `string`;
- `title`, `description`;
- `minimum`, `maximum`: integers only;
- `enum`: strings only;
- two extensions: `x-unlimited: true`, which allows the value `unlimited` on an integer, and `x-subjects`.

Nothing else: no `oneOf`, `$ref`, objects or arrays. Plain models with one validator are enough to check it, and a JSON Schema for editors is derived from them. Core SDKs keep no dependencies (ADR-0001), so the validator is hand-written in each language and shared conformance fixtures keep them aligned.

```json
{
  "max_members_per_project": { "type": "integer", "title": "Members per project", "minimum": 1, "x-unlimited": true },
  "recording_minutes":       { "type": "integer", "minimum": 0 },
  "export_enabled":          { "type": "boolean" },
  "self_serve_purchase_enabled": { "type": "boolean" },
  "retention":               { "type": "string", "enum": ["30d", "365d"] }
}
```

The same definition serves every layer:
- **The SDK** checks each value the server returns against it: type, bounds, enum and unlimited.
- **The validator** checks `tier_variants.yaml` and `entitlements.yaml` at startup.
- **Editors** give completion and errors from the derived schema.
- **Admin UIs** choose the right input control.

OEREP needs no type field on the wire because both ends share the definitions. This differs from OFREP, where the caller's typed getter supplies the expected type.

Names read on their own:
- `max_<things>[_per_<container>]` caps a count;
- `<resource>_minutes` and `<resource>_days` are allowances;
- `<feature>_enabled` is a switch.

A name never contains a tier or a price. A capability that every tier has gets no switch; tiers differ by their caps.

## 4. Values: three layers in V1

1. **The tier variant's default**, from the file.
2. **The contract's terms**, per Organization, with an end date.
3. **Grants**, which add to allowances and add up.

Then **the install can only remove**: a component that isn't installed resolves to off, with reason `NOT_INSTALLED`.

Overrides on a narrower subject (one member, one resource) wait for a real need. Grants already cover "more minutes for one person".

**Validation is strict at startup.** Any of the following stops the app with a message that names the entry:
- an unknown key;
- a wrongly typed value;
- an out-of-bounds value;
- an unknown tier variant;
- a default missing for a privilege.

There is no version number to bump by hand, because this validation catches every mismatch with a more precise message.

### Contract-status policy

The Tenant operating an entitlement model chooses what happens to its Organizations when a contract becomes `past_due` or `ended`. Authorized Tenant administrators configure this policy; an affected Organization cannot grant itself continued access by changing its own status policy. Self-hosted operators configure the same policy through their installation configuration.

Keep the first policy model small: for each status, select one action:

| Action | Behavior |
|---|---|
| `readOnly` | Preserve existing application data and authorized reads, but refuse application mutations. Retain the contract and its provenance so the restriction can be explained. Read-only is explicit lifecycle state that the application enforces, not a fabricated privilege value. |
| `fallback` with a `tierVariant` | Resolve against a configured, existing variant, such as a Free non-trial variant. Keep the original contract/history; the effective fallback must not rewrite what was sold. Validate the target before activating the policy. |

For example, a Tenant can choose `past_due → readOnly` and `ended → fallback to free`. Another can choose read-only for both. The fallback variant must exist in that Tenant's reviewed defaults; the examples do not require every product to offer a Free tier. This policy is independent of the payment adapter and is audited when changed.

A product may design a variant with read-only entitlements and select it as the fallback. The application must still enforce its intended mutation restrictions: a tier name, reduced cap, or disabled creation switch alone does not guarantee read-only behavior for existing resources. Lifecycle restrictions never bypass role/resource authorization.

Both statuses need an explicit configured action before the lifecycle feature is enabled. Do not infer a fallback from the highest tier, the payment channel, or partial defaults. Applying a policy is idempotent, preserves data, and exposes the triggering status and effective action. When access resumes, recompute from the current contract/status rather than a destructively rewritten assignment. Exact expiry/renewal boundaries and treatment of existing grants still require the decisions below.

## 5. Self-hosted installs

- **One file per install:** `entitlements.yaml` holds **contracts only**. It never holds definitions or defaults.
- **At startup, the file is reconciled into the database.** Contracts are created, updated or removed, and marked `source: file`. The resolver has a single path, the same as in SaaS. The API refuses every entitlement write, and the admin shows values read-only.
- **Expired contracts are visible with a warning.** When expiry transitions a contract to `ended`, apply the configured contract-status policy above. Do not silently discard terms or fall back to the sold variant's defaults, which could grant more than was agreed. Renewal is a commercial step.
- **There is no single-tenant mode.** The install runs the normal multi-tenant code with one Organization, created by a seed script.

## 6. Writes and refusals

- **Every change is audited** with a mandatory reason. This covers:
  - contract terms, written atomically under one contract reference; `null` returns a privilege to its default;
  - grants;
  - a move to another tier variant.
- **An entitlement change never removes existing data.**
  - Caps limit new creations; switches limit entry points.
  - After a downgrade, a container over its cap stays readable but its writes are refused. The application decides this by comparing the container with the cap. Returning to a tier that allows it unlocks it.
- **Standard refusal:** HTTP 403 with `{"code": "entitlement_required", "feature", "privilege", "requiredTier"}`. `requiredTier` is computed from the defaults. Locked features are shown with an upgrade path, not hidden.

## 7. Where entitlements stop

| Mechanism | Question it answers | Changed by | Lifetime |
|---|---|---|---|
| Role | Is this person allowed? | the Organization's admins | permanent |
| Feature flag | Is the work finished? | developers | temporary, deleted after release |
| Deployment policy (startup configuration) | Is the component installed? May users create Organizations? Where does support go? | whoever installs | per install |
| Entitlement | What may this Organization use, and how much? | the defaults file, the contracts | permanent, audited |

## 8. Open questions

1. Should per-container caps (`_per_project`) be declared subjects?
2. Should "N per seat per year" allowances be a type of their own?
3. Should a vendor-side global admin be able to read an Organization's data?
4. Should the Owner be warned before a downgrade makes containers read-only?

## 9. Mapping to OpenEntitlement v0.1

| v0.1 (current spec and SDKs) | v0.2 |
|---|---|
| Plan, with `variantOf` for trials | Tier variant (`tier`, `trial`), with defaults read only from `tier_variants.yaml` |
| Plan values edited through the admin API and console | Read-only at runtime. The admin API refuses default writes. |
| Partial plan values, falling back to the catalog default | Every variant values every privilege, checked at startup |
| Assignment (Organization → plan) | The contract's `tier_variant` |
| Overrides (plan-family bound, stale when the family changes; Organization, subject or resource scope) | Contract terms, Organization scope only. Subject and resource overrides are removed in V1. |
| Grants (additive, optional subject) | Unchanged |
| Reasons `PLAN`, `OVERRIDE`, `GRANT`, `FIXED`, `DEFAULT`, `ERROR` | Proposed: `VARIANT`, `CONTRACT`, `GRANT`, `NOT_INSTALLED`, `ERROR` |
| `requiredPlan` | `requiredTier`, lowest non-trial tier whose defaults satisfy the need |
| `FixedProvider` for self-hosted installs | `entitlements.yaml` reconciled into storage, writes refused |
| Intervals `[startsAt, expiresAt)` | Contract period, both ends inclusive |
| `UNLIMITED` encoded on the wire as `{"unlimited": true}` | Unchanged on the wire. `unlimited` is the YAML spelling only. |
| Service contract records with PDF evidence (console) | The same records become v0.2 contracts. PDFs stay service-only, outside OEREP. |

This is a breaking change. Releasing it means spec 0.2.0, a new OEREP major version for the reason and `requiredTier` changes, conformance scenarios rewritten for the three layers, and migration notes. SDK and service versions stay independent.

## 10. Effect on the hosted service (issue #15)

- A Tenant pushes `tier_variants.yaml` from its CI with an API key, alongside its privilege definitions. The console shows both read-only. Nobody edits tiers in the console.
- Permissions change accordingly:
  - `plans:write` is removed;
  - `overrides:write` becomes `contracts:write`;
  - `grants:write` stays.

  Permission scopes become tier variants or Organizations. A Member can be limited to Business contracts, or to specific Organizations.
- The console's YAML view (PR #19) shows the defaults file as last pushed, followed by each Organization's contract.

## 11. To settle before implementation

These points are not answered by sections 1 to 8. Each one needs a decision before code depends on it.

1. **Tier order.** `requiredTier` needs a ranking. The example file uses the order of a `tiers` list, lowest first.
2. **Trial length.** The proposal: a trial is a contract on a trial variant, and the contract's period sets its length.
3. **Lifecycle transitions.** The Tenant chooses `readOnly` or a named fallback variant for `past_due` and `ended` (section 4). Still define expiry-to-status transitions, renewal/grace boundaries, trial completion, existing grant applicability, and the versioned result carrying lifecycle restrictions. Test policy validation, repeated events, restoration, and application write refusal.
4. **Organizations without a contract.** Either a configured fallback variant, or the safe error value.
5. **`NOT_INSTALLED` for string privileges.** "Off" is `false` for a boolean and `0` for an integer, but a string enum has no off value. Options: forbid install gating on string privileges, or declare which value counts as off.
6. **Inclusive periods.** If periods are dates, "inclusive" needs a time zone. If they are timestamps, it needs a precision.
7. **Error fallback.** Today a privilege's catalog `default` is what a transport error fails closed to. V0.2 still needs such a value, separate from variant defaults.
8. **A catalog endpoint.** Should OEREP add an optional `GET /oerep/v1/catalog` that returns the JSON Schema, for clients that don't hold the definitions in code?
