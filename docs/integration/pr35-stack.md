# PR35 combined stack validation

## Merge-train refresh after PR40

PR40 shipped on `main` at `9a1c7bf6b1cf28f949ba26e65cf4fe4d8e5b6fed`.
PR38 is rebased onto that main at `6a0e51816256146411e23929dd59ec0ae8e5a9f3`;
PR39 is rebased onto PR38 at `da87b5c301d93c715e8e14e140e9a73e10703189`.
PR35 replays the complete integrated delta from the previous PR39 head to
`a4775b1757ef5a84f10191f0da581fb08b0c96bc` onto refreshed PR39, preserving
all runtime code and tests byte-for-byte. Only PRD status references and this
evidence note change. PR38 targets main; PR39 targets `feat/pydantic-core`;
PR35 targets `feat/zod-json-schema`. Remaining merge order: #38 → #39 → #35.
The PR bodies record the exact final heads.

The prior independent recheck remains evidence for the original PR38/PR39 heads
listed below; it is not an approval of the refreshed heads. Required exact-head CI
and code-owner review remain merge gates. No merge or deployment was performed.

## Refreshed integration validation

Re-run on 2026-11-10 in the existing managed worktree with a dedicated loopback
Postgres 17 container and separate Python, TypeScript and console databases:

| Check | Result |
|---|---|
| Python 3.11 and 3.12 full SDK/conformance | each 444 passed, 124 capability skips |
| TypeScript full SDK/conformance | 373 passed, 124 capability skips, 0 failed |
| Console full tests | 131 passed, 0 skipped on rerun |
| Generated schema freshness, Ruff (packages/conformance/tests/scripts), uv-lock-check, deptry | passed |
| SDK/console lint, typechecks, dependency checks; SDK/console builds | passed |
| Setup browser, authenticated Workspace browser, compiled Storybook browser | passed |
| Website diagnostics, build, links/anchors, diagram browser regressions | 0 errors/warnings/hints; 28 pages verified; light/dark and mobile/desktop diagrams passed |
| `git diff --check` | passed |

The first console test run on the empty disposable database hit a concurrent
schema-creation uniqueness error (`pg_type_typname_nsp_index`); rerunning the full
suite passed. No application code was changed. Local Node is 26.5.1 versus CI 24;
FastAPI reports the upstream Starlette/httpx deprecation warning. Runtime code,
fixtures and tests match the previous integrated head exactly. These local results
are implementation evidence, not an independent review or substitute for CI.

## Prior integration evidence (before rebase)

PR35 integrates PR39 `7f22f4d497b1c2ac08b81ec61d2390106092210e`, based on
PR38 `6062378ada1aa264d343173c21f1eda8dc0b2f18` and PR40
`67bd0f25bbba254d1deefa7c25583fe7cb65b226`. The previous PR35 head was
`571f459c749762d141eda3ab9bcc06231df10143`. The previous integration merge preserved all four histories;
PR35 targets `feat/zod-json-schema`. Its merge order was #40 → #38 → #39 → #35.
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
