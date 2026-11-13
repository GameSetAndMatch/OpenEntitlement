# RFC-0004: An MCP server for the Workspace control plane

- **Status:** accepted direction (2026-11-10); all design questions answered. Not implemented.
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

1. **Same authority as the console.** The agent acts as a real Account. Every Role can use MCP, and each tool checks that Account's Role and Permissions in the Workspace exactly as the console and API do. Each tool maps to an existing API operation. MCP never adds or bypasses authorization.
2. **Every change is audited with a reason.** Write tools require a `reason`. The audit record names the Account and the MCP client, for example `alice@acme via Claude`.
3. **Preview before apply.** A write tool first returns the resulting change: before and after values, the affected Organizations, and the resolved values that change. The change is applied only through a separate call that confirms that preview. Agents and their users see exactly what will happen.
4. **Control plane only.** Applications keep evaluating through OEREP with API keys. MCP's evaluation tools exist to explain decisions to people, not to serve production traffic.
5. **No secrets or customer data leak through tool output.** API key secrets are never returned after creation. Contract PDFs are referenced, not inlined.

## Proposed surface

### Read tools

| Tool | Returns |
|---|---|
| `list_workspaces` | Workspaces the signed-in Account belongs to **that have MCP enabled**, with its Role in each |
| `select_workspace` | Sets the Workspace for the rest of the MCP session. Until one is selected, every other tool asks the agent to call `list_workspaces` and ask the person which Workspace to use |
| `get_catalog` | Privileges, Groups and Tags, with types, defaults and visibility |
| `list_tiers` | Tiers and their variants with values |
| `list_organizations` | Organizations with their Tier variant, status and term count; filterable by Tier variant |
| `get_organization` | One Organization: variant, terms, application-user exceptions and resolved values |
| `explain_decision` | The resolved value of one Privilege for an Organization and an optional application user, with the reason and each layer (Catalog default → Tier variant → Organization terms → user terms and grants → environment) |
| `get_audit_log` | Recent changes, filterable by entity |

### Write tools (preview, then apply), included in v1

| Tool | Change |
|---|---|
| `define_privilege` | Add or update a Privilege, Group or Tag in the Catalog |
| `set_tier_variant_values` | Change values of a Tier variant |
| `assign_tier_variant` | Move an Organization to another Tier variant |
| `set_organization_terms` | Set, schedule or remove Organization terms, with an optional end date |
| `set_user_terms`, `grant_allowance` | Application-user exceptions |

Each write tool returns a preview with an opaque, unforgeable `change_id` that expires after five minutes. The server binds it to the authenticated Account, OAuth client, Workspace, exact operation, immutable validated payload and reason, and Workspace revision. The apply call supplies only that identifier; it cannot replace fields or a reason after preview.

`apply_change(change_id)` rechecks the token/resource scope, current membership and operation Permission, selected Workspace and its MCP opt-in. A revision match is necessary but never substitutes for authorization. A changed selection, removed membership, reduced Permission, disabled MCP, expired token or expired preview refuses application. Applying as another Account or OAuth client is refused even if the caller otherwise has write access.

Successful application atomically checks the revision, consumes the preview once, commits the mutation and records its audit entry. Concurrent/repeated apply calls cannot duplicate a change; a consumed preview is refused. A failed authorization, expiry or revision check makes no entitlement mutation. Changing Workspace selection invalidates outstanding previews for the previous Workspace.

**No delete tools.** MCP never deletes Privileges, Groups, Tags, Tiers, variants, Organizations, members or API keys. Removing a value goes back to its inherited default through the same write tools, for example by removing an Organization term. Deletions stay in the console.

### Resources and prompts

- **Resources:** the Catalog using the existing [authoring contract](0002-privilege-catalog.md). The generated JSON Schema resource depends on [PR #38](https://github.com/open-entitlement/OpenEntitlement/pull/38) and [PR #39](https://github.com/open-entitlement/OpenEntitlement/pull/39), which must land and validate parity before that resource is advertised, and the glossary, so an agent uses the right words.
- **Prompts:** "Negotiate a deal" (from a request to proposed Organization terms) and "Explain a refusal" (from an error to the missing entitlement and the cheapest Tier that grants it).

## Transport, sign-in and Workspace selection (decided)

- **Remote endpoint:** Streamable HTTP at `/mcp` on the service. Hosted at the console's domain and available in every self-hosted install.
- **Per-Account sign-in.** The MCP client signs the person in with their own Account, using the MCP authorization flow (OAuth 2.1 with PKCE, authorization-server metadata and dynamic client registration). The service acts as the authorization server for MCP clients. People authenticate through the same identity provider as the console (Google on the hosted service, the configured OIDC provider when self-hosted). There are no shared or personal static tokens. Access tokens are short-lived, refreshable and revocable from the console. They're bound to the Account and to the `/mcp` resource.
- **Choosing a Workspace.** After sign-in, the agent calls `list_workspaces` and **asks the person which Workspace to use**, then calls `select_workspace`. The selection lasts for the MCP session. Switching requires another `select_workspace`, which the agent should confirm with the person.
- **Workspaces opt in.** MCP is **off by default**. An Owner enables it in Workspace settings, and it can be disabled again at any time. Only Workspaces with MCP enabled appear in `list_workspaces` or can be selected. Disabling MCP ends access for every MCP session on that Workspace at the next call. Enabling and disabling are audited.
- **Local:** an optional `npx @openentitlement/mcp` stdio bridge for clients without remote MCP support. It runs the same sign-in flow and forwards to the same endpoint.

## Analytics

Each tool call records a product event (`mcp_tool_called`, with `tool` and `workspace_id`), and each applied change counts in the activation funnel like a console change. Events never include values or reasons (see `docs/maintainers/analytics.md`).

## Decisions

1. **Sign-in:** per-Account sign-in through the MCP authorization flow, then the person chooses a Workspace. Only Workspaces whose Owner enabled MCP are available. This means building an OAuth authorization server for MCP clients into the service.
2. **Scope of v1:** read, explain and write tools ship together, with writes always previewed before they're applied.
3. **Who:** every Role, with the same Permissions as the console and API.
4. **Plans:** MCP is included in every hosted plan. Plan limits apply to the underlying operations.
5. **Deletes:** none through MCP.

## Acceptance scenarios (draft)

- **No deletes:** asking the agent to delete an Organization yields no tool for it. The agent points the person to the console.
- **Ordinary path:** an Owner's agent explains why Globex is limited to 25 seats, proposes Organization terms of 40 until March 31 with reason MSA-12, shows the preview, and applies it. The audit log records the Owner, the client and the reason.
- **Opt-in:** an Account belonging to two Workspaces, one with MCP enabled, sees only that one in `list_workspaces`. Selecting the other is refused. When the Owner disables MCP, the next tool call in an existing session is refused.
- **Boundary case:** a User-role Account calls `set_organization_terms` and is refused with the same Permission error as the console. A preview applied after another change to the Workspace fails with a conflict, and nothing changes.

- **Manager authority:** *superseded by [ADR-0008](../../ADR-0008.md).* A Manager may preview and apply `set_organization_terms` for the Products they manage, exactly as in the console; for any other Product it receives the same Permission refusal as the console. MCP never grants more than the console.
- **Preview identity:** another Account or OAuth client cannot apply a preview. Switching Workspaces invalidates the old preview; the change ID cannot be used to bypass selection.
- **Revocation:** removing membership, demoting the Account or disabling MCP between preview and apply refuses the change, even when the Workspace revision is otherwise unchanged.
- **Expiry and replay:** an expired preview makes no change. Two concurrent applications of a valid preview commit at most once; subsequent replay is refused and produces no second mutation audit entry.
- **Immutable payload:** a person cannot change values or the reason through `apply_change`; a different proposal requires a new preview.
