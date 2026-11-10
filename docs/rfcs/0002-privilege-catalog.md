# RFC-0002: Privilege Catalog authoring contract

- **Status:** accepted for the reference workspace authoring model; not a new released OEREP contract
- **Date:** 2026-11-09
- **Decisions:** [ADR-0003](../../ADR-0003.md), [ADR-0004](../../ADR-0004.md)
- **Implementation:** [PR #24](https://github.com/open-entitlement/OpenEntitlement/pull/24), on the workspace and boolean-prerequisite layers in #22/#23

## Contract

A Privilege has a flat stable `key`, `type`, `title`, `description`, `visibility`, an optional single `groupId`, zero or more unique Tag IDs in `tags`, and an optional typed `default`.

| Subtype | Type value | Additional fields |
|---|---|---|
| Boolean | `boolean` | Boolean default; optional `envOverride` variable name |
| Integer | `integer` | Integer default or explicit allowed unlimited value; optional minimum/maximum/unlimited capability |
| String enum | `enum` | Non-empty unique `enum` choices and an optional matching string default |

`envOverride` must not exist on integer or enum subtypes. It is a boolean AND prerequisite, not an exact-value replacement. Unknown keys, wrong types, out-of-range defaults, duplicate Tags and invalid references are errors. A Privilege belongs to at most one Group; Group parent relationships must exist and be acyclic. Tags are labels independent of that hierarchy.

Visibility is `editable`, `read_only` or `hidden`. Read-only values use the Catalog default; hidden values are omitted from normal controls but still evaluate. Environment-linked boolean controls are locked and display the prerequisite's source. Hidden, read-only and environment-linked values need defaults; otherwise an editable value without a default must be supplied in every tier variant.

```yaml
groups:
  - id: integrations
    title: Integrations
tags:
  - id: enterprise
    title: Enterprise
  - id: mcp
    title: MCP
privileges:
  - key: mcp_enabled
    type: boolean
    title: MCP access
    description: Permit MCP use when the component is installed.
    visibility: editable
    default: false
    groupId: integrations
    tags: [enterprise, mcp]
    envOverride: MCP_INSTALLED
```

## Workflow and boundaries

Author Privileges and metadata in the Catalog, create Tiers/variants from their defaults, then assign Organizations and negotiated terms. Standard, trial and grace variants remain separate from commercial Tier level. A customer's contract and privileges do not become a role, release flag or billing provider.

The reference implementation exposes a typed authoring API and serializable Python Pydantic models. JSON and YAML keys are camelCase, while Python attributes stay snake_case ([ADR-0006](../../ADR-0006.md)). JSON/YAML representation is intentionally simple, without requiring OpenAPI document structure or arbitrary schema vocabularies.

## Compatibility and status

Published OEREP v1 still uses its existing Feature/Plan and reason vocabulary. The new authoring model maps through explicit adapters rather than silently renaming or expanding wire fields. Existing preview Feature containers become Groups while preserving data. Standalone constraints unsupported by its v1 runtime must fail explicitly; workspace-only capabilities must be described as such.

The earlier RFC-0001 remains a proposed historical refinement for contract/lifecycle behavior. Its release-file-only default authoring rule and older naming do not override this accepted authoring decision. Contract import/reconciliation, provider-specific migration, production hosting, exact commercial pricing and any future normative protocol revision remain separate work. Existing preview tests are evidence of implementation, not a production/compliance certification.
