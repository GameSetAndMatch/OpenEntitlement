# RFC-0001: Entitlements proposal, revision 0.3

- **Status:** proposed. Not implemented; the normative spec remains v0.1.0 until this is accepted.
- **Date:** 2026-11-09
- **Revision:** incorporates the latest short v0.3 brief; this is a proposal revision, not a released spec, SDK, service, or OEREP version.
- **Replaces:** the drafts in PR #17 and PR #18.
- **Examples:** [`tier_variants.yaml`](examples/tier_variants.yaml), [`entitlements.yaml`](examples/entitlements.yaml)

> Authoring update: [RFC-0002](0002-privilege-catalog.md) and [ADR-0003](../../ADR-0003.md) supersede the older authoring terminology and release-file-only default rule. The remaining contract refinement is still a proposal; it does not supersede released OEREP behavior.

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
| Privilege definitions | Workspace catalog, consumed by application code and SDK validation | authorized Workspace catalog authors; reviewed files for fixed installations |
| Tier variant values | Workspace control-plane data in SaaS; reviewed `tier_variants.yaml` for fixed installations | authorized Workspace authors in SaaS; a reviewed release for fixed installations |
| Contracts and their terms | database | Sales and ops in the admin (SaaS); the install file (self-hosted) |
| Grants | database | ops, in the admin |
| History | database for Organization changes; git history for defaults | automatic |

Catalog defaults are shared within a Workspace. Tier variants inherit them unless explicitly replaced; a customer-specific exception belongs on the Organization's contract. Publishing changes must validate the complete effective variants and preserve audit history. Do not expose two independent writable sources for the same Workspace.

## 3. Privilege definitions: a JSON Schema subset

Each privilege is defined with a small subset of [JSON Schema 2020-12](https://json-schema.org/draft/2020-12):

- `type`: `boolean`, `integer` or `string`;
- finite fractional `number` values are deferred by this revision: the initial scope is explicitly integer quantities, booleans, and strings/enums;
- `title`, `description`;
- `minimum`, `maximum`: integers only;
- `enum`: strings only;
- two extensions: `x-unlimited: true`, which allows the value `unlimited` on an integer, and `x-subjects`.

Nothing else: no `oneOf`, `$ref`, objects or arrays. Plain models with one validator are enough to check it. The validators are models in each language: Pydantic in Python and Zod in TypeScript, both regular dependencies of the core SDKs. The shared cross-language contract is the JSON Schema 2020-12 document generated from the Pydantic models and committed as [`spec/schemas/privilege-catalog.schema.json`](../../spec/schemas/privilege-catalog.schema.json); CI fails when regenerating it produces a diff. Shared fixtures in [`spec/assets/catalog-fixtures/`](../../spec/assets/catalog-fixtures/README.md) must be accepted or rejected identically by Pydantic, by Zod and by that JSON Schema, except for rules JSON Schema cannot express (cross-references, Group cycles, unique items, bounds between fields), which fixtures mark as needing model validation. This replaces the earlier plan of a hand-written validator per language. Integer quantities must be safe across the supported languages; booleans and numeric strings must not pass as integers. The `x-unlimited` annotation must be translated to an ordinary allowed-value alternative in a generated editor schema; it does not make the string `unlimited` satisfy a standard `type: integer` schema by itself.

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

1. **The effective tier variant default**: its explicit value, otherwise the Workspace catalog default. Fixed installations publish this configuration through reviewed files.
2. **The contract's terms**, per Organization, with an end date.
3. **Grants**, which add to allowances and add up.

Then **the install can only remove**: a component that isn't installed is unavailable, with reason `NOT_INSTALLED`. Its off representation must remain compatible with the privilege constraints; the unresolved case includes integers with a positive minimum as well as strings (section 11). Do not fabricate an invalid value that the SDK would turn into a validation error.

Overrides on a narrower subject (one member, one resource) wait for a real need. Grants already cover "more minutes for one person".

**Validation is strict at startup.** Any of the following stops the app with a message that names the entry:
- an unknown key;
- a wrongly typed value;
- an out-of-bounds value;
- an unknown tier variant;
- a default missing for a privilege.

The configuration files need no manually synchronized catalog-version field: validate them against the running application definitions. This does not remove normal spec, SDK, service, or protocol versioning, or the need to document semantic compatibility changes.

### Contract-status policy

The Tenant operating an entitlement model chooses what happens to its Organizations when a contract becomes `past_due` or `ended`. Authorized Tenant administrators configure this policy; an affected Organization cannot grant itself continued access by changing its own status policy. Self-hosted operators configure the same policy through their installation configuration.

Keep the first policy model small: for each status, select one action:

| Action | Behavior |
|---|---|
| `readOnly` | Preserve existing application data and authorized reads, but refuse application mutations. Retain the contract and its provenance so the restriction can be explained. Read-only is explicit lifecycle state that the application enforces, not a fabricated privilege value. |
| `fallback` with a `tierVariant` | Resolve against a configured, existing variant, such as a Free non-trial variant. Keep the original contract/history; the effective fallback must not rewrite what was sold. Validate the target before activating the policy. |

For example, a Tenant can choose `past_due → readOnly` and `ended → fallback to free`. Another can choose read-only for both. The fallback variant must exist in that Tenant's reviewed defaults; the examples do not require every product to offer a Free tier. This policy is independent of the payment adapter and is audited when changed.

A product may design a variant with read-only entitlements and select it as the fallback. The application must still enforce its intended mutation restrictions: a tier name, reduced cap, or disabled creation switch alone does not guarantee read-only behavior for existing resources. Lifecycle restrictions never bypass role/resource authorization.

Both statuses need an explicit configured action before the lifecycle feature is enabled. Do not infer a fallback from the highest tier, the payment channel, or partial defaults. Applying a policy is idempotent, preserves data, and exposes the triggering status and effective action. When access resumes, recompute from the current contract/status rather than a destructively rewritten assignment. Period expiry alone does not change contract status or invoke a fallback: it keeps the agreed terms applying and raises a warning. An explicit, audited transition to `ended` or `past_due` invokes the configured policy. Renewal boundaries and treatment of existing grants still require the decisions below.

### Per-tier grace period

Add one optional Tier policy field, `gracePeriodDays`, to the reviewed defaults configuration. It is a non-negative integer, defaults to `0`, and applies to `past_due`. It is lifecycle metadata, not a privilege, a new tier flavor, or another value-resolution layer. A tier's trial and non-trial variants share this setting unless a later use case justifies more complexity.

On entry into `past_due`, record the transition instant and compute an explicit `graceEndsAt` from the tier's setting. For this setting, a day is 24 hours and timestamps are UTC. Before `graceEndsAt`, retain the contract's agreed access. At or after that instant, apply the configured `past_due` action (`readOnly` or a named fallback variant), without deleting data, removing contract terms, or changing the recorded commercial status merely to enforce access. Zero means the configured action applies immediately.

Repeated events for the same `past_due` episode must not restart grace. Returning to `active` clears that episode's restriction; a later genuine transition into `past_due` starts a new episode. An explicit transition to `ended` applies its own policy immediately, without borrowing past-due grace. Evaluation uses the request's deterministic time; an application does not need an entitlement callback for this behavior.

Snapshot the grace deadline on entry so a defaults release, tier change, or duplicate event does not silently extend the current episode. An authorized, explicit deadline adjustment must be audited. Persist the episode/deadline for mutable services; fixed-file reconciliation must not restart it on every boot. Period expiry alone still keeps terms applying and raises a warning—it does not automatically begin a past-due episode.

## 5. Self-hosted installs

- **One file per install:** `entitlements.yaml` holds **contracts only**. It never holds definitions or defaults.
- **At startup, the file is reconciled into the database.** Contracts are created, updated or removed, and marked `source: file`. The resolver has a single path, the same as in SaaS. The API refuses every entitlement write, and the admin shows values read-only.
- **An expired contract keeps applying and is flagged.** Expiry alone never silently falls back to the variant defaults or automatically sets `ended`. An explicit status change applies the configured policy in section 4. This distinction applies to SaaS as well. Renewal is a commercial step.
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

## 8. Simple application-owned behavior

- **Per-container caps are plain integers.** The application counts and compares each container against the resolved value. Do not add container subjects now; revisit only when a contract needs a specific container exception.
- **“N per seat per year” is a plain integer.** The application multiplies by covered seats and manages the yearly usage reset. The provider neither counts usage nor invents a reset period or per-seat allowance type.
- **One direction only.** The application reads entitlements. The entitlement layer never calls back into the application for counts, preview data, resource enumeration, or authorization. Anything needing both application state and entitlements, including a downgrade preview, is composed by the client/application. Payment adapters and administrative commands can still explicitly write contracts.
- **Vendor-side access to Organization data is outside this entitlement spec.** Hosted-service authorization and audit requirements remain separate; out of scope does not mean unrestricted access.

These are decisions for the initial implementation, not open requests for more types, subject hierarchies, or callback APIs.

## 9. Mapping to OpenEntitlement v0.1

| v0.1 (current spec and SDKs) | Proposed behavior |
|---|---|
| Plan, with `variantOf` for trials | Tier variant (`tier`, `trial`), with catalog-default inheritance and explicit variant values |
| Plan values edited through the admin API and console | Workspace-authorized catalog/tier authoring in SaaS; read-only at runtime for fixed installations |
| Partial plan values, falling back to the catalog default | Every effective variant values every privilege after inheritance, validated before publication/startup |
| Assignment (Organization → plan) | The contract's `tier_variant` |
| Overrides (plan-family bound, stale when the family changes; Organization, subject or resource scope) | Contract terms, Organization scope only. Subject and resource overrides are removed in V1. |
| Grants (additive, optional subject) | Unchanged |
| Reasons `PLAN`, `OVERRIDE`, `GRANT`, `FIXED`, `DEFAULT`, `ERROR` | Proposed: `VARIANT`, `CONTRACT`, `GRANT`, `NOT_INSTALLED`, `ERROR` |
| `requiredPlan` | `requiredTier`, lowest non-trial tier whose defaults satisfy the need |
| `FixedProvider` for self-hosted installs | `entitlements.yaml` reconciled into storage, writes refused |
| Intervals `[startsAt, expiresAt)` | Contract period, both ends inclusive |
| `UNLIMITED` encoded on the wire as `{"unlimited": true}` | Unchanged on the wire. `unlimited` is the YAML spelling only. |
| Service contract records with PDF evidence (console) | The same records become the proposed entitlement contracts. PDFs stay service-only, outside OEREP. |

This is a breaking change. Releasing it requires a new pre-1.0 spec version, a new OEREP major version for the reason and `requiredTier` changes, conformance scenarios rewritten for the three layers, and migration notes. The brief's revision 0.3 does not assign those release numbers. SDK and service versions stay independent. No runtime or released normative specification changes in this PR.

## 10. Workspace control plane and hosted service (issue #15)

**Workspace** is the business-facing control plane: one business manages its catalog of features/actions, tiers and variants, and customer Organizations within a Workspace. An Account can access several Workspaces and switch between them. Each Workspace owns independent definitions, defaults, assignments, contracts, grants, and audit records; changing one Workspace must not change another. In SaaS, Tenant remains the technical isolation term for this boundary, not the UI name for an Organization. No additional business container is needed for the initial model.

The application flow is:

1. Create or select a Workspace.
2. **Define features/actions** on a dedicated catalog page: key, type/constraints, default, and description. Groups can nest and have descriptions. Keys are flat and globally unique within the Workspace, for example `max_exports`; group membership is separate metadata and does not create dotted evaluation paths.
3. **Create tiers and variants.** Each privilege inherits its catalog default unless the tier variant explicitly replaces it. The UI distinguishes inherited defaults from explicit values. Resolve and validate a complete effective variant before assignment.
4. **Assign a tier variant to an Organization**, then apply negotiated Organization-level contract terms where needed. Preserve the source and effective value in the read model.

The latest catalog-first UI requirement replaces the release-file-only restriction in earlier revisions. Workspace-authorized administrators need the catalog/tier authoring workflow. Definitions and values must use the same validation as the server and SDK contract. A reviewed export/release remains a possible deployment workflow, not a second competing source of truth. Fixed installations remain read-only at runtime. Existing dotted keys require an explicit migration preserving assignments and negotiated values; do not merely strip dots in the UI or rewrite identifiers without migrating references.

### Platform administration

The designated SaaS operator Account has a **Platform administrator** role, with master control over all Workspaces. This is separate from an individual Workspace's Owner/Manager/User roles. It includes listing, creating, inspecting, and managing Workspaces and their membership, catalogs, tiers, and Organizations. Workspace-scoped Owners cannot grant themselves platform administration or access another Workspace by changing a URL or identifier.

Grant the role to the operator's verified sign-in identity through explicit bootstrap/provisioning. Do not put a personal email address in public examples or use a client-supplied email string as authorization. Persist and enforce the role server-side; global administrative actions must record the actor, target Workspace, action, and reason. This adds a hosted control-plane requirement without turning global administration into an OEREP entitlement privilege or exposing it to ordinary evaluation API keys.

Issue #15 must distinguish platform role checks from Workspace-scoped membership/permissions. Precise action names for catalog/tier administration, bootstrap mechanics, and isolation tests are required before implementation. The current standalone service has neither SaaS identity nor Workspace isolation; this section specifies future behavior, not existing support.

The YAML Configuration view remains a read-only snapshot until the new model is implemented; do not present its existing export as the new authoring/import API.

## 11. To settle before implementation

These points are not fully answered by sections 1 to 8. Each one needs a decision before code depends on it.

1. **Tier order.** `requiredTier` needs a ranking. The example file uses the order of a `tiers` list, lowest first.
2. **Trial length.** The proposal: a trial is a contract on a trial variant, and the contract's period sets its length.
3. **Lifecycle transitions.** The Tenant chooses `readOnly` or a named fallback variant for `past_due` and `ended` (section 4). Expiry alone retains terms and raises a warning. Past-due grace uses the per-tier setting above. Still define renewal/trial-completion transitions, existing grant applicability, and the versioned result carrying lifecycle restrictions. Test policy validation, zero grace, UTC deadline boundaries, duplicate events, process restarts, active restoration, explicit termination, and application write refusal.
4. **Organizations without a contract.** Either a configured fallback variant, or the safe error value.
5. **Constraint-valid `NOT_INSTALLED`.** An integer with `minimum: 1` cannot return `0` through ordinary value validation, and an enum has no universal off value. Choose separate availability state or explicitly declared, validated off semantics before implementation; test bounded integers and enum values without weakening ordinary SDK validation.
6. **Inclusive periods.** If periods are dates, "inclusive" needs a time zone. If they are timestamps, it needs a precision.
7. **Error fallback.** Today a privilege's catalog `default` is what a transport error fails closed to. V0.2 still needs such a value, separate from variant defaults.
8. **A catalog endpoint.** Should OEREP add an optional `GET /oerep/v1/catalog` that returns the JSON Schema, for clients that don't hold the definitions in code?
