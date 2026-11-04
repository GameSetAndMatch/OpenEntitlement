---
title: Contributing
description: Learn about contributing in OpenEntitlement.
---

OpenEntitlement is experimental and Apache-2.0 licensed. Start with the [glossary](/reference/glossary/) and numbered specification. Raise a concrete issue or pull request in the [GitHub repository](https://github.com/GameSetAndMatch/openentitlement).

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

Use an ADR for an architectural decision that needs durable context. An RFC is a proposal for discussion, not a label that every bug fix needs.

## Website

From the repository root, `npm ci && npm run build` builds this website. Specification pages and the glossary are generated from canonical repository files at build time. Edit `spec/sections/` and `GLOSSARY.md`, not the generated website copies.
