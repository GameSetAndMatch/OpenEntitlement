# OpenEntitlement glossary

Shared language for the service, SDKs, specification, and contributor reviews.

## Entitlement model

| Term | Definition |
|---|---|
| **Organization** | The entitled party: the customer account, tenant, or workspace that has a plan. Identified by `organizationId`. |
| **Subject** | An optional actor within an organization (a user or service account). Identified by `subjectId`. |
| **Resource** | An optional object within an organization (a project or workspace) that can carry its own overrides. Identified by `resourceId`. |
| **Feature** | A named product capability, declared in code, made of one or more privileges. |
| **Privilege** | One typed dimension of a feature (`seats.max`, `sso.enabled`), declared in code. |
| **Gate** | The privilege that decides `isEnabled(feature)`. |
| **Catalog** | The set of features and privileges an application declares. |
| **Plan** | A named set of privilege values. Values are data, not code. |
| **Variant** | A plan with `variantOf` set (a trial, for example). It shares the base plan's family. |
| **Family** | `variantOf ?? id`. Overrides bind to families. |
| **Assignment** | The link between an organization and its current plan, plus an opaque payment `channel`. |
| **Override** | A per-scope value that *replaces* the plan value, bound to a plan family, dated, with a mandatory reason. |
| **Stale override** | An override whose family no longer matches the organization's plan. It is inert, but kept. |
| **Grant** | An additive amount of an integer privilege for a scope, dated, independent of the plan. |
| **Pool** | The organization-wide quota: the base value plus organization-scoped grants. |
| **Subject allowance** | The sum of grants scoped to one subject. Only that subject draws from it, before the pool. |
| **UNLIMITED** | A distinct value meaning "no limit". It is not an integer and not null. |
| **Resolution details** | The full answer to an evaluation: value, reason, plan value, override, grants, stale overrides, and error. |
| **Provider** | The adapter that resolves values from a source of truth. |
| **Fixed provider** | A provider for installs with no commercial terms (self-hosted): everything on, nothing overridable. |
| **Lock** | Serializes `guard` calls per `(organizationId, privilege)`. |
| **Hook** | Code that runs at the `before`, `after`, `error`, and `finally` stages of an evaluation or a mutation. |

## Protocol and service

| Term | Definition |
|---|---|
| **OEREP** | OpenEntitlement Remote Evaluation Protocol: the HTTP/JSON contract between generic SDK providers and entitlement servers. See [§10](spec/sections/10-remote-evaluation.md). |
| **Remote provider** | The SDK implementation that sends evaluation requests over OEREP and validates the returned details before using them. |
| **Data plane** | The `/oerep/v1/` evaluation endpoints. Reads entitlement decisions; does not mutate plans or consume application quota. |
| **Administrative API** | The separate `/api/` endpoints for inspection and audited changes to plans, assignments, overrides, and grants. |
| **Inspection** | Optional read-only listing of plans, assignments, overrides, grants, and audit events. Listing must not let a caller mutate stored facts. |
| **Usage** | Consumption measured by the application. An integer for a single pool, or a breakdown with required `pool` usage and optional `subject` allowance usage. |
| **Guard** | A locked resolve → count → check → act operation over application usage. The lock belongs to the application, not the remote server. |
| **Fail closed** | On evaluation failure, use the privilege's declared default, clear applied grants, and suppress upgrade suggestions. A default may itself permit access; choose defaults deliberately. |
| **Audit event** | A record of a successful mutation with actor, reason, entity, action, before/after state, and time. |

## Design and review vocabulary

| Term | Definition |
|---|---|
| **ADR** | Architecture Decision Record: records an architectural choice, its context, and consequences. [ADR-0001](ADR-0001.md) establishes the protocol-plus-own-server direction. Bug fixes that preserve that decision do not each require a new ADR. |
| **RFC** | Request for Comments: a proposal used to discuss a contract or design before adopting it. This repo's existing spec cites RFC 2119 and RFC 8174 for normative language; those citations are not new feature proposals. |
| **Normative requirement** | A numbered rule in the specification. `MUST` is required, `SHOULD` permits a justified exception, and `MAY` is optional. |
| **Standards review** | Checks the implementation against documented engineering constraints and design heuristics. A possible code smell is a judgement call, not automatically a defect. |
| **Spec review** | Independently checks behavior against the originating specification: missing behavior, incorrect behavior, and unrequested scope. |
| **Grilling / grill-me** | A structured interview that resolves uncertainty in an idea or design. Use it when a decision is missing, not to invent answers already stated in the specification. |
| **Grill-with-docs** | An interview that also retains agreed domain language and architectural decisions in glossary entries and ADRs. |
| **TDD** | Test-driven development: demonstrate a failure, make the smallest behavior fix, and verify it passes before continuing. |
| **Red / green** | A regression test fails against the old behavior (red), then passes with the fix (green). A test that never failed does not demonstrate the original defect. |
| **Test seam** | The public boundary where behavior is observed: for example the SDK API or the service's HTTP endpoints. |
| **Two-way door** | A change that is practical to roll back. A one-way door involves a hard-to-reverse consequence, such as destructive data migration. |
| **Blast radius** | The consumers and behaviors a change could affect, even when its diff is small. |
