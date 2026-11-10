# Direction and decision index

Start with [VISION.md](../VISION.md) for purpose and boundaries, and [GLOSSARY.md](../GLOSSARY.md) for preferred language. An accepted decision records intent; it is not automatically evidence of released implementation.

| Record | Status and scope |
|---|---|
| [ADR-0001](../ADR-0001.md) | Accepted: protocol, generic SDKs and own reference server; application-owned usage |
| [ADR-0002](../ADR-0002.md) | Historical accepted design, partially superseded by ADR-0003/0004; AWS-first, Tenant UI terminology and implicit Stripe-free access are not current requirements |
| [ADR-0003](../ADR-0003.md) | Accepted: Workspace control plane, Privilege Catalog, Group/Tag cardinality and compatibility boundaries |
| [ADR-0004](../ADR-0004.md) | Accepted: boolean-only restrictive environment prerequisites, separate visibility, usage/billing boundaries |
| [ADR-0005](../ADR-0005.md) | Accepted: user-scoped inheritance and Cloud capability packaging; its optional typed authoring is superseded by ADR-0006 |
| [ADR-0006](../ADR-0006.md) | Accepted: core SDK dependency rule (only Pydantic/Zod), Pydantic models everywhere in Python, camelCase JSON with language-idiomatic attributes, Python ≥ 3.11; supersedes parts of ADR-0001/0003/0005 |
| [RFC-0001](rfcs/0001-entitlements-v0.2.md) | Proposed historical contract refinement; retain unresolved parts explicitly, not as implemented requirements |
| [RFC-0002](rfcs/0002-privilege-catalog.md) | Accepted reference authoring contract; not a normative OEREP version bump |
| [RFC-0003](rfcs/0003-consumption-dashboard.md) | Proposed read-only consumption view; blocked on a real application/metering usage source |
| [Normative specification](../spec/README.md) | Released/draft version stated by the spec itself governs compatible SDK/wire behavior |
| [Revenera spike](research/revenera-connector-spike.md) | Research: read-only connector feasibility, API beta caveat and runtime allocation boundaries |
| [Prior-art matrix](research/vendor-data-model-matrix.md) | Research evidence/inference, not product requirements or certified compatibility |

## Current implementation slices

- [#22](https://github.com/open-entitlement/OpenEntitlement/pull/22): shared workspace preview, verified sign-in, membership, isolation, audit and commercial facts.
- [#23](https://github.com/open-entitlement/OpenEntitlement/pull/23): boolean environment prerequisites and visibility controls.
- [#24](https://github.com/open-entitlement/OpenEntitlement/pull/24): typed Privilege authoring, one Group/multiple Tags and terminology consolidation (its dataclasses were replaced by Pydantic models under ADR-0006).

These references identify review scope, not a permanent release-status dashboard. Check the actual merged code/release before claiming availability. The legacy standalone service remains a separate compatibility entry point. Production workspace identity provisioning, complete SDK integration of that slice, advanced metering and enterprise assurance are not implied by these previews.

## Change discipline

Record a changed settled decision in a new/superseding ADR, update vocabulary and examples, and preserve the relevant compatibility story. Use an RFC for a proposal that still needs agreement. Do not accumulate contradictory duplicate vision files or make every bug fix an ADR. Review a PR against its own stack base and the relevant accepted decision, with tests and limitations tied to the final head SHA.
