# PR35 combined stack validation

PR35 integrates PR39 `7f22f4d497b1c2ac08b81ec61d2390106092210e`, based on
PR38 `6062378ada1aa264d343173c21f1eda8dc0b2f18` and PR40
`67bd0f25bbba254d1deefa7c25583fe7cb65b226`. The previous PR35 head was
`571f459c749762d141eda3ab9bcc06231df10143`. A merge preserves all four histories;
PR35 targets `feat/zod-json-schema`. Merge order remains #40 → #38 → #39 → #35.
The PR body records the resulting exact integration head (a commit cannot contain
its own SHA).

Conflict resolution retains cache provenance/freshness and failed-refresh eviction,
read-only transport authority, Pydantic keyword construction, strict typed values,
camelCase serialization, optional Catalog omission and planValue presence. PR39's
schema, Zod validators and full-string flat identifiers are retained. New cache
context construction uses keyword arguments.

Validated locally on 2026-11-10 using disposable Postgres 17 databases bound only
to loopback, with no production configuration or user `.env` files:

| Command | Result |
|---|---|
| `uv sync --locked --python 3.12`; `OE_PG_DSN=… uv run pytest -q` | 444 passed, 124 skipped |
| `OE_PG_DSN=… uv run --python 3.11 pytest -q` | 444 passed, 124 skipped |
| `uv run pytest -q tests/test_remote.py` after keyword updates | 39 passed |
| `uv run python scripts/export_schemas.py --check` | passed |
| `uv run ruff check packages conformance tests`; `uv run ruff check scripts tests/test_catalog_contract.py` | passed |
| pre-commit `uv-lock-check`, `deptry` | passed |
| SDK `OE_PG_DSN=… npm test` | 373 passed, 124 skipped, 0 failed |
| `node sdk-js/scripts/check-quality.mjs` | SDK/console lint, typecheck and dependency checks passed |
| SDK `npm run build` | passed |
| Console `OE_PG_DSN=… npm test`; `npm run build` | 131 passed, 0 skipped; build passed |
| Console `npm run test:setup`, `npm run build:storybook`, `npm run test:storybook` | passed |
| Console `OE_PG_DSN=… npm run test:workspaces` | passed, including nested Groups/Tags and Workspace isolation |
| Root `npm run check`; `npm run build` | zero diagnostics; 28 pages; local links/anchors verified |
| `git diff --check` | passed |

The 124 skips are capability-based conformance cases. Local Node was 26.5.1;
CI uses Node 24. FastAPI emitted an upstream Starlette/httpx deprecation warning;
the browser development issuer warned about Node support and its development-only
configuration. The first Workspace browser invocation lacked the explicit disposable
DSN and stopped before accessing a database; the corrected invocation passed.
Root dependency installation reported three low-severity advisories; no dependency
upgrade is included in this integration.

This is implementation validation, not independent review or approval. Exact-head
CI and code-owner approval remain required. No merge, deployment or production
credential migration is authorized by this evidence.
