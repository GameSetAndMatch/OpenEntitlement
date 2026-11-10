# RFC-0004: An MCP server for the Workspace control plane

- **Status:** draft; open questions below. Not implemented.
- **Date:** 2026-11-10
- **Tracks:** [PRD.md](../../PRD.md), "Agents and integrations"

## Why

People manage entitlements by asking questions and making small, deliberate changes:
- "Why can't Globex add a 41st seat?"
- "Give Globex 40 seats until March 31, reason MSA-12."
- "Which Organizations are still on the Business trial?"
- "Add an `ai_tokens` Privilege to the Catalog with a default of 1,000."

An AI agent can do this through the [Model Context Protocol](https://modelcontextprotocol.io) if OpenEntitlement exposes the Workspace control plane as MCP tools. The console stays the place to review and approve. MCP becomes a second, programmable door to the same audited operations.

## Principles

1. **Same authority as the console.** The agent acts as a real Account. Each tool checks that Account's Role and Permissions in the Workspace, exactly as the console API does. MCP never bypasses authorization.
2. **Every change is audited with a reason.** Write tools require a `reason`. The audit record names the Account and the MCP client, for example `alice@acme via Claude`.
3. **Preview before apply.** A write tool first returns the resulting change: before and after values, the affected Organizations, and the resolved values that change. The change is applied only through a separate call that confirms that preview. Agents and their users see exactly what will happen.
4. **Control plane only.** Applications keep evaluating through OEREP with API keys. MCP's evaluation tools exist to explain decisions to people, not to serve production traffic.
5. **No secrets or customer data leak through tool output.** API key secrets are never returned after creation. Contract PDFs are referenced, not inlined.

## Proposed surface

### Read tools

| Tool | Returns |
|---|---|
| `list_workspaces` | Workspaces the Account belongs to, with its Role in each |
| `get_catalog` | Privileges, Groups and Tags, with types, defaults and visibility |
| `list_tiers` | Tiers and their variants with values |
| `list_organizations` | Organizations with their Tier variant, status and term count; filterable by Tier variant |
| `get_organization` | One Organization: variant, terms, application-user exceptions and resolved values |
| `explain_decision` | The resolved value of one Privilege for an Organization and an optional application user, with the reason and each layer (Catalog default → Tier variant → Organization terms → user terms and grants → environment) |
| `get_audit_log` | Recent changes, filterable by entity |

### Write tools (preview, then apply)

| Tool | Change |
|---|---|
| `define_privilege` | Add or update a Privilege, Group or Tag in the Catalog |
| `set_tier_variant_values` | Change values of a Tier variant |
| `assign_tier_variant` | Move an Organization to another Tier variant |
| `set_organization_terms` | Set, schedule or remove Organization terms, with an optional end date |
| `set_user_terms`, `grant_allowance` | Application-user exceptions |

Each write tool returns a preview with a short-lived `change_id`. `apply_change(change_id)` commits it, failing if the Workspace changed in the meantime (the existing revision check).

### Resources and prompts

- **Resources:** the Catalog as JSON Schema (the shared contract from ADR-0006), and the glossary, so an agent uses the right words.
- **Prompts:** "Negotiate a deal" (from a request to proposed Organization terms) and "Explain a refusal" (from an error to the missing entitlement and the cheapest Tier that grants it).

## Transport and authentication (to decide)

- **Remote:** a Streamable HTTP endpoint on the service (`/mcp`). Hosted at the console's domain and available in every self-hosted install.
- **Credential:** see open question 1.
- **Local:** an optional `npx @openentitlement/mcp` stdio bridge for clients without remote MCP support, forwarding to the same endpoint.

## Analytics

Each tool call records a product event (`mcp_tool_called`, with `tool` and `workspace_id`), and each applied change counts in the activation funnel like a console change. Events never include values or reasons (see `docs/maintainers/analytics.md`).

## Open questions

1. **Authentication for v1.** Recommendation: a personal MCP access token per Account and Workspace, created in the console, carrying the Account's Role and revocable at any time. MCP's OAuth flow (dynamic client registration) follows later, because the service is today an OIDC client, not an authorization server.
2. **Writes in v1, or read-only first?** Recommendation: ship reads and `explain_decision` first, then the write tools with preview and apply in a second step.
3. **Who may use MCP?** Recommendation: every Role, limited by its Permissions. A Workspace setting lets Owners disable MCP entirely.
4. **Hosted plans.** Is MCP access part of every hosted plan, or a paid capability? Recommendation: available on every plan; hosted plan limits apply to the underlying operations.
5. **Destructive operations** (deleting Privileges, Tiers or Organizations). Recommendation: not exposed through MCP in v1.

## Acceptance scenarios (draft)

- **Ordinary path:** a Manager's agent explains why Globex is limited to 25 seats, proposes Organization terms of 40 until March 31 with reason MSA-12, shows the preview, and applies it. The audit log records the Manager, the client and the reason.
- **Boundary case:** a User-role token calls `set_organization_terms` and is refused with the same Permission error as the console. A preview applied after another change to the Workspace fails with a conflict, and nothing changes.
