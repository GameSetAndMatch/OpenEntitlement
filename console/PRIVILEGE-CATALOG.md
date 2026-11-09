# Privilege Catalog

A Privilege is one typed entitlement value, such as MCP access or a seat limit. A Group organizes Privileges in a hierarchy; each Privilege belongs to at most one Group. Tags are reusable labels across Groups, and a Privilege can have several.

The authoring model uses a shared base and three concrete types:

| Field | Meaning |
|---|---|
| `key` | Stable flat identifier used by the application |
| `type` | `boolean`, `integer`, or `enum` (a string enum) |
| `title`, `description` | Human-readable metadata |
| `visibility` | `editable`, `read_only`, or `hidden` |
| `group_id` | Optional single Group identifier |
| `tags` | Zero or more unique Tag identifiers |
| `default` | Optional typed Catalog default |
| `env_override` | Boolean subtype only: name of an environment prerequisite |

Integer definitions can declare `minimum`, `maximum` and `unlimited`. String enums declare a non-empty `enum` list. Unknown fields, wrong defaults, duplicate Tags, invalid references and cyclic Groups are rejected. Hidden, read-only and environment-linked Privileges need a default. An editable Privilege without a default requires an explicit value in every tier variant.

`read_only` replaces the previous frozen flag: it displays the default but prevents customer/tier changes from affecting its effective value. `hidden` omits normal UI controls without removing backend evaluation. Boolean environment prerequisites are ANDed after normal or read-only resolution. They cannot grant additional access and cannot bind integers or strings.

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
    group_id: mcp
    tags: [enterprise, integration]
    env_override: MCP_INSTALLED
  - key: max_connections
    type: integer
    title: Maximum connections
    description: Concurrent connections permitted by this install.
    visibility: read_only
    default: 3
    group_id: mcp
    tags: [integration]
```

The self-hosted service accepts this flat Catalog format at `OE_CATALOG` in YAML or JSON. Its published OEREP v1 SDK/wire catalog remains compatible through an adapter. Standalone authoring currently requires defaults and non-negative integer limits without additional min/max bounds; workspace tier variants support required values and bounded integer definitions. Unsupported standalone definitions fail startup rather than silently losing constraints.

The workspace console uses **Privilege Catalog → Tiers → Organizations**. It can create/edit Groups and Tags, filter by Tag and assign multiple Tags to a Privilege. `GET /api/workspaces/:id/catalog` exposes the typed authoring contract. Audited `PUT` to that endpoint accepts one Privilege as `entry`, alongside `revision` and `reason`. Groups and Tags use their corresponding workspace endpoints. Environment binding changes remain platform-administrator-only.

Existing preview Feature containers are presented as Groups without discarding metadata or stored entitlement values. The internal preview storage and older administrative endpoints retain their compatibility representation; the new authoring endpoint and YAML snapshots use `title`, `visibility`, `group_id`, `tags` and `env_override`.

## Python dataclasses

```python
from openentitlement import (
    BooleanPrivilege, Group, PrivilegeCatalog, Tag, Visibility,
)

catalog = PrivilegeCatalog(
    groups=(Group(id="mcp", title="MCP"),),
    tags=(Tag(id="enterprise", title="Enterprise"),),
    privileges=(BooleanPrivilege(
        key="mcp_enabled",
        title="MCP access",
        description="Allow MCP access when installed.",
        visibility=Visibility.EDITABLE,
        default=False,
        env_override="MCP_INSTALLED",
        group_id="mcp",
        tags=("enterprise",),
    ),),
)
encoded = catalog.to_json()
```

`IntegerPrivilege` and `StringEnumPrivilege` have their own constrained defaults and do not accept `env_override`. `Privilege.from_dict()` validates a serialized definition; `PrivilegeCatalog.from_dict()` also validates Group/Tag references and hierarchy. These authoring dataclasses use only the standard library and do not replace the existing OEREP v1 evaluation classes.
