# RFC-0001: Tiers, trial variants, and explicit entitlement values

- **Status:** proposed; not implemented or normative
- **Date:** 2026-11-09
- **Scope:** shared entitlement semantics and service administration; not pricing or metering
- **Related:** [current specification](../../spec/README.md), [ADR-0001](../../ADR-0001.md), hosted-service terminology in PR #16

## Why

A reusable commercial offer, a trial, a payment arrangement, and a deployment are different things. Conflating them makes customer agreements hard to explain and can accidentally preserve restrictive trial overrides after a purchase. This proposal defines the vocabulary and behavior needed to keep those concerns separate.

This RFC captures a proposed next revision. The existing specification, SDKs, OEREP v1, and service remain unchanged until individual decisions are accepted and implemented. Requirement words below describe the proposed behavior only. No field rename or new JSON encoding is introduced by merging this document.

## Vocabulary

| Term | Meaning |
|---|---|
| Organization | The logical product boundary grouping members, teams, and an assigned tier variant. It is the organization-level entitlement subject, identified by `organizationId`. |
| Tenant | The SaaS isolation boundary for customers sharing infrastructure such as database resources. It is hosting terminology, not a synonym for Organization in the shared entitlement model. The mapping between a SaaS Tenant and Organizations is a service decision, not an evaluation rule. |
| Subject | The entity a privilege is resolved for: an Organization and, optionally, a narrower member or resource declared by that privilege. A subject is not a seat or sign-in Account. |
| Tier | A reusable, ordered level of entitlement, for example Basic, Pro, Enterprise. It does not encode a payment processor, billing interval, or deployment. |
| Trial | Time-limited access to a tier with explicitly defined values. Trial is a state, not another tier or a synonym for a free tier. |
| Tier variant | A tier's trial or non-trial record. This record owns the default entitlement values. |
| Feature | An application capability grouping one or more privileges, named for its behavior rather than its tier. |
| Privilege | A typed access switch, count cap, allowance, or option. Role-based Permissions remain a separate concept. |
| Override | A reasoned replacement of a variant value for an Organization or narrower subject, optionally bounded in time. |
| Grant | A positive additive allowance with its own subject, reason, and optional expiry. It does not replace a value. |
| Contract terms | A proposed atomic administrative batch of entitlement overrides sharing a reference and time window. This is not a billing subscription or PDF document model. |
| Billing arrangement | How an Organization pays: card processor, invoice, contract, or another channel. It does not determine entitlement values. |
| Deployment | How the software is installed, for example SaaS or self-hosted. It is not a tier. |
| Install capability | Whether a required component or connector exists in an installation. This is separate from a customer's commercial entitlement. |
| Feature flag | A release or operational control evaluated independently of commercial entitlement. Temporary release flags should be removed when their purpose ends; not all flags are temporary. |

The existing `Plan` record is the closest implementation concept to **Tier variant**, not just Tier. Replacing every occurrence of Plan with Tier would lose the distinction between trial and non-trial values. The public vocabulary and any eventual code/wire migration must be reviewed together.

## Principles

1. **Tier and payment are independent.** Every combination can be represented. Billing can explicitly request an assignment transition, but evaluation must not infer a tier from a payment record or processor name.
2. **Trial is a variant state.** Ending a trial selects the same tier's non-trial variant. Changing tier preserves trial state. `endTrial` is idempotent. A missing target variant is an explicit configuration error, not a silent substitution.
3. **Definitions live in application code; values are data.** Catalog definitions describe what the application enforces. Providers own tier variant records and their values. Value changes are audited and can take effect without deploying application code.
4. **Reusable offers get variants; customer exceptions get overrides.** Stable IDs, codes, names, tier identity, and trial state are backend-owned. Routine organization administrators inspect the defaults and manage allowed overrides/grants; they do not create one offer per customer. A separate authorized provider operation manages default records and values.
5. **Published variants are complete and typed.** Every declared privilege has an explicit value before a variant is assigned. Missing data is a configuration error, not implicit unlimited or disabled access. Runtime failure handling remains explicitly defined; completeness is not a reason to fail open.
6. **Names stand alone.** Prefer meaningful flat keys, such as `max_members_per_project`, `recording_minutes`, or `export_enabled`. Keys should not contain tier or marketing names. This is a proposed naming convention, not a retrospective invalidation of existing dotted keys.
7. **Use caps for quantity differences.** If every tier has a capability, represent the difference in quantity rather than an always-on commercial switch. A switch remains useful when access itself differs.
8. **Entitlement changes preserve stored data.** A downgrade, expiry, or trial ending must not delete application data. Applications decide what remains readable and which new actions are blocked. The entitlement provider cannot authorize access to underlying data.
9. **Explain restrictions.** Show an upgrade or contact path where appropriate, while respecting authorization and disclosure policies. A provider does not mandate hiding or exposing particular UI elements.

## Proposed data model

Names here describe concepts, not a new OEREP schema. SaaS storage may additionally scope every record by its infrastructure Tenant; that scope must not replace `organizationId`.

```text
Feature           { code, name, description, privileges[] }
Privilege         { key, feature, valueType, options?, unlimitedAllowed,
                    subjectScopes[], default }
Tier              { id, code, name, rank }
TierVariant       { id, code, name, tierId, isTrial }
TierVariantValue  { tierVariantId, privilege, value }
Assignment        { organizationId, tierVariantId, trialStartedAt? }
Override          { id, organizationId, subjectId?, resourceId?, privilege,
                    value, setOnTierVariantId, startsAt?, expiresAt?, actor, reason }
Grant             { id, organizationId, subjectId?, resourceId?, privilege,
                    amount > 0, startsAt?, expiresAt?, revokedAt?, actor, reason }
AuditEvent        { id, organizationId?, action, target, before, after,
                    actor, reason, at, batchReference? }
```

- IDs are stable provider-owned identifiers. Codes are stable handles for seeds, migrations, and administrative tooling. Whether UUIDs are mandatory across providers remains open; existing IDs are not rewritten by this RFC.
- Proposed uniqueness: tier codes, variant codes, and `(tierId, isTrial)` within one entitlement model. A tier with no supported trial need not manufacture a trial variant.
- Values remain boolean, non-negative integer, explicitly unlimited where allowed, or an enum option from the declared list. Unlimited is distinct from a large number. The attachment's tagged value examples are conceptual; the current wire encoding remains unchanged.
- Keep a catalog-level safe default for unassigned/error paths until their semantics are decided. A complete assigned variant and a safe failure default solve different problems.
- An allowance is semantically different from a maximum count even if both currently use integer values. Which privileges accept grants must be explicit before enforcing allowance-only grants.
- `trialEndsAt = trialStartedAt + resolved(trial_duration_days)` is a proposed derived service value when that duration privilege exists. Time-zone, day arithmetic, and evaluation-time rules need explicit definition. Duration overrides must affect the derived date.

## Resolution proposal

For a privilege and an Organization, optional narrower subject/resource, and explicit evaluation time:

1. Validate context and declared subject scopes. Take `now` from the context; a provider must not independently substitute wall-clock time during the same evaluation.
2. Read the assigned tier variant's explicit value. Reject incomplete configuration at publication/assignment time. Define runtime handling for already-invalid persisted data before rollout.
3. Select matching, time-active overrides bound to the **exact current variant ID**. The most specific matching scope wins. Preserve the existing deterministic subject/resource precedence unless a replacement is specified.
4. Add matching active grants only for privileges declared to be allowances. Revoked or expired grants contribute nothing. Unlimited remains unlimited; grants neither turn it into a number nor disappear from history.
5. Return explainable details: effective value, variant value, applied override and grants, shadowed overrides, stale overrides, and decision reason.

Intervals remain half-open, `[startsAt, expiresAt)`, with omitted bounds open-ended. A variant mismatch makes an override stale: retained and visible, but inert. Returning to that exact variant can reactivate an otherwise live override; this needs an explicit conformance scenario.

**Breaking change:** current overrides bind to a plan family and survive trial-to-paid conversion. This proposal binds to an exact variant, so trial overrides become stale after trial completion. An administrator must intentionally reapply negotiated terms that should continue on paid access.

Grants are not automatically made stale by variant changes. Their own scope, time window, revocation, and any future allowance compatibility rules determine applicability. Subject allowances and organization pools must retain explicit draw order; ordinary addition must not accidentally expose one member's grant to another.

### Install capabilities: placement needs a decision

The supplied proposal suggests applying an install capability last, returning `false` or `0` with reason `not_installed`. That is **not accepted protocol behavior** here. Enum privileges have no universal off value, and the current evaluation reasons do not include `not_installed`.

Two candidate designs need review:

- Compose a separate capability check in the application: `authorized && released && installed && entitled`. Commercial evaluation continues to report the agreed entitlement even if a component is absent.
- Add a separately versioned availability result that preserves the commercial value and describes unavailability without inventing an enum value or conflating it with entitlement denial.

A missing connector must not be presented as a paid upgrade opportunity. No provider should silently return a fabricated value or new reason to a v1 client.

## Administrative writes

| Write | Proposed semantics |
|---|---|
| Set/delete override | Require actor and reason; validate value/scope; record before/after. A request must identify which override or interval it changes. The proposed upsert key `(organization, subject, privilege)` is insufficient for multiple scheduled intervals; retain current overlap rejection until replacement semantics are specified. |
| Add/revoke grant | Add positive allowance; revocation preserves the record/history. Do not treat a cap replacement as a grant. |
| Apply contract terms | Service administrative batch: `{terms: {privilege: value or null}, expiresAt?, reason, reference?}`. Validate every term before committing; one invalid term writes nothing. `null` removes the targeted override, not the catalog privilege or other scopes. Omitted keys are untouched. Audit changes under a common batch/reference. Define the exact variant and scope in the command. |
| Set variant values | Authorized provider operation, separately audited, affecting Organizations assigned to that variant. Validate the complete result before publication. This is not an Organization-level exception. |
| Change tier/end trial | Audited assignment transition. Preserve trial state on a tier change; preserve tier on trial completion. Old exact-variant overrides become stale. Concurrent changes and retries must not resurrect a trial or double-apply effects. |
| Fixed-provider write | Reject with the provider's explicit unsupported-write error. Values come from validated configuration. Self-hosting alone does not imply a fixed provider; self-hosters can use mutable storage. |

Atomic contract terms are an administrative convenience. PDF files, document storage, billing references, and signed downloads remain service features outside OEREP. The earlier request to keep the protocol focused on evaluating entitlements still applies.

Changing global default values must have a bounded propagation policy. “On the next resolution” requires either no stale cache or a defined invalidation/version mechanism; documentation must not promise immediate changes while permitting an unspecified TTL.

## Application behavior and refusal

A maximum gates the next creation; it does not remove existing objects. For a container already above its cap, the application may keep reads available and refuse writes until the count falls within the cap or access changes. That policy belongs to the application and must not bypass RBAC or other access restrictions. Re-enabling the entitlement should restore allowed actions without recreating data.

Proposed application problem shape (not a replacement for current v1 fields):

```json
{
  "code": "entitlement_required",
  "feature": "collaboration",
  "privilege": "max_members_per_project",
  "requiredTier": "enterprise"
}
```

- Authentication failures and role/Permission refusals remain distinct from entitlement refusals.
- Upgrade suggestions should identify the lowest eligible non-trial tier whose explicit defaults satisfy the requested access or amount, using deterministic rank/ID ordering and current candidate eligibility rules until changed explicitly.
- **Do not invent a satisfying tier.** The attachment proposes the highest tier as a fallback when only negotiated access could work. Current behavior omits `requiredPlan` when no candidate satisfies the request. Prefer a separately modeled contact-sales outcome to falsely claiming Enterprise is sufficient; this remains an open decision.
- Uninstalled capabilities and hidden release work need separate explanations. Status codes for flags remain application policy rather than a universal requirement of feature flag systems.

## Boundaries

| Concern | Owner | Relationship to entitlements |
|---|---|---|
| Authentication and member/team permissions | Identity and application authorization | Establish who can act; never inferred from tier. |
| Release and operational flags | Application developers/operators | Separate controls; never used as the tier database. |
| Installed components | Deployment configuration | Describe availability, not the commercial level. |
| Commercial access and limits | Entitlement provider, authorized administration | Typed values, overrides, grants, explanations. |
| Usage counting and seats | Application or metering system | Supply counts/seat coverage; entitlements provide the permitted limits. |
| Prices, invoices, discounts, billing schedules | Billing system | May request explicit assignment transitions; do not define privilege values. |

## Compatibility and migration

| Area | Current behavior | Proposed change / required work |
|---|---|---|
| Plan vocabulary | Plan, family, `variantOf` | Tier and explicit Tier variant. Design aliases and migration before renaming stored IDs, SDK APIs, or OEREP fields. |
| Partial plan values | Missing entries fall back to privilege defaults | Complete published variants. Backfill explicit existing defaults and validate every assignment before enforcing rejection. |
| Override lifecycle | Family-bound; trial conversion preserves overrides | Exact-variant binding. Preview which overrides become stale; never silently rebind them. |
| Keys | Dotted keys are supported | Flat naming recommendation for new catalogs. No automatic key migration. |
| Grants | Existing integer grant/pool semantics | Introduce allowance classification without losing subject isolation or pool draw order. |
| Required offer | `requiredPlan`, absent when no candidate exists | Review `requiredTier`/variant addressing and contact-sales result under a new contract version. |
| Administration | Console currently creates plans and edits values | Separate provider management from Organization exception management; reconcile first-run setup and existing administrative users. |
| Availability | No install-capability reason in OEREP v1 | Choose application composition or a versioned result extension. |
| Contract evidence | Optional service records/PDFs | Keep service-only; an atomic terms command must not introduce document bytes into evaluation. |

Spec, SDK packages, and service continue to use independent version numbers. Compatibility must be declared explicitly; a docs merge must not advertise implementation support. Any wire, schema, or lifecycle change requires migration notes and updated conformance tests before release. No existing version is bumped here.

## Required acceptance scenarios before implementation ships

1. A tier can be assigned independently of payment channel and deployment.
2. Trial completion is idempotent, preserves the tier, and makes exact-trial-variant overrides stale; a tier change preserves trial state.
3. Changing trial duration through a valid override changes the derived end date at a deterministic evaluation time.
4. Missing, invalid, negative, or invalid-unlimited variant values fail configuration validation; transport/provider errors still fail closed.
5. Narrower overrides outrank organization overrides; shadowed and stale records are distinguishable and never deleted by evaluation.
6. Another Organization/member cannot inherit an unrelated grant. Revoked/expired grants do not add quota, and unlimited remains unlimited.
7. A contract batch with one invalid term writes no overrides or partial audit success. Omitted terms and unrelated intervals/scopes remain unchanged.
8. A downgrade preserves application data and read authorization while preventing disallowed new actions. A later valid upgrade restores allowed actions.
9. A fixed provider refuses administrative writes; mutable self-hosted providers continue to support them.
10. No satisfying tier produces no fabricated upgrade recommendation. Installation unavailability is not an upsell.
11. A default-value change satisfies the chosen cache invalidation/staleness bound across instances.
12. Migration preserves effective access where intended and explicitly reports changes caused by exact-variant binding or completeness validation.

These are acceptance criteria, not assertions that the current conformance suite passes the proposed semantics.

## Open decisions and deferred work

- **Quota windows:** distinguish lifetime allowances from calendar/anniversary resets, define time zone, boundaries, and subject scope. Keep usage counting outside OEREP; do not add reset semantics by implication.
- **Consumption idempotency:** if a future usage-claim API exists, define key scope, retention, payload mismatch handling, and atomic retry behavior. The current check-only evaluation is not a consumption claim.
- **Subject scope:** declare Organization/member/resource applicability, determine whether per-container caps need first-class resources, and preserve a path to future organization hierarchies without introducing inheritance now.
- **Bounds:** define minimum/maximum constraints on privilege definitions and override validation; preserve the ability to express an explicit contract floor independently of an upper usage cap.
- **Seats:** keep “this member has coverage” separate from “this Organization may buy at most N seats.” State how the application composes them.
- **Variant completeness:** decide the unassigned-Organization result and invalid persisted-state behavior while retaining safe error defaults.
- **Contract terms:** decide whether a structured reference is sufficient; standardizing a full contract object remains outside the evaluation protocol unless separately justified.
- **Renewal:** decide whether a renewable per-seat allowance needs first-class semantics or is maintained through explicit application/provider operations.
- **Fixed configuration:** choose a versioned file schema for variants, values, and overrides, with validation before startup.
- **Availability and upsell:** settle install capability composition, enum availability, and contact-sales outcomes before adding protocol fields.
- **Variant management:** specify provider/operator authorization separately from routine Organization administration, including a compatible first-run setup path.

## Decision record

This RFC is proposed. Acceptance should identify which sections become normative, which remain application guidance, the target spec/protocol versions, and the migration plan. Existing ADRs are not superseded by this proposal. Each accepted breaking behavior should receive its own decision record and focused implementation PR.
