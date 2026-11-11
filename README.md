<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/icon-dark.svg">
    <img src="assets/icon.svg" width="72" height="72" alt="OpenEntitlement logo: an O-shaped doorway whose door is the letter E">
  </picture>
</p>

<h1 align="center">OpenEntitlement</h1>

<p align="center">
  <strong>Entitlements you can explain.</strong><br>
  An open model, protocol and self-hostable service for what each customer may do, and how much of it.
</p>

<p align="center">
  <a href="https://openentitlement.dev/docs/quickstart/">Get started</a>
  &nbsp;·&nbsp;
  <a href="https://openentitlement.dev/docs/specification/">Specification</a>
  &nbsp;·&nbsp;
  <a href="https://openentitlement.dev">openentitlement.dev</a>
</p>

<br>

```sh
pip install openentitlement-sdk
```

```python
from openentitlement import Catalog, FixedProvider, create_client, feature, integer

catalog = Catalog([feature("seats", "Seats", [integer("seat_max")])])
client = create_client(FixedProvider(catalog, {"seat_max": 40}), catalog)
assert client.get_limit("seat_max", {"organizationId": "globex"}) == 40
```

## The idea

- **Privilege Catalog.** What your product allows or limits: booleans, integers or `UNLIMITED`, and string enums, under flat keys like `seat_max`.
- **Tiers.** Offers such as Basic and Pro. Their variants change only what differs from the Catalog.
- **Organizations.** Your customers. Each gets a variant, plus its own terms when a deal needs them.
- **Every value is explained.** A result says where it came from: Catalog default, Tier value, Organization override or environment restriction.

Your application asks through OEREP, an open remote evaluation protocol modeled on OFREP. The Python and TypeScript SDKs share one contract. The service owns the values and audits every change. Billing, roles and usage stay in your existing tools.

## Start

- **Learn the model:** the [ACME Workspace walkthrough](docs/guides/acme-workspace.md) covers Workspaces, the Privilege Catalog, Tiers, Organizations and user entitlements.
- **Run the service and console:** [`console/`](console/README.md), backed by memory or Postgres, with Docker.
- **Embed it:** the SDKs also run in-process, with embedded storage or a `FixedProvider`. The example above uses the SDK's v1 Feature/Plan compatibility API; new authoring uses the Privilege Catalog.

## Repository

| | |
|---|---|
| [`spec/`](spec/README.md) | Semantic specification, the OEREP v1 [OpenAPI](spec/oerep.openapi.json), and an 11-feature [conformance suite](spec/assets/gherkin/README.md) |
| [`sdk-python/`](sdk-python/README.md) | `openentitlement-sdk`: Pydantic is the only core dependency; optional `[postgres]` extra |
| [`sdk-js/`](sdk-js/README.md) | `@openentitlement/core`: Zod is the only dependency; `/authoring` and optional `/postgres` entry points |
| [`console/`](console/README.md) | The entitlement service, OEREP API and administrative console |
| [`website/`](website/README.md) | openentitlement.dev: landing page and documentation |

## Status

`v0.1.0`, a draft. OEREP v1 is implemented in both SDKs and the reference service, with cross-language HTTP integration tests. Both SDKs pass the conformance suite on every provider, for the capabilities each provider declares:

| Target | Python | TypeScript |
|---|---|---|
| in-memory | ✅ 110/110 | ✅ 110/110 |
| Postgres (16) | ✅ 110/110 | ✅ 110/110 |
| fixed provider | ✅ 6/6 | ✅ 6/6 |

Next on the [roadmap](spec/README.md#roadmap): add-ons and change events.

## Direction

[Vision](VISION.md) · [Glossary](GLOSSARY.md) · [Decisions and RFCs](docs/decisions.md) · [Visual language](docs/design/visual-language.md) · [Prior art](PRIOR_ART.md) · [ADR-0001](ADR-0001.md) · [Contributor workflows](docs/agents/workflows.md)

## License

[Apache-2.0](LICENSE)
