# Shared contributor workflows

AGENTS.md is the instruction entry point for both Anthropic and OpenAI agents. The shared local skills are ordinary Markdown files under `.agents/skills/`; no vendor-specific Skill tool, plugin installation, global settings or duplicated CLAUDE.md is required. Native command-menu discovery depends on the runner; asking an agent to read a named repository skill works through AGENTS.md.

The repository uses GitHub PRs/issues and local ADR/RFC files. No external ticket, label, email or vendor account should be created merely by running a workflow. Use the existing user-authorized request surface.

## Select the record

- **VISION.md:** purpose, durable product direction and non-goals.
- **GLOSSARY.md:** short definitions only; website copy is generated.
- **ADR:** a settled, non-obvious durable trade-off. Keep root sequential numbering and explicit supersession.
- **RFC:** a contract/rollout proposal or authoring specification whose compatibility status must be explicit.
- **Research spike:** sourced facts, hypotheses and unknowns. It is not proof of a working connector.
- **PR:** the actual change, final behavior, validation and unresolved limitations.

Use grill-with-docs for a real open choice, domain-modeling for vocabulary/relationship changes, and code-review for separate Spec/Standards findings. These are adaptations of Matt Pocock's workflows with pinned attribution in `.agents/skills/UPSTREAM.md`. They preserve developer/user control and do not require ritual confirmation or automatic delegation.

## Review result

A useful review states the base and head SHA, Spec outcome, Standards outcome, actionable findings and validation limits. After fixes, review the new head. “OK to merge” means the material findings are addressed and that head's required checks passed, with stack prerequisites stated. It is not an independent author approval, a deployment decision, a compliance attestation or permission to merge automatically.

Prefer updating the original comment/thread with evidence over treating a status note as proof. Keep product UI and public end-user documentation focused on the product, while contributor workflow material stays here.
