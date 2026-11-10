---
title: Privilege Catalog
description: Define typed privileges with visibility, one Group and multiple Tags.
---

A Privilege is one entitlement value your application enforces: a boolean permission, an integer limit or a string enum. The **Privilege Catalog** defines those values before you build tiers and assign Organizations.

Each Privilege has a stable `key`, a `type`, a `title`, a `description`, and a `visibility`:

- **Editable:** tiers and Organization terms may replace the default.
- **Read-only:** show the default in a greyed-out control.
- **Hidden:** omit normal UI controls while retaining backend evaluation.

Groups organize the Catalog in a hierarchy. A Privilege can belong to one Group and have multiple Tags, so labels such as `enterprise` or `integration` work across Groups.

```yaml
privileges:
  - key: mcp_enabled
    type: boolean
    title: MCP access
    description: Permit MCP access when the connector is installed.
    visibility: editable
    default: false
    env_override: MCP_INSTALLED
    tags: []
```

`env_override` exists only on boolean definitions and means **entitlement AND environment**. `false` vetoes access; `true` never grants access beyond the tier or contract. Integer and string-enum definitions reject that field. Hidden, read-only and environment-linked privileges need defaults; editable privileges without defaults require values in every tier variant.

The workspace console supports Group and Tag management, Tag filtering and typed privilege authoring. For strict Pydantic authoring, use `openentitlement-sdk[authoring]` and import from `openentitlement.authoring`. TypeScript uses the optional `@openentitlement/core/authoring` Zod schemas. See the [Python-first ACME walkthrough](/docs/acme-workspace/) for the whole Workspace model. The Python SDK also retains validated `BooleanPrivilege`, `IntegerPrivilege`, `StringEnumPrivilege`, `Group`, `Tag` and `PrivilegeCatalog` dataclasses for JSON serialization.

See the [authoring guide](https://github.com/GameSetAndMatch/OpenEntitlement/blob/main/console/PRIVILEGE-CATALOG.md) for a complete Catalog example, API routes, migration behavior and standalone compatibility limits. The existing OEREP v1 transport and evaluation SDKs remain compatible.
