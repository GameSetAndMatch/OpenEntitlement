---
title: Contributing
description: Run conformance checks and propose changes to entitlement behavior.
---

OpenEntitlement is experimental and Apache-2.0 licensed. Start with the [glossary](/reference/glossary/) and numbered specification. Raise a concrete issue or pull request in the [GitHub repository](https://github.com/open-entitlement/OpenEntitlement).

## Run the checks

```sh
# TypeScript SDK
cd sdk-js
npm ci
npm run typecheck
npm test
npm run build
```

```sh
# Python SDK
cd sdk-python
uv sync
uv run ruff check packages
uv run pytest -q
```

```sh
# Service and console
cd console
npm ci
npm run typecheck
npm test
npm run build
```

For Postgres conformance, set `OE_PG_DSN` to a dedicated test database. The suites reset shared fixtures: run the Python, TypeScript, and service database suites sequentially when they share a database. They must not point to production data.

## Changes to the contract

A behavioral fix should include a regression through the public SDK or HTTP boundary. Shared Gherkin scenarios keep implementations aligned. A new contract should state its requirements and cross-language behavior explicitly.

For a proposed semantic change, describe a concrete example, the expected resolution, and compatibility with existing clients. Keep implementations in both languages aligned with the numbered requirements.
