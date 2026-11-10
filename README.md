<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/icon-dark.svg">
  <img src="assets/icon.svg" width="64" height="64" alt="OpenEntitlement logo: an O-shaped doorway whose door is the letter E">
</picture>

# OpenEntitlement

**An open-source entitlement service and protocol: what an organization may do, and how much of it.**
OpenEntitlement combines its own server and administrative console with OEREP, a remote evaluation protocol modeled on OFREP. Generic Python and TypeScript SDKs use the same contract; the server owns plans, overrides, grants, and resolution.

```python
from openentitlement import Catalog, FixedProvider, create_client, feature, integer

catalog = Catalog([feature("seats", "Seats", [integer("seat_max")])])
client = create_client(FixedProvider(catalog, {"seat_max": 40}), catalog)
assert client.get_limit("seat_max", {"organizationId": "globex"}) == 40
```

Install the Python runtime with `pip install openentitlement-sdk` (imports remain `openentitlement`). Start with the [ACME Workspace walkthrough](docs/guides/acme-workspace.md) for Workspaces, the Privilege Catalog, Groups, Tags, Tiers, variants, Organizations and user entitlements. It includes Pydantic `Privilege` models, JSON serialization and evaluation examples; TypeScript/Zod follows Python.

Run the [service and local demo](console/README.md), backed by memory or Postgres. SDKs also support embedded storage and a `FixedProvider` for self-hosted installs.

## What's here

| Path | What |
|---|---|
| [`website/`](website/README.md) | Public landing page and documentation, with Cloudflare static hosting |
| [`console/`](console/README.md) | Our entitlement server, OEREP API, and administrative web console |
| [`spec/`](spec/README.md) | Semantic specification and OEREP v1 [OpenAPI](spec/oerep.openapi.json) |
| [`spec/assets/gherkin/`](spec/assets/gherkin/README.md) | Conformance suite: 11 feature files, tagged by requirement and provider capability |
| [`sdk-python/`](sdk-python/README.md) | `openentitlement-sdk` (core requires only Pydantic; optional `[postgres]` extra) |
| [`sdk-js/`](sdk-js/README.md) | `@openentitlement/core` (one dependency, Zod; `/authoring` and optional `/postgres` entry points) |
| [`PRIOR_ART.md`](PRIOR_ART.md) | What exists, the vendor mapping table, where billing leaks, link check |
| [`ADR-0001.md`](ADR-0001.md) | Why an open protocol plus our own entitlement server |

See the [glossary](GLOSSARY.md) for shared domain and review terminology.

## The model in one screen

New authoring uses flat keys, a Privilege Catalog, one Group and multiple Tags, then Tiers → variants → Organizations → optional user exceptions. The compatibility SDK still uses its v1 Feature/Plan API. Keys are always flat (`seat_max`); dotted keys are not accepted.

- **Layers stay separate.** Authentication (401), RBAC (403), **entitlement (403 `entitlement_required` + `requiredPlan`)**, and feature flags (404). This spec covers only the entitlement layer.
- **Definitions in code, values as data.** Features and privileges (`seat_max`, `sso_enabled`, `report_retention`) are declared by the app. Plan values, overrides, and grants are runtime data, audited.
- **Plan** → a value per privilege. A trial is a *variant* of a plan. The payment channel never affects resolution.
- **Override** → *replaces* the plan value for an org, user, or resource. It is dated, needs a reason, and is bound to the plan family. It goes **stale, not deleted**, when the plan changes.
- **Grant** → *adds* quota (+500 API calls until Friday). It survives plan changes. Subject-scoped grants are personal allowances drawn before the shared pool.
- **`UNLIMITED`** is its own value (`{"unlimited": true}`), never `MAX_INT` or `null`.
- **Downgrades** gate new consumption only: decrements always pass, and nothing is hidden or deleted.
- **Errors fail closed** to the privilege default, with no upsell on `ERROR`.

## Status

`v0.1.0`, a draft. Both SDKs pass the full conformance suite on every provider for the capabilities it declares:

| Target | Python | TypeScript |
|---|---|---|
| in-memory | ✅ 110/110 | ✅ 110/110 |
| Postgres (16) | ✅ 110/110 | ✅ 110/110 |
| fixed provider | ✅ 6/6 | ✅ 6/6 |

OEREP v1 is implemented in both SDKs and the reference service, with real cross-language HTTP integration tests. Roadmap: add-ons and change events. See [spec/README.md](spec/README.md#roadmap).

## Project direction

[Vision](VISION.md), [shared glossary](GLOSSARY.md), [decisions and RFCs](docs/decisions.md), and [contributor workflows](docs/agents/workflows.md) record the long-term direction and distinguish accepted design from released protocol behavior.

## License

[Apache-2.0](LICENSE)
