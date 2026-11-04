# Glossary

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
