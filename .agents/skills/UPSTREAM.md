# Shared skill provenance

Adapted from [Matt Pocock's skills](https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d), revision `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`, reviewed 2026-11-09. Upstream MIT terms are preserved in [LICENSE.mattpocock](LICENSE.mattpocock). These are local adaptations, not an official upstream distribution or endorsement.

Sources: `skills/engineering/code-review`, `skills/engineering/domain-modeling`, `skills/engineering/grill-with-docs`, and `skills/productivity/grilling`. The setup skill informed repository layout; no automatic issue creation, label changes, plugins, hooks or accounts were configured.

Changes: known decisions replace repeated interviews; existing root ADR/glossary layout is retained; Spec and Standards are still separate; delegation and authorization follow the active session; provider-specific Skill-tool calls were replaced with direct Markdown workflows.

AGENTS.md is the shared entry point for Anthropic and OpenAI agents. Each skill is ordinary SKILL.md with name/description frontmatter. Native skill-menu discovery depends on the runner's supported project locations; agents can always read these paths through AGENTS.md. No duplicate CLAUDE.md or model-specific workflow copy is required.

To update, review upstream differences against this pinned revision and preserve OpenEntitlement decisions. Do not overwrite local adaptations with an unreviewed global installer update.
