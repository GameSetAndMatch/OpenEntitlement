# OpenEntitlement Specification

**Version:** 0.1.0 (draft) · **Status:** experimental · **License:** Apache-2.0

OpenEntitlement defines a vendor-neutral API for answering one question:

> **May this organization do X, and how much of it?**

It plays the role for entitlements that [OpenFeature](https://openfeature.dev/specification/) plays for feature flags. It has one evaluation API, swappable *providers* (in-memory, Postgres, Stripe, or any other billing or entitlement vendor), *hooks* for audit and telemetry, and an *evaluation context*. Application code is written once against the API. Changing vendors means swapping the provider, without rewriting every gate.

## Sections

| # | Section | Covers |
|---|---|---|
| 1 | [Data model](sections/01-data-model.md) | features, privileges, `UNLIMITED`, plans, assignments, overrides, grants, usage |
| 2 | [Evaluation context](sections/02-evaluation-context.md) | `organizationId`, `subjectId`, `resourceId`, `now` |
| 3 | [Resolution](sections/03-resolution.md) | the normative algorithm, limit checks, shared pools, `requiredPlan` |
| 4 | [Evaluation API](sections/04-evaluation-api.md) | `isEnabled`, `getLimit`, `requireWithin`, resolution details, reasons |
| 5 | [Concurrency](sections/05-concurrency.md) | `guard` and serializing check-then-act |
| 6 | [Providers](sections/06-providers.md) | the provider interface, capabilities, mutations, the fixed provider |
| 7 | [Hooks and audit](sections/07-hooks-and-audit.md) | evaluation hooks, mutation hooks, the audit event |
| 8 | [Errors](sections/08-errors.md) | error shapes, HTTP mapping, upsell-friendly UIs |
| 9 | [Layering and interoperability](sections/09-interoperability.md) | AuthN / RBAC / entitlement / flag separation, OpenFeature |
| - | [Glossary](glossary.md) | terms |
| - | [Conformance suite](assets/gherkin/README.md) | Gherkin features any provider can run |

## Scope: the entitlement layer only

| Layer | Question | Failure | In this spec? |
|---|---|---|---|
| Authentication | who are you? | 401 | no |
| Role / RBAC | may this **person** do X? | 403 | no |
| **Entitlement** | may this **organization** do X, and how much? | 403 `entitlement_required` + `requiredPlan` | **yes** |
| Feature flag | is the code released? | 404 | no (use OpenFeature) |

These layers are orthogonal. An implementation of this spec MUST NOT read roles, evaluate feature flags, or authenticate (see [§9](sections/09-interoperability.md)).

Out of scope for v0.1: metering and usage aggregation ([§1.7](sections/01-data-model.md#17-usage)), pricing, invoicing, payment, and a remote wire protocol (see [Roadmap](#roadmap)).

## Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and **OPTIONAL** in this specification are to be interpreted as described in [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals.

Requirements are numbered `section.subsection.n` (for example `Requirement 3.1.5`), following OpenFeature's convention. A **Conditional Requirement** applies only when its condition holds. Gherkin scenarios in the [conformance suite](assets/gherkin/) are tagged `@spec-x.y.z` with the requirements they test.

An implementation is **conformant** when:

1. its SDK passes every conformance scenario that has no capability tag, and
2. its provider passes every scenario tagged with a capability the provider declares ([Requirement 6.1.3](sections/06-providers.md#requirement-613)).

Requirements that cannot be verified mechanically are marked *(not mechanically testable)*.

## Terminology across languages

The spec uses camelCase (`requireWithin`, `organizationId`). SDKs SHOULD follow the conventions of their language (`require_within`, `organization_id` in Python). Where the spec says an operation "throws", a language without exceptions MUST use its idiomatic error channel instead.

## Versioning

The spec follows [SemVer](https://semver.org). Until 1.0.0, minor versions MAY break compatibility. Each SDK MUST declare the spec version it implements.

## Roadmap

- **0.2:** an OpenEntitlement Remote Evaluation Protocol (OEREP), an HTTP/JSON wire format modeled on [OFREP](https://github.com/open-feature/protocol). A server (Lago, OpenMeter, Flexprice, Kill Bill, an in-house service) implements it once instead of shipping a provider per language. This is how Flipt reached every OpenFeature SDK.
- **0.2:** add-ons as first-class objects (in 0.1 they are modeled as grants or overrides, see [PRIOR_ART.md](../PRIOR_ART.md)).
- **0.3:** events (`ENTITLEMENTS_CHANGED`), mirroring OpenFeature's provider events, so caches and UIs can refresh.
