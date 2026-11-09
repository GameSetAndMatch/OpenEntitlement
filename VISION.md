# OpenEntitlement vision

OpenEntitlement makes entitlement checks portable: applications use a stable SDK and semantic contract while organizations choose the provider that fits their operational, commercial and compliance needs.

The open protocol, dependency-light SDKs, conformance scenarios and reference service are complementary products. The protocol must not require OpenEntitlement Cloud, a billing vendor, a deployment platform or a proprietary SDK. Similar HTTP endpoints alone do not prove interchangeability: evaluation semantics, error behavior and data mappings must be verified.

## Product direction

The hosted reference service should be an economical, transparent option for developers and smaller teams. Prefer shared infrastructure and measured, bounded resource use. Aim for customer revenue to cover allocated operating costs and a modest reserve; do not promise zero losses or set prices without observed unit costs. Infrastructure, storage, backups, observability, payment fees and operational work all count. Exact pricing and hosting architecture remain decisions to validate.

OpenEntitlement Cloud is not positioned as the automatic choice for every enterprise compliance program. Publish actual capabilities and assurance evidence. Do not imply SOC 2 Type II certification, enterprise controls, or provider compatibility that have not been demonstrated. Enterprises should be able to select another conforming implementation without rewriting application-facing entitlement checks.

## One responsibility

Own entitlement definitions, commercial facts and deterministic resolution. Keep application authorization, authentication, release flags, payment, quoting/invoicing and usage accounting separate. Connect those systems through explicit adapters rather than adopting a vendor's model as the protocol.

Quote-to-Cash is integration context: agreed commercial rights may become entitlement facts, while quoting, collection and accounting remain external. Vendor discovery informs mappings and acceptance tests; it does not justify copying a vendor's schema or making its SDK mandatory.

## Accepted language and boundaries

- A **Workspace** is the business control plane for its Privilege Catalog, Tiers, Organizations, members and audit records. Accounts can create and join multiple Workspaces. Tenant is technical isolation language, not the preferred UI term or an Organization synonym.
- A **Privilege** is a typed boolean, integer or string-enum value with a title, description and visibility. The **Privilege Catalog** is the authoring surface. A Privilege has at most one hierarchical **Group** and multiple **Tags**.
- **Visibility** is `hidden`, `read_only` or `editable`. Hidden values still evaluate. Read-only values use their defaults. Boolean `env_override` is a final prerequisite: entitlement AND environment. Integer/string environment bindings are out of scope for now.
- **Tier** is commercial level; a **Tier variant** represents standard, trial or grace conditions. Payment arrangement and SaaS/self-hosted deployment are separate concerns. An **Organization** is the entitled customer within a Workspace.
- A missing default is a requirement for explicit variant values, never an implicit zero, false or unlimited. Hidden, read-only and environment-linked locked values need defaults.
- Usage is supplied by the application or a metering adapter. A consumption dashboard distinguishes reported usage, missing data and staleness; it does not manufacture counters or turn read-only evaluation into consumption.

## How to keep this direction durable

Use [GLOSSARY.md](GLOSSARY.md) for language, accepted ADRs for settled trade-offs, and RFCs for evolving contracts. See [the decision index](docs/decisions.md) for status and implementation boundaries. The existing normative specification remains authoritative for released OEREP/SDK behavior; accepted product direction does not silently create a new wire-protocol version.

Before expanding scope, explain the concrete user need and why it belongs in the entitlement layer. Prefer a small verified slice, explicit capabilities and reversible adapters over speculative frameworks. Maintain honest empty states, accessible reusable controls, and meaningful API/browser/conformance tests.
