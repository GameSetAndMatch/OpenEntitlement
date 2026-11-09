# Project review: scope, reliability and maintainability

Source review dated November 9, 2026. This is a public engineering assessment, not an operational security audit or certification. Ratings describe follow-up priority for a reliable product, rather than a claim that a vulnerability was exploited. Hosted analytics, account details and private operational findings remain in the internal repository.

## Findings addressed in this work

| Priority | Weak spot and trigger | Change / verification |
| --- | --- | --- |
| P1 | Workspace evaluation omitted subject scope while the SDK/spec already exposed it. A customer could reasonably expect a user context to affect a decision. | User-scoped terms/grants, explicit capability gates, validated IDs and shared Organization/user inspection. Database tests cover both evaluation endpoints, scope isolation, roles, downgrades and persistence. |
| P1 | A green Python build was easy to mistake for a published package; publisher configuration drifted after a repository rename. | Separate publication repair PR: exact Trusted Publisher identity, approved `openentitlement-sdk` name, adapter dependency/import mapping and release guidance. Publication still requires a matching tested release and successful publish jobs. |
| P2 | Documentation mixed dotted keys, Feature/Plan authoring, flat Privileges and Workspace behavior. Python examples were secondary. | Canonical flat examples, separate compatibility guidance, Python-first ACME walkthrough covering the complete model, website links and package READMEs. No automatic stored-data renaming. |
| P2 | Type constraints were hand-maintained without a first-class validation-library interface. | Optional strict Pydantic and Zod authoring, shared browser/server Zod schemas, Python model/schema/roundtrip and cross-language tests. Runtime SDK imports retain no mandatory dependencies. |
| P2 | Storybook's runner enumerated only the original stories. New user stories could exist without running in CI. | Extend the compiled-story checks to include personal allowances and Cloud Pro locking, alongside a real authenticated browser flow. |

| P2 | CI had no per-job deadline or cancellation of superseded PR runs; a Storybook build stalled for over twenty minutes during this work. | Add 20-minute CI job limits and per-PR cancellation of superseded runs. Retry a cancelled stalled build once; diagnose repeated stalls rather than repeatedly paying for retries. |

## Remaining priorities

| Priority | Evidence / consequence | Focused next step |
| --- | --- | --- |
| P1 before hosted GA | `console/WORKSPACES.md` and `server/workspace/api.ts`: Workspace evaluation is separate from `/oerep/v1`. A generic SDK cannot transparently switch to it. | Implement a Workspace-key-authenticated OEREP adapter and run existing cross-language conformance tests. Explicitly map authoring values, status policy and scoped grants; do not rename one endpoint and assume compatibility. |
| P1 before large user directories | `server/workspace/store.ts`: one JSON document per Workspace, a 900 KB configuration cap, row locking and full before/after audit snapshots. Every user change copies state. | Move growing subject records to Workspace-scoped indexed rows with transactional revision/audit semantics. Benchmark Organization/user resolution and concurrent writes before choosing caches or infrastructure. Preserve isolation tests. |
| P1 before hosted GA | Workspace docs explicitly leave production identity provisioning, recovery and operational hardening incomplete. The local issuer is development-only. | Document and exercise production OIDC, backup/restore, migrations, secret/key rotation, administrator revocation and abuse/resource limits. Keep operational evidence private. No SOC 2 claim without assurance evidence. |
| P2 | `WorkspaceApp` uses broad `any` for session/audit/response payloads, and API handlers dispatch many sections centrally. New fields increase drift risk. | Introduce typed response DTOs and small endpoint modules as touched. Validate external response boundaries; do not rewrite the whole app to satisfy style alone. |
| P2 | Catalog keys are durable references across data and application checks. Changing built-in examples can strand old demo/custom database values. | Keep an explicit migration checklist and an old Catalog escape hatch; require operators to pin/provide their previous Catalog. Add a reviewed key-rename tool only when needed. |
| P2 | A personal integer allowance is not a monthly quota ledger. User exceptions can be mistaken for per-user usage accounting. | Keep counts/windows/idempotency in the app/metering integration. Advance RFC-0003 only after a real usage source and freshness semantics exist; never derive consumption from evaluation traffic. |
| P2 | Cloud service tiers are manually assigned by platform administrators. A label does not verify payment or entitlement to Enterprise scope. | Add a narrowly scoped billing adapter that writes verified service-capability facts with replay/idempotency tests. Keep it separate from customer-defined Tiers and the open protocol. |
| P3 | Optional providers are already separate distributions but share a monorepo/release cohort. Splitting repositories too early duplicates release work. | Keep packages separate and the monorepo for now. Use OpenFeature's core/contrib split as a reference when contribution volume merits independent ownership; measure maintenance cost first. |

## Review rules

Use the Vision, Glossary and accepted ADRs before expanding these areas. Reproduce failures with concrete scopes and release heads. Close findings only with behavior/tests or an explicit decision; a documentation warning alone does not implement missing functionality. Keep commercial comparisons as research, not claims of provider conformance.

References: [Vision](../../VISION.md), [decisions](../decisions.md), [user scope decision](../../ADR-0005.md), [ACME walkthrough](../guides/acme-workspace.md), [OpenFeature core](https://github.com/open-feature/python-sdk), [OpenFeature contrib](https://github.com/open-feature/python-sdk-contrib).
