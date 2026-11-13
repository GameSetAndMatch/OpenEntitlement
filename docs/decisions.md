# Direction and decision index

Start with [VISION.md](../VISION.md) for purpose and boundaries, and [GLOSSARY.md](../GLOSSARY.md) for preferred language. An accepted decision records intent; it is not automatically evidence of released implementation.

| Record | Status and scope |
|---|---|
| [ADR-0001](../ADR-0001.md) | Accepted: protocol, generic SDKs and own reference server; application-owned usage; opt-in `RemoteProvider` decision cache (never for check-and-act) |
| [ADR-0002](../ADR-0002.md) | Historical accepted design, partially superseded by ADR-0003/0004; AWS-first, Tenant UI terminology and implicit Stripe-free access are not current requirements |
| [ADR-0003](../ADR-0003.md) | Accepted: Workspace control plane, Privilege Catalog, Group/Tag cardinality and compatibility boundaries |
| [ADR-0004](../ADR-0004.md) | Accepted: boolean-only restrictive environment prerequisites, separate visibility, usage/billing boundaries |
| [ADR-0005](../ADR-0005.md) | Accepted: user-scoped inheritance and Cloud capability packaging; its optional typed authoring is superseded by ADR-0006 |
| [ADR-0006](../ADR-0006.md) | Accepted: core SDK dependency rule (only Pydantic/Zod), Pydantic models everywhere in Python, camelCase JSON with language-idiomatic attributes, Python ≥ 3.11; supersedes parts of ADR-0001/0003/0005 |
| [ADR-0007](../ADR-0007.md) | Accepted; Python integration preview (OPE-43): the Audit log is readable by Managers and Owners only, shows actor emails, and each entry records what it changed (kind, ID and name at that moment) |
| [ADR-0008](../ADR-0008.md) | Accepted, in progress on `service/python` (Products and per-Product roles: OPE-38; Members, invitations and Cloud service tier: OPE-44): a Workspace sells one or more Products, each with its own Catalog and Tiers; Organizations get one Tier variant per Product; API keys belong to one Product; supersedes ADR-0005's one-Catalog sentence |
| [ADR-0009](../ADR-0009.md) | Accepted, in progress on `service/python` (foundation: OPE-37; sign-in, Workspaces, Products and per-Product roles: OPE-38; Product Catalog: OPE-39; Tiers: OPE-40; Members, invitations and Cloud service tier: OPE-44; Organizations: OPE-41; application users: OPE-60): the service is rewritten in Python (uv, FastAPI, FastMCP) with three layers (interfaces → service layer → repositories), SQLAlchemy Core + asyncpg + Alembic, RFC 9457 errors everywhere; amends RFC-0004 and RFC-0005 |
| [ADR-0010](../ADR-0010.md) | Accepted clarifications of ADR-0008/0009 (Q1–Q14); no protocol change; Q13 request-body follow-up and Q14 quickstart sessions pending |
| [ADR-0011](../ADR-0011.md) | Accepted, not implemented (after OPE-45, Python service only): a Tier may set a Tier minimum for an integer Privilege that its standard variant and Organization terms cannot go below; constrains authoring, not evaluation; Minimum commitments are recorded on the contract and displayed only; no protocol change |
| [RFC-0001](rfcs/0001-entitlements-v0.2.md) | Proposed historical contract refinement; retain unresolved parts explicitly, not as implemented requirements |
| [RFC-0002](rfcs/0002-privilege-catalog.md) | Accepted reference authoring contract; not a normative OEREP version bump |
| [RFC-0003](rfcs/0003-consumption-dashboard.md) | Proposed read-only consumption view; blocked on a real application/metering usage source |
| [RFC-0004](rfcs/0004-mcp-server.md) | Accepted direction: MCP server for the Workspace control plane (per-Account sign-in, Workspace opt-in, same Permissions, previewed writes, no deletes); not implemented |
| [RFC-0005](rfcs/0005-product-scoped-evaluation.md) | Accepted direction, implemented preview on `service/python` (OPE-42), not released: amends OEREP 0.1 so requests name the Product and Privilege in the path (`/oerep/v1/products/{product}/privileges/{privilege}/resolve`), `suggest` becomes `upgrade`, and keys are bound to one Product |
| [RFC-0006](rfcs/0006-periodic-allowances.md) | Proposed: an optional reset period (day, week, month) on integer Privileges, returned by OEREP with the value; usage stays the application's; open questions for the owner; built after OPE-45 |
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
