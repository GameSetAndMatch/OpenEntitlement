# Lessons from open specification projects

Research reviewed 2026-11-03. These projects are references for engineering practice, not a claim that OpenEntitlement is affiliated with them or implements their formats. Observations below are separated from our proposed adaptations. No source text or visual identity is copied.

## OpenFeature and OFREP

OpenFeature defines a vendor-agnostic SDK API, provider boundary, design principles, and normative requirements. OFREP independently defines communication between generic providers and compatible servers. Their strength is a clear distinction between the developer API and the remote contract.

**Adaptation:** give OpenEntitlement's model/specification an explicit entry point, with OEREP and the reference service explained as separate layers. Document how another implementation can demonstrate equivalent behavior. Do not add global provider switching or event machinery merely because OpenFeature has it.

Sources: [specification and principles](https://github.com/open-feature/spec), [remote protocol](https://github.com/open-feature/protocol).

## Apache Ossie and converters

Ossie's draft core specification defines an explicit, versioned semantic model. Its converters live in a separate repository, with vendor-specific projects and cross-converter interoperability checks. The useful pattern is a shared definition plus independently tested translations; translation limits must remain visible.

**Adaptation:** document a mapping/conformance checklist for prospective entitlement integrations. Require unsupported semantics to be stated instead of silently approximated. Do not copy Ossie's schema, terminology, visual design, maturity claims, or create a converter ecosystem before there are working implementations.

Sources: [core specification](https://github.com/apache/ossie/blob/main/core-spec/spec.md), [converters and interoperability](https://github.com/apache/ossie-converters).

## CloudEvents

CloudEvents separates an abstract model, serialization formats, and protocol bindings. Its non-normative primer explains motivation and decisions, leaving normative details in the spec. Published releases and working drafts are distinguished.

**Adaptation:** add a concise explanatory specification overview that links to the numbered rules. Preserve the separation between entitlement meaning, JSON encoding, and HTTP transport. Keep draft status explicit. This does not imply adopting CloudEvents as an entitlement protocol or adding an event system.

Sources: [document structure and releases](https://github.com/cloudevents/spec), [primer](https://github.com/cloudevents/spec/blob/main/cloudevents/primer.md).

## OpenTelemetry semantic conventions

OpenTelemetry specifies names, types, meanings, and values rather than relying on matching field names. Its guidance recommends realistic examples and testing across implementations before stabilizing conventions; maturity is tracked explicitly.

**Adaptation:** use worked examples with independently stated expected answers; document semantic compatibility and draft version pinning. Keep the implementation's limitations visible. Do not advertise enterprise certification, long-term compatibility, or production guarantees that this draft has not established.

Sources: [semantic conventions](https://opentelemetry.io/docs/specs/semconv/), [authoring and stabilization guidance](https://opentelemetry.io/docs/specs/semconv/how-to-write-conventions/).

## OpenMeter

OpenMeter has an executable entitlement model with boolean, static, and metered types. Its quickstart creates customer entitlements directly, configures a usage period, and queries current access and balance. It is inaccurate to assume that its entitlements necessarily require subscription creation simply because the documentation is under billing.

**Adaptation:** make OpenEntitlement examples executable and distinguish a resolved limit from a metered balance. Keep usage aggregation, reset windows, and claim idempotency outside our current scope; a future integration must specify the mapping explicitly.

Sources: [entitlement overview](https://openmeter.io/docs/billing/entitlements/overview), [executable quickstart](https://openmeter.io/docs/billing/entitlements/quickstart).

## Implemented in this documentation pass

- Public specification overview: model, resolution semantics, wire format, reference implementations, and a worked example.
- Implementer guide: capability mapping, shared test fixtures, transport validation, and evidence expected for a compatibility claim.
- Clear current/draft boundaries and links to the source conformance suites.
- Public product docs exclude website infrastructure instructions and internal review vocabulary.

## Deferred

Vendor converters, a formal certification program, a machine-generated compatibility registry, extension namespaces, events, metering, and additional storage integrations need implementation evidence and their own scoped proposals. None is claimed by this documentation change.
