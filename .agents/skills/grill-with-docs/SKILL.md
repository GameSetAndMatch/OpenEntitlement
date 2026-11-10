---
name: grill-with-docs
description: Clarify unsettled OpenEntitlement product or architecture decisions and retain the resulting vocabulary, ADR or RFC. Use for design ambiguity, not routine implementation.
---
# Grill with docs

Adapted from Matt Pocock's grilling and domain-modeling workflows; see ../UPSTREAM.md.

Read VISION.md, GLOSSARY.md and the relevant decision entry. Build a small decision tree: user-accepted answers, facts to verify, and genuinely open choices. Treat the existing conversation as evidence; do not ask again about Privilege/Group/Tag language, boolean-only prerequisites or provider portability unless the user reopens them.

Find repository and vendor facts yourself. Ask only choices that affect behavior, one short round at a time, with a recommendation and concrete example. A pending answer blocks only work that depends on it. Continue authorized independent work. Do not require a final ritual confirmation when authorization and the decision are already clear.

Stress-test the proposal with one ordinary path and one failure/boundary case. For this project, check isolation, missing defaults, restrictive environment behavior, stale/missing usage and vendor-switching semantics when relevant. Avoid broad hypothetical checklists.

Capture settled language in GLOSSARY.md, durable trade-offs in an ADR, and unsettled contract details in an RFC. Do not turn a proposal into a released requirement or record personal/account secrets. Follow domain-modeling when the domain itself changes. Finish with decisions, remaining unknowns and the concrete next step.
