# OpenEntitlement product requirements and feature tracker

The single list of what OpenEntitlement does, what is being built, and what is planned. Update it in the same PR that changes a feature's status. For purpose and boundaries read [VISION.md](VISION.md); for vocabulary, [GLOSSARY.md](GLOSSARY.md); for settled decisions, [docs/decisions.md](docs/decisions.md). Accepted decisions describe intent; this file tracks delivery.

**Status:** ✅ shipped on `main` · 🚧 in progress (open PR or active work) · 📋 planned · 👤 needs an owner action outside the repository

## Product

OpenEntitlement is an open, vendor-neutral standard and open-source implementation for product entitlements: what an Organization may use and how much. It defines a shared model, an evaluation protocol (OEREP), SDKs, and a self-hostable service with a console, all Apache-2.0. Applications evaluate entitlements without depending on a billing vendor.

Primary users:
- **Application developers** who gate features and limits in code.
- **Operators, sales and support** who manage Tiers, customer terms and exceptions in the console.
- **Self-hosters** who run the service on their own infrastructure.
- **Hosted-service customers** who use OpenEntitlement as a SaaS.

## Feature list

### Specification and protocol

| Feature | Status | Where |
|---|---|---|
| Entitlement specification v0.1 (RFC 2119 requirements, Gherkin conformance suite) | ✅ | `spec/`, #1, #2 |
| OEREP v1 remote evaluation protocol (single, bulk, upgrade suggestion) | ✅ | `spec/sections/10-remote-evaluation.md`, #1 |
| Entitlements v0.2 proposal: Tier variants, contracts, JSON Schema definitions | ✅ proposed (RFC-0001) | #20 |
| Flat privilege identifiers only; nesting belongs to Groups, with cross-hierarchy Tags | ✅ | #40, merged on `main` |
| Privilege Catalog authoring contract: Groups, Tags, visibility | ✅ accepted (RFC-0002) | #24 |
| Read-only consumption dashboard | 📋 proposed (RFC-0003), blocked on a real usage source | `docs/rfcs/0003-consumption-dashboard.md` |
| Generated JSON Schema as the shared cross-language contract | 🚧 | ADR-0006, #39; regenerated from #38 models, shared parity and serialization fixtures |

### SDKs

| Feature | Status | Where |
|---|---|---|
| Python SDK (`openentitlement-sdk`) and TypeScript SDK (`@openentitlement/core`) with in-memory, fixed and remote providers, hooks and `guard` | ✅ | `sdk-python/`, `sdk-js/` |
| Postgres provider and advisory lock inside the core packages (`[postgres]` extra, `/postgres` entry point) | ✅ | #31 |
| Stripe Entitlements adapter | ✅ removed before release (billing is not an entitlement source) | #30 |
| Pydantic models everywhere in Python: camelCase JSON, snake_case attributes, FastAPI-ready; strict Limit/Unlimited values and presence-preserving roundtrips; Pydantic is a core dependency | 🚧 | ADR-0006, #38 |
| Python ≥ 3.11 | 🚧 | ADR-0006, #38 |
| Zod as a regular TypeScript dependency, replacing the hand-written validators | 🚧 | ADR-0006, #39 (stacked on #38); shared malformed-value/null/full-string fixtures |
| Opt-in short-lived decision cache in `RemoteProvider` (both SDKs; provenance-safe bypass, failure eviction, fixed transport identity; never used by check-and-act) | 🚧 | [#35](https://github.com/open-entitlement/OpenEntitlement/pull/35); stacked on #39 → #38; #40 shipped on `main` |
| PyPI and npm publication via Trusted Publishing | ✅ workflows; 👤 first release pending | #7, #9, #28 |

### Service and console

| Feature | Status | Where |
|---|---|---|
| Reference service: OEREP API, audited administration, Postgres storage | ✅ | `console/`, #1 |
| Docker image, empty first install with setup screen, Compose files (memory and Postgres) | ✅ | #8, #14 |
| Contracts with private PDF evidence | ✅ | #13 |
| Read-only YAML configuration view | ✅ | #19 |
| Workspace control plane: OIDC sign-in, Workspaces, members and Roles, isolation, audit | ✅ preview | #22 |
| Privilege Catalog editor: typed Privileges, Groups, Tags, hidden and read-only values | ✅ | #23, #24; nested hierarchy and cross-branch Tag regression coverage: #38 |
| Boolean environment prerequisites (an installation can veto, never grant) | ✅ | #23 |
| Tiers and Tier variants (standard, trial, grace), Organization terms | ✅ preview | #22, #27 |
| Application-user entitlements: personal terms and grants | ✅ | #27 |
| Workspace API keys and evaluation endpoint | ✅ preview | #22 |
| Fine-grained, scoped Permissions per Role | 📋 | issue #15 |
| Object storage (S3-compatible) for PDFs with signed uploads | 📋 | issue #15 |
| YAML import with diff preview and audited apply | 📋 | — |

### Agents and integrations

| Feature | Status | Where |
|---|---|---|
| MCP server: agents explain decisions and manage the Catalog, Tiers, Organizations and user exceptions as a signed-in Account (per-Account OAuth sign-in, then the person picks a Workspace; Workspaces opt in), same Permissions as the console and API for every Role, mandatory reasons, audit, preview-then-apply writes, no deletes, included in every plan | 📋 spec accepted, implementation next | [RFC-0004](docs/rfcs/0004-mcp-server.md) |

### Hosted service and self-hosting

| Feature | Status | Where |
|---|---|---|
| Hosted multi-tenant service spec | ✅ spec, 📋 delivery | issue #15 |
| Helm chart for self-hosting (bring your own Postgres and object store) | 📋 | issue #15 |
| Infrastructure as code and automatic deploys from GitHub Actions; economical shared infrastructure, cloud not yet fixed | 📋 | issue #15, ADR-0003 |
| Stripe billing for the hosted service: Owners pay; the service enforces its own plans with OpenEntitlement | 📋 | issue #15, ADR-0004 |
| Invitation email delivery | 📋 | issue #15 |

### Website, documentation and analytics

| Feature | Status | Where |
|---|---|---|
| Landing product scenes using the console Catalog, value editor and resolver, with concise copy and no playground controls | ✅ | #43; replaces the #42 playground; `website/src/components/ProductScenes.tsx` |
| Privilege-local Tag picker with search, selection, removable labels and inline creation; Group management remains separate | ✅ | #44; `console/web/src/workspace/tag-picker.tsx` |
| Privilege form redesign: sections ordered Basics → Value → Organize (optional), key and Group ID derived from the title, numbered enum choice list, Finder-like Group picker that creates nested Groups in place, freely chosen (including negative) integer bounds, shared form primitives and UI guidelines with an automated layout check | 🚧 in review | `console/web/UI-GUIDELINES.md`, `console/test/form-layout.mjs` |
| One way to do each thing across the console: create Groups only from the Privilege form, variants from their tier, workspaces from the Workspaces page; no breadcrumb bar, setup stepper, refresh buttons or duplicate copy/download actions; a form replaces the list while open; IDs filled from names | 🚧 in review | `console/web/UI-GUIDELINES.md` (One way to do each thing) |
| Visual language: one accent, hairlines, type-led hierarchy, light and dark tokens; applied to the console, landing page and README | 🚧 in review | `docs/design/visual-language.md`, `console/web/src/design.css` |
| Documentation site at openentitlement.dev (Starlight) with diagrams and link checks | ✅ | `website/`, #3, #4, #11 |
| Automatic website deployment to Cloudflare on every merge to `main` | ✅ | #36, #41: runs only from `main` in the protected `website` environment (token scoped there), fails without credentials, verifies the live revision |
| Landing page rebuilt on the docs' theme and components, showing the current model | ✅ | #33 |
| PostHog on openentitlement.dev: analytics, error tracking, session replay, heatmaps, web vitals, journey events | ✅ | #34 |
| PostHog in the console, opt-in (`OE_POSTHOG_KEY`): same features plus server-side errors and product events | ✅ | #34, `docs/maintainers/analytics.md` |
| Funnel dashboards: website acquisition (landing → docs → quickstart → install → GitHub/Docker) and console activation (sign-in → Workspace → Privilege → Tier → Organization → API key → first evaluation) | ✅ created in PostHog; 📋 hosted console must set `OE_POSTHOG_KEY` to feed the activation funnel | #34, `tools/posthog/dashboards.mjs` |

### Project

| Feature | Status | Where |
|---|---|---|
| GitHub organization `open-entitlement`, avatar, repository links | ✅ | #29 |
| Trusted publishers on PyPI and npm moved to the `open-entitlement` owner | 👤 | `docs/maintainers/` |

## Open owner actions

1. On PyPI and npm, change the trusted publisher owner from `GameSetAndMatch` to `open-entitlement` before the next release.
2. Publish the first Python (`python-v…`) and npm (`npm-v…`) releases.
3. In PostHog project settings, confirm session replay, heatmaps, web vitals and exception autocapture are enabled.

## Working agreements

- One PR per feature; PRs stay focused and state validation and limitations.
- At most two parallel agents at a time.
- Self-hosted installations send no telemetry unless the operator configures their own PostHog key.
- Never reference private customers or companies in public files.
