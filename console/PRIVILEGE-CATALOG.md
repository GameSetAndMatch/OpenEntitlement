# Privilege Catalog

A Privilege is one typed entitlement value, such as MCP access or a seat limit. A Group organizes Privileges in a hierarchy; each Privilege belongs to at most one Group. Tags are reusable labels across Groups, and a Privilege can have several.

The authoring model uses a shared base and three concrete types. JSON and YAML keys are camelCase; the Python models expose the same fields as snake_case attributes (`group_id`, `env_override`) and accept either spelling ([ADR-0006](../ADR-0006.md)).

| Field | Meaning |
|---|---|
| `key` | Stable flat identifier used by the application |
| `type` | `boolean`, `integer`, or `enum` (a string enum) |
| `title`, `description` | Human-readable metadata |
| `visibility` | `editable`, `read_only`, or `hidden` |
| `groupId` | Optional single Group identifier |
| `tags` | Zero or more unique Tag identifiers |
| `default` | Optional typed Catalog default |
| `envOverride` | Boolean subtype only: name of an environment prerequisite |

Integer definitions can declare `minimum`, `maximum` and `unlimited`. String enums declare a non-empty `enum` list. Unknown fields, wrong defaults, duplicate Tags, invalid references and cyclic Groups are rejected. Hidden, read-only and environment-linked Privileges need a default. An editable Privilege without a default requires an explicit value in every tier variant. When tier variants already exist, the console's `PUT …/catalog` request can carry `variantValues` beside `entry`: a map from each variant ID that does not yet set the Privilege to its value. The definition and those values save as one change with one audit entry; a variant that already sets its own value, an unknown variant, a missing or invalid value, or `variantValues` on a Privilege that keeps a Catalog default rejects the whole request: the definition, the values, the revision and the audit log stay unchanged.

`read_only` replaces the previous frozen flag: it displays the default but prevents customer/tier changes from affecting its effective value. Values that tier variants, Organization terms and personal terms set for it stay stored without effect, and apply again if the Privilege returns to `editable`. Removing them is explicit: a `PUT …/catalog` request that makes an existing Privilege `read_only` can carry `removeOwnValues: true`, which removes them in the same change and audit entry (the console lists those records and asks to confirm first). It needs a reason when it removes Organization terms or personal terms, because those are contract terms. It is rejected on a Privilege that is already Read-only, when nothing sets its own value, and on the legacy `privileges` route, which never removes values. Grants are allowances, not values; they stay and have no effect while the Privilege is Read-only. `hidden` omits normal UI controls without removing backend evaluation. Boolean environment prerequisites are ANDed after normal or read-only resolution. They cannot grant additional access and cannot bind integers or strings.

## Example YAML

```yaml
groups:
  - id: mcp
    title: MCP
    description: Integration privileges
tags:
  - id: enterprise
    title: Enterprise
  - id: integration
    title: Integration
privileges:
  - key: mcp_enabled
    type: boolean
    title: MCP access
    description: Allow the Organization to use MCP.
    visibility: editable
    default: false
    groupId: mcp
    tags: [enterprise, integration]
    envOverride: MCP_INSTALLED
  - key: max_connections
    type: integer
    title: Maximum connections
    description: Concurrent connections permitted by this install.
    visibility: read_only
    default: 3
    groupId: mcp
    tags: [integration]
```

The self-hosted service accepts this flat Catalog format at `OE_CATALOG` in YAML or JSON. Its published OEREP 0.1 SDK/wire catalog remains compatible through an adapter. Standalone authoring currently requires defaults and integer limits without additional min/max bounds; workspace tier variants support required values and bounded integer definitions. Unsupported standalone definitions fail startup rather than silently losing constraints.

The workspace console uses **Privilege Catalog → Tiers → Organizations**. It can create/edit Groups and Tags, filter by Tag and assign multiple Tags to a Privilege. `GET /api/workspaces/:id/catalog` exposes the typed authoring contract. Audited `PUT` to that endpoint accepts one Privilege as `entry`, alongside `revision` and `reason`. Groups and Tags use their corresponding workspace endpoints. Environment binding changes remain platform-administrator-only.

Existing preview Feature containers are presented as Groups without discarding metadata or stored entitlement values. The internal preview storage and older administrative endpoints retain their compatibility representation; the new authoring endpoint and YAML snapshots use `title`, `visibility`, `groupId`, `tags` and `envOverride`. Groups nest with `parentId`.

## Python first: Pydantic models

`pip install openentitlement-sdk` includes Pydantic, the core's only required dependency ([ADR-0006](../ADR-0006.md)). Import `Privilege`, `BooleanPrivilege`, `IntegerPrivilege`, `StringEnumPrivilege`, `Group`, `Tag` and `PrivilegeCatalog` from `openentitlement`. They are strict, immutable Pydantic models with `to_json()`/`model_dump_json()`, `model_validate_json()` and JSON Schema. Attributes are snake_case; JSON is camelCase. `openentitlement.authoring` remains as a compatibility import path. [The ACME walkthrough](../docs/guides/acme-workspace.md) covers the whole Workspace, Groups, Tags, Tiers, Organizations and user exceptions.

TypeScript/browser/server authoring shares `PrivilegeSchema` and `PrivilegeCatalogSchema` from `@openentitlement/core/authoring`; Zod is a regular dependency of `@openentitlement/core`. Keys are camelCase and the rules match the generated [JSON Schema contract](../spec/schemas/privilege-catalog.schema.json). Unknown fields and invalid typed values fail; no coercion of strings into booleans or numbers is performed.
