# Catalog environment bindings, frozen values and visibility

Each typed Catalog privilege can declare `envVariable`, `frozen` and `hidden`. A whole feature can also declare `frozen` or `hidden` for all its privileges. These are independent settings:

| Setting | Behavior |
|---|---|
| `envVariable: MCP_INSTALLED` | The typed process-environment value wins and is read-only in the console |
| `frozen: true` | Without an environment binding, the Catalog default wins and is greyed out |
| `hidden: true` | Omit the feature/value from normal console pages, forms and UI YAML snapshots; evaluation still works |

A hidden or frozen workspace privilege must have a default or an environment binding. A definition without a default or binding still requires an explicit value in every tier variant.

## Self-hosted Catalog YAML

The reference service accepts YAML or JSON through the existing `OE_CATALOG` path. Bind variables directly on typed privilege definitions; there is no separate deployment binding file:

```yaml
features:
  - code: mcp
    name: MCP
    gate: mcp_enabled
    privileges:
      - key: mcp_enabled
        valueType: boolean
        default: false
        envVariable: MCP_INSTALLED
      - key: max_mcp_calls
        valueType: integer
        default: 100
        envVariable: MCP_MAX_CALLS
      - key: mcp_mode
        valueType: enum
        options: [read, write]
        default: read
        envVariable: MCP_MODE
      - key: max_connections
        valueType: integer
        default: 3
        frozen: true
  - code: internal
    name: Internal capability
    hidden: true
    privileges:
      - key: internal_enabled
        valueType: boolean
        default: true
```

`deploy/catalog.environment.example.yaml` and `deploy/compose.environment.example.yaml` provide a runnable empty-workspace example:

```sh
docker compose -f deploy/compose.memory.yaml -f deploy/compose.environment.example.yaml up
```

The environment is deployment configuration:

```yaml
services:
  openentitlement:
    environment:
      OE_CATALOG: /config/catalog.yaml
      MCP_INSTALLED: 'false'
      MCP_MAX_CALLS: '500'
      MCP_MODE: read
    volumes:
      - ./catalog.yaml:/config/catalog.yaml:ro
```

Use a service image built from this change; previously published images do not include it yet. Restart after changing environment values. The standalone Catalog is read at startup. Bound booleans accept case-insensitive `true`, `false`, `1`, `0`; integer values must be safe whole numbers within Catalog bounds; strings retain their exact text and must match any enum. Missing bound variables, invalid types and out-of-bounds values are errors, never silent fallbacks. A string may be empty when its definition permits it. The existing OEREP v1 Catalog supports enum strings; the workspace Catalog also supports unrestricted strings.

## Console and workspace behavior

The Catalog displays the binding and source. Tiers and Organizations show a greyed-out control with `Controlled by environment variable 'MCP_INSTALLED=False'` or `Frozen to the Catalog default`. Setting a different tier value, override or grant cannot change the effective result. Stored commercial values are preserved for when a binding is removed or a definition is unfrozen.

A feature has several typed privileges, so the environment binding belongs to the particular value—not an ambiguous whole feature. Feature-wide `hidden` and `frozen` flags apply to every privilege. In the workspace console these flags can be authored alongside feature definitions; a platform administrator can add/change an environment binding. Workspace Owners cannot read arbitrary server environment variables by adding bindings. Invalid binding changes are rejected atomically. The configured service environment is snapshotted at startup.

Values resolve in this order:

1. Linked environment value, if present.
2. Catalog default for a frozen feature/privilege.
3. Normal Catalog → tier variant → Organization terms, with contract lifecycle policy.

The standalone OEREP service returns its existing `FIXED` reason plus optional `environment`/`frozen` diagnostics. The separate workspace preview uses `ENVIRONMENT` or `FROZEN`. No new mandatory OEREP fields or reasons are introduced. Environment bindings replace numeric allowances as a final value; grants are not added again.

`hidden` is presentation, not authorization: the backend and evaluation API still know the definition. Do not use it for storing secrets. UI YAML snapshots omit hidden definitions and resolved environment values and are not full backups. Administrative APIs still provide complete definitions.

## Installation versus SaaS commercial access

These are explicit operator overrides: an environment boolean of `true` forces `true`, just as an integer or string forces its value. For paid SaaS MCP access, keep the Basic/Business entitlement separate from installation status and require both checks in the application. Do not bind a commercial access flag to `MCP_INSTALLED=true` if the intention is merely to make the component available. OpenEntitlement does not deploy or discover MCP pods itself.
