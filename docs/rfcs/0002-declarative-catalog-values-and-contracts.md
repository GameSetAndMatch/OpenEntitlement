# RFC-0002: Declarative catalogs, installation values, and contract terms

- **Status:** proposed; neither implemented nor normative
- **Date:** 2026-11-09
- **Related:** RFC-0001 in [PR #17](https://github.com/GameSetAndMatch/OpenEntitlement/pull/17), [current specification](../../spec/README.md)
- **Scope:** concepts and a candidate YAML authoring format; no OEREP, SDK, or service API changes in this PR

## Purpose

Define a small typed model for a product's entitlements, validate it, and serialize it to JSON. OpenAPI is an analogy, not a dependency or a required document structure. YAML is an optional authoring convenience over the same data model. Keep application-owned definitions separate from installation/customer values without building a new schema framework.

This proposal extends RFC-0001 with a declarative format and a distinct contract-terms resolution layer. It does not supersede the current specification or automatically accept unresolved decisions in either RFC. The sample `openentitlement: "0.1.0"` identifies a **candidate document dialect**, not support by the currently released 0.1 specification or any package. This PR does not change release versions.

## Concepts

| Concept | Meaning |
|---|---|
| Tier | A reusable commercial level, for example Business or Enterprise. Independent of payment and deployment. |
| Trial | Time-limited access through a tier variant, never a separate tier. |
| Tier variant | A tier's trial or non-trial offer, containing a complete explicit value set. Each assigned Organization has one effective variant. |
| Organization | The logical boundary grouping members, teams, and an assigned tier variant. It is the organization-level entitlement subject. |
| Tenant | The SaaS infrastructure isolation boundary for customers sharing resources. It is not the name of an entitlement subject in these documents. |
| Payment | Who collects money and how. It does not determine privilege values. |
| Deployment | Where/how the software runs, such as SaaS or self-hosted. Never a tier. |
| Contract | The proposed record of the variant and terms agreed for an Organization, with a period, status, and provenance. It is distinct from an uploaded PDF and from a payment provider's subscription object. |
| Privilege | A typed access switch, count cap, allowance, or restricted option declared by application code. |
| Override | An audited replacement value at an Organization/member/resource scope with an optional time window, bound to an exact tier variant. |
| Grant | An audited positive addition to an allowance. Grants accumulate subject to scope, expiry, and revocation. |

The incoming proposal uses `tenant` for the customer workspace. This RFC uses **Organization**, `organization`, and `organizationId` for that concept to follow the project's latest terminology. A hosted service separately scopes storage and authorization by its SaaS Tenant. The documents do not prescribe a one-to-one Tenant/Organization mapping.

### Definitions, offers, and values

The application vendor declares features and typed privileges because application code enforces them. A catalog is versioned with that code and is never edited per customer. An Organization-specific exception belongs in contract terms, runtime overrides, or grants.

The catalog includes reusable default offers under `tierVariants`. Although defaults are authored beside definitions here, their effective values remain data: the values document can specialize them without rebuilding application code. A mutable provider can manage audited values independently. Decide separately how this publishing process fits backend-owned variant records and migrations; Organization administrators must not gain definition-editing rights by uploading a values document.

Every published variant explicitly values every privilege. Missing values fail validation; they do not become unlimited, disabled, or an arbitrary fallback. The candidate format is intentionally stricter than today's partial-plan default fallback. Runtime provider-error handling remains a separate fail-closed contract to specify before implementation.

A capability available in every tier normally needs a cap rather than an always-on commercial switch. Keys describe behavior independently of tier and price: `max_members_per_project`, `recording_minutes`, `retention_days`, `export_enabled`. This is a recommendation for new keys, not automatic renaming of existing dotted SDK keys.

## Contract model and payment boundary

A Contract has five conceptual fields; Organization identity is the enclosing `contracts` map key:

| Field | Proposed content |
|---|---|
| `tierVariant` | The catalog variant code sold/assigned. |
| `terms` | Typed privilege values agreed for that Organization, such as a seat cap or allowance. Partial; unspecified terms inherit defaults. |
| `period` | Start and end or a separately specified renewal policy. The first example uses only a fixed interval. |
| `status` | `active`, `past_due`, or `ended`. |
| `source` | Exactly one of `{provider, ref}` or `{sales: reference}`. These are provenance references, not credentials or executable adapter configuration. |

Payment adapters start checkout and translate verified, idempotently processed events into explicit contract commands. Core evaluation does not query Stripe or infer a tier from an invoice or payment channel. Any tier may use either payment route. The contract is the proposed integration boundary for payment-triggered entitlement updates, not a requirement that every embedded provider implement checkout or billing.

`self_serve_purchase_enabled` is itself an entitlement. Its effective value is explicitly configured; a `sales` source or invoice payment does not silently disable it. A billing adapter must not override that principle by deriving arbitrary values from payment metadata.

**Decision still required:** how contract status/period affects effective access. A `past_due` status does not, by itself, authorize revoking access or deleting data. Grace periods, an ended contract's fallback assignment, overlapping/renewal intervals, no-contract Organizations, and trial completion must be specified before activating contracts in resolution. The examples describe only an active contract evaluated inside its interval.

## Two documents

### Catalog: `entitlements.yaml`

Written or generated by the vendor, versioned with the application. See the [complete example](examples/entitlements.yaml).

| Key | Meaning |
|---|---|
| `openentitlement` | Exact candidate document dialect version. Not a product release version. |
| `info.title` | Product/catalog title. |
| `info.version` | Positive integer compatibility revision for this catalog. Bump when formerly valid values documents become invalid; independent of product/package SemVer. |
| `features` | Feature definitions with globally unique privilege keys. |
| `tiers` | Tier codes and display names. Ranking for upgrade selection still needs a defined field/order. |
| `tierVariants` | Variant codes referencing a tier, trial state, and complete default `values`. |

A trial is `false` or `{durationDays: positive integer}` in this draft. There is no `true` shorthand with an unspecified duration. Duration is a default offer property, not proof of a particular Organization's start date. A future assignment/contract model must record the anchor and define trial-expiry calculations.

Keep the initial types to ordinary JSON primitives; objects and arrays only structure the document. No custom schema vocabulary or user-defined type system.

Privilege types:

- `boolean`: YAML/JSON boolean values only.
- `integer`: safe non-negative integers, optionally constrained by integer `minimum`/`maximum`; `minimum` defaults to zero.
- `number`: finite numeric values for quantities that need fractions, with optional `minimum`/`maximum`. JSON calls this `number`, not `float`. Reject NaN and infinities. Counts and seats remain `integer`; do not introduce fractional grant/usage arithmetic by implication.
- Explicit string `unlimited`: valid only for integer privileges with `unlimited: true`. Never inferred from an omitted value or a large sentinel number.
- `string`: text, with optional `minLength`/`maxLength`.
- An optional non-empty, duplicate-free `enum` constrains a string to listed choices (for example `[basic, advanced]`). Enum is a constraint, not a separate primitive or an extensible type mechanism. Keep enum choices to strings initially. Do not infer commercial ordering from their spelling; upgrade ordering remains a separate decision.

Boolean values never count as integers or numbers. Numeric values are non-negative unless a declared bound explicitly permits negatives for a non-count quantity. `unlimited` is reserved as the integer sentinel in this dialect. It is not a proposed change to OEREP's existing JSON encoding. `subjects` describes permitted scopes from `organization`, `member`, and `resource`; this is not permission or seat coverage. An omitted `subjects` means `[organization]` for this draft. Composition with existing SDK `subjectId`/`resourceId` needs an explicit mapping before release.

### Values: `entitlements.values.yaml`

Values only, written for an installation or imported into an authenticated account's scope. See the [matching example](examples/entitlements.values.yaml).

| Key | Meaning |
|---|---|
| `openentitlement` | Must equal the catalog's supported dialect version. |
| `catalogVersion` | Must equal the catalog's `info.version`. |
| `tierVariants` | Optional partial value maps overriding some installation defaults; no new variants or definitions. |
| `contracts` | Proposed map keyed by Organization ID, containing at most one current Contract per Organization. |

A values document cannot create features, privilege keys, tiers, variants, or type definitions. Unknown keys, duplicate YAML keys, wrong scalar types, missing required fields, disallowed unlimited values, and version mismatches fail validation before startup/import. Quoted `"true"` is not a boolean, and `null` is not a persisted entitlement value.

Use YAML 1.2 with JSON-compatible scalars, no executable/custom tags, and bounded parsing. A loader must not construct dates or objects implicitly. Reject duplicate mapping keys rather than silently keeping the last one. Alias expansion limits and external-reference policy need definition before accepting untrusted documents.

For fixed providers, the complete effective configuration is validated before activation. Mutable services validate imports before publishing changes; an invalid import must not partially replace working configuration. Startup validation is not a requirement to restart a mutable provider for every audited value change.

### Keep the implementation simple: typed models first

The first implementation needs only typed models, constraints, validation, and ordinary JSON serialization. Do not require a schema registry, reusable components, authored `$ref`/`$defs`, code generation, or an OpenAPI document.

In Python, use Pydantic-style model operations rather than inventing serialization methods. The intended workflow is illustrated below; `CatalogDocument` represents a future model, not an implemented API:

```python
catalog = CatalogDocument.model_validate(data)
json_text = catalog.model_dump_json(by_alias=True)
restored = CatalogDocument.model_validate_json(json_text)
```

Declare types and constraints once on those models: strict booleans/integers, finite numbers, strings and enum choices, bounds, required fields, and rejection of unknown fields. Keep public names camelCase through consistent aliases. Validate cross-field rules such as period ordering, known variant references, and complete privilege values in ordinary model validation. Python booleans must not accidentally pass as integer allowances; string values must not silently coerce to numbers or booleans. Explicit unlimited stays distinct from a number.

JSON is the canonical serialized data representation, not a requirement for byte-identical JSON or cryptographic canonicalization. Serialization and re-validation must preserve meaning. Preserve the distinction between an omitted field, a defaulted value, and an explicit command `null`. A typed read model and a partial update command need not be the same model. TypeScript or other implementations can use equivalent runtime validators; a static type alone does not validate input.

If YAML is supported, safely parse it into ordinary data and pass that data through the same validator. Do not maintain separate YAML semantics or a second validation implementation. The two examples describe separate responsibilities, not a requirement to ship a file-format framework.

**Optional later:** generate JSON Schema with the model library's normal schema method if an editor, HTTP documentation, or structured-output consumer needs it. Generated internal references are a library detail; users should not have to author or manage them. Add tooling only for an actual consumer, and check that its supported schema subset is compatible. No schema generator or editor integration is required for the first implementation.

The Structured Outputs analogy is schema-constrained data rather than free-form JSON. OpenAI's API supports a subset of JSON Schema with additional restrictions, so compatibility is a separate optional adapter concern, not the definition of the OpenEntitlement model. AI-generated drafts would still require domain validation and authorization before any write. There is no OpenAI or AI-generation dependency in this proposal.

References for the existing library concepts: [Pydantic serialization](https://pydantic.dev/docs/validation/latest/concepts/serialization/), [Pydantic models](https://pydantic.dev/docs/validation/latest/concepts/models/), and [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas).

## Proposed resolution

For an Organization, declared optional member/resource, privilege, and explicit evaluation time:

1. Begin with the assigned variant's complete catalog default.
2. Apply any installation default specialization for that variant.
3. Apply applicable contract terms for that Organization.
4. Select a matching live runtime override bound to the Organization's exact current variant. Use deterministic most-specific-subject precedence; retain and expose stale/shadowed overrides.
5. Add matching active grants only for allowance privileges. Unlimited remains unlimited; another member's grant must not leak into this subject's result.
6. Compose installed capability constraints so an installation can remove availability, never grant commercial access it does not have.

The read model must distinguish catalog/default specialization, contract term, runtime override, and grants so operators can explain the result. A runtime override must not erase contract provenance. Changing a contract's variant makes old exact-variant runtime overrides stale; automatic rebinding is forbidden.

Step 6 remains a design decision, as in RFC-0001: `not_installed` is not a current OEREP reason, enums have no universal off value, and availability differs from commercial entitlement. Either compose availability in the application or define a separately versioned result preserving the commercial value. Do not silently return `0` for an enum or advertise an upgrade for an absent component.

## Audited writes

| Operation | Proposed semantics |
|---|---|
| Override | Replace a value for an explicit scope/interval and exact variant; require actor/reason and preserve before/after audit history. |
| Grant | Add a positive allowance with explicit scope/window; revocation retains history. |
| Contract terms | Validate all terms, then atomically apply the batch under a shared contract reference/reason. Omitted keys are untouched. `null` in a **command** removes that contract-layer term, exposing its inherited default; it does not delete independent runtime overrides or grant records. |

The earlier proposal describes contract terms as a batch of ordinary overrides. This combined proposal places them below runtime overrides. Those semantics require either a distinct stored layer or explicit origin/precedence metadata: applying terms must not overwrite a support override with the same scope/key. This RFC does not pretend the existing override upsert API already provides the separation or atomicity.

A fixed provider refuses all entitlement writes with its explicit unsupported-write error; changing validated files changes its configuration. Self-hosted does not necessarily mean fixed: mutable Postgres installations remain supported. In SaaS, record actual acting identity and Organization plus separate Tenant scope, rather than trusting an uploaded actor field.

## Safe application behavior and refusal

Entitlement changes never delete application data. Caps gate new creations; switches gate applicable entry points. After downgrade an over-cap container can remain readable while its writes are refused. The application compares actual counts with the cap and retains all role/resource authorization checks. A later eligible upgrade restores permitted writes without recreating data.

Proposed application-level refusal:

```json
{"code":"entitlement_required","feature":"projects","privilege":"max_members_per_project","requiredTier":"enterprise"}
```

Use HTTP 403 for entitlement denial and keep authentication, role refusal, release controls, and unavailable components distinguishable. Show locked access and an upgrade path where disclosure is appropriate. This is application UX guidance, not authorization to expose hidden resources.

`requiredTier` should identify the lowest eligible tier whose non-trial defaults actually satisfy the requested value/count. Catalog ranking and the effect of installation specializations must be defined. Omit a suggestion when no tier satisfies the request; don't imply that purchasing the highest tier guarantees negotiated access. The current protocol uses `requiredPlan`; migrating to `requiredTier` requires versioning and SDK conformance changes.

## Boundaries

| Mechanism | Question | Owner | Lifetime |
|---|---|---|---|
| Role/Permission | May this person perform this action in this Organization? | Authorized Organization administrators | Until membership/permission changes |
| Feature flag | Is this release/operational behavior enabled? | Developers/operators | Often temporary for release flags; not universally temporary |
| Deployment policy | Is a component installed, who may sign up, where does support go? | Installation operator | Per installation/configuration |
| Entitlement | What may this Organization use, and how much? | Authorized commercial/operations administration or validated fixed configuration | Explicitly scoped, time-bound where applicable, audited |

Application access composes these controls; none substitutes for another. Usage counting, seat assignment, payments, invoices, discounts, and renewal collection remain outside core evaluation. Payment adapters may explicitly update Contracts without making a payment processor part of every provider.

## Open questions and acceptance gates

1. Are per-container caps declared resource subjects, or quantities the application compares against each container? How do team/member/resource scopes compose?
2. Does a renewable allowance such as “N per seat per year” need a distinct type, or application-maintained grants? Define reset boundary, time zone, idempotency, and seat coverage separately.
3. No custom vocabularies, authored `$ref`, or reusable-component system in the first implementation. Revisit only when a concrete use case cannot be handled by normal typed models.
4. Who may read/write Organization data from vendor/global administration? Define least privilege, cross-Tenant boundaries, elevation, and audit before shipping global administration.
5. What happens for no Contract, `past_due`, ended/expired Contract, renewal, or competing updates? How are trial start/end and duration overrides represented?
6. Does the shared specification standardize the Contract, or only contract terms while source/status/period stay in service administration? This is a broader proposal than the previously service-only contract metadata model. **PDF bytes, storage, and download mechanisms stay service-only regardless.**
7. What is the deterministic tier ranking and enum ordering, and what should an unavailable component return?
8. How do IDs in mutable storage map to stable document codes without silently changing assignment identity?
9. What cache/version policy bounds propagation of default and contract changes, and how do validated imports roll back atomically?

Before implementation acceptance, require fixtures for both valid and invalid documents: boolean-versus-integer confusion, non-finite numbers, out-of-range values, string lengths, invalid enum choices, completeness, unknown/duplicate keys, exact versions, enum/unlimited/bounds, unknown variants, invalid/overlapping periods, forbidden extra source fields, and cross-Organization import attempts. Also test contract/runtime precedence, null removal, all-or-nothing writes, stale overrides, subject-isolated grants, trial transitions, and no-data-loss downgrades.

Primitive terminology and enum constraints follow ordinary JSON Schema concepts: [numeric types](https://json-schema.org/understanding-json-schema/reference/numeric) and [enum](https://json-schema.org/understanding-json-schema/reference/enum). The [vocabularies proposal repository](https://github.com/json-schema-org/json-schema-vocabularies) and [draft 2019-09 vocabulary mechanism](https://json-schema.org/draft/2019-09/json-schema-core#rfc.section.4.3.3) are background, not dependencies or required extension points.

## Delivery and compatibility

Merge this as a proposal only. Follow-up decisions should select the normative concepts, versioned typed models and validation, JSON serialization, optional YAML loading, fixed-provider loader, mutable import/migrations, and any separately versioned OEREP changes. Do not rename existing SDK fields or claim YAML loading until those implementations and tests exist.
