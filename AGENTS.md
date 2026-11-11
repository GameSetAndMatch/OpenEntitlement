# Working on OpenEntitlement

Use this file with any coding model. Current user instructions take precedence over repository workflow guidance.

## Context and language

For product/model changes, read [VISION.md](VISION.md), [GLOSSARY.md](GLOSSARY.md) and the relevant entries in [docs/decisions.md](docs/decisions.md). Track features and their delivery status in [PRD.md](PRD.md); update it in the PR that changes a status. Read only the ADR/RFC needed for the task. Distinguish accepted direction, a proposal, implemented preview behavior and released normative contracts. Do not resolve a conflict by silently changing scope or protocol semantics.

Keep the application-facing SDK/protocol portable across providers. Preferred authoring terms are Privilege Catalog, Privilege, Group, Tag, Tier, Tier variant, Organization and Workspace. Preserve documented OEREP v1 compatibility names behind explicit adapters rather than gratuitously renaming wire fields.

Boolean environment prerequisites can only restrict access and cannot bind integers/strings. Hidden values still evaluate; read-only values use defaults. One Privilege has at most one Group and multiple Tags. Usage belongs to the calling application or metering integration; missing dashboard usage is unknown, not zero.

## Shared skills

Read the relevant repository-local SKILL.md directly; these workflows require no model-specific tools:

- [grill-with-docs](.agents/skills/grill-with-docs/SKILL.md): genuinely unresolved requirements and durable decisions.
- [domain-modeling](.agents/skills/domain-modeling/SKILL.md): terminology, relationships, glossary and ADR changes.
- [code-review](.agents/skills/code-review/SKILL.md): separate Spec and Standards review, with evidence.

The adaptations are pinned and attributed in [.agents/skills/UPSTREAM.md](.agents/skills/UPSTREAM.md). Reuse decisions already made; do not repeatedly interview the user or require a blanket confirmation for authorized reversible work. Do not start additional agents unless requested by the user or applicable workflow instructions.

## Implementation and validation

Use existing components and typed validation before adding abstractions. Maintain Workspace isolation and actual authenticated audit actors. Read-only evaluation must not allocate external licenses, charge payments or consume application quota. Avoid claims of certification, production readiness or vendor compatibility without evidence.

Do not read, commit or print credentials or user .env files. Keep private operational/security/commercial findings out of public product documentation. Install integrations may expose only explicitly selected non-secret configuration.

Run checks relevant to the change and report exact results/limits. Service changes use console typechecks and tests; UI changes follow [console/web/UI-GUIDELINES.md](console/web/UI-GUIDELINES.md) and use reusable component stories and meaningful Playwright regressions. SDK/transport changes need shared conformance coverage. Use the repository's CI commands as the source for current verification; documentation-only changes usually need link/format checks and relevant website diagnostics, not unrelated suites.

## Pull requests

Keep PRs focused and opened early when requested. Explain observable behavior, compatibility, validation and material limitations. Pin review findings to the head SHA and correct stack base. Update the title/body when scope changes. Record resolved findings and their tests; do not resolve unanswered threads or manufacture an independent approval of your own PR.

Use “OK to merge” only after the reviewed head's required checks pass and material findings are addressed. Include reasons and stack/merge prerequisites. This is a recommendation, not authorization to merge or deploy.
