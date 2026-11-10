---
title: Privilege Catalog
description: Define typed privileges with visibility, one Group and multiple Tags.
---

A Privilege is one entitlement value your application enforces: a boolean permission, an integer limit or a string enum. The **Privilege Catalog** defines those values before you build tiers and assign Organizations.

Each Privilege has a stable `key`, a `type`, a `title`, a `description`, and a `visibility`:

- **Editable:** tiers and Organization terms may replace the default.
- **Read-only:** show the default in a greyed-out control.
- **Hidden:** omit normal UI controls while retaining backend evaluation.

Catalog JSON and YAML keys are camelCase (`groupId`, `parentId`, `envOverride`). Python attributes use snake_case (`group_id`). Groups organize the Catalog in a hierarchy. A Privilege can belong to one Group and have multiple Tags, so labels such as `enterprise` or `integration` work across Groups.

```yaml
privileges:
  - key: mcp_enabled
    type: boolean
    title: MCP access
    description: Permit MCP access when the connector is installed.
    visibility: editable
    default: false
    envOverride: MCP_INSTALLED
    tags: []
```

`envOverride` exists only on boolean definitions and means **entitlement AND environment**. `false` vetoes access; `true` never grants access beyond the tier or contract. Integer and string-enum definitions reject that field. Hidden, read-only and environment-linked privileges need defaults; editable privileges without defaults require values in every tier variant.

The workspace console supports Group and Tag management, Tag filtering and typed privilege authoring. In Python, `pip install openentitlement-sdk` includes Pydantic. Import the strict `BooleanPrivilege`, `IntegerPrivilege`, `StringEnumPrivilege`, `Group`, `Tag` and `PrivilegeCatalog` models from `openentitlement`; they also work directly as [FastAPI](/docs/python/#use-with-fastapi) request and response types. TypeScript uses the `@openentitlement/core/authoring` Zod schemas. See the [Python-first ACME walkthrough](/docs/acme-workspace/) for the whole Workspace model.

## Shared JSON Schema

[`spec/schemas/privilege-catalog.schema.json`](https://github.com/open-entitlement/OpenEntitlement/blob/main/spec/schemas/privilege-catalog.schema.json) is the cross-language contract, a JSON Schema 2020-12 document generated from the Pydantic models. Point an editor or another language's validator at it. It checks structure, types, identifiers, lengths and integer ranges. The SDK models also enforce rules a JSON Schema cannot express: trimmed titles, unique Tags and enum choices, minimum ≤ maximum, defaults within bounds, required defaults, known Group and Tag references and an acyclic Group hierarchy. Shared [fixtures](https://github.com/open-entitlement/OpenEntitlement/tree/main/spec/assets/catalog-fixtures) keep Pydantic, Zod and the schema in agreement.

See the [authoring guide](https://github.com/open-entitlement/OpenEntitlement/blob/main/console/PRIVILEGE-CATALOG.md) for a complete Catalog example, API routes, migration behavior and standalone compatibility limits. The existing OEREP v1 transport and evaluation SDKs remain compatible.
