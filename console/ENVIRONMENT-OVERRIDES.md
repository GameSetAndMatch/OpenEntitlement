# Boolean environment prerequisites and Catalog visibility

Environment bindings currently support **booleans only**. They are a final install prerequisite: `effective = entitlement AND environment`. An installed component never grants access that a customer's tier or contract does not allow.

| Entitlement | Environment | Effective value |
|---|---|---|
| false | false | false |
| false | true | false |
| true | false | false |
| true | true | true |

## Catalog configuration

Link the variable directly on the boolean privilege in the existing YAML/JSON Catalog. There is no separate deployment binding file:

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

The self-hosted service accepts YAML or JSON at `OE_CATALOG`. The repository includes an empty-workspace example:

```sh
docker compose -f deploy/compose.memory.yaml -f deploy/compose.environment.example.yaml up
```

Use an image built from this change; previously published images do not include it yet. The Compose override mounts `deploy/catalog.environment.example.yaml` read-only and sets `MCP_INSTALLED=false`. Your deployment automation must set that variable to match the installed components; OpenEntitlement does not discover or deploy pods.

Booleans accept case-insensitive `true`/`false`, or `1`/`0`. Invalid and unset bound variables are errors rather than silent defaults. Restart after changing the environment. Attaching `envVariable` to an integer, enum or string is rejected. There is no numeric cap, string substitution or allow-list behavior in this release.

## Hidden and frozen controls

`hidden: true` and `frozen: true` remain available for all Catalog types, separately from environment prerequisites. They can be declared on a feature (all its privileges) or an individual privilege:

- **Hidden:** omitted from normal console pages, forms and UI YAML snapshots; backend evaluation still works.
- **Frozen:** visible but greyed out, using the Catalog default rather than tier or Organization replacements.
- **Environment-linked boolean:** visible but greyed out, showing the commercial value AND the environment prerequisite. If also frozen, its default is used before applying the prerequisite.

Hidden, frozen and environment-linked workspace values require a Catalog default, so every locked control has a commercial baseline. Values without these controls can still require an explicit value in every tier variant.

The console explains the source, for example `Restricted by environment variable 'MCP_INSTALLED=False'` or `Frozen to the Catalog default`. Stored tier and negotiated values remain intact. They cannot bypass the prerequisite. Removing the binding or unfreezing a value restores normal commercial resolution.

In the workspace service, only a platform administrator can add or change server environment bindings. Workspace Owners cannot read arbitrary server variables by adding definitions. Binding changes are validated and audited atomically, and the service environment is snapshotted at startup. Self-hosted bindings are installer-owned Catalog configuration.

The standalone OEREP service uses its existing `FIXED` reason plus optional diagnostics. The separate workspace preview uses `ENVIRONMENT` or `FROZEN`; no new mandatory OEREP fields or reasons are introduced.

`hidden` controls presentation, not authorization. Administrative APIs still provide complete definitions. UI YAML snapshots omit hidden definitions and resolved environment values; they are not full backups. Only explicitly linked boolean variables are exposed as diagnostics.

## Basic and Business in SaaS

Keep MCP as a normal boolean entitlement: Basic denies it and Business includes it. If the MCP component is absent, `MCP_INSTALLED=false` vetoes both. When installed, `true` preserves each customer's entitlement: Basic stays denied and Business can use MCP. Behavior settings such as timeouts or model names remain deployment configuration, not entitlement environment bindings.
