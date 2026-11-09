---
name: domain-modeling
description: Maintain OpenEntitlement domain language and relationships, including the glossary and architecture decisions. Use when terminology or ownership changes.
---
# Domain modeling

Adapted from Matt Pocock's domain-modeling workflow; see ../UPSTREAM.md.

Read the canonical GLOSSARY.md and relevant accepted ADR. Use the user's latest explicit decisions to resolve older vocabulary, and make the supersession explicit. Check code before calling behavior implemented. A mismatch between accepted authoring terms and OEREP v1 may require a compatibility adapter rather than a wire rename.

Keep glossary definitions short and free of implementation/workflow notes. Describe what the term is and distinguish confusable concepts. Maintain a single glossary; the website copy is generated from it. Do not add a second model-specific glossary.

Test relationships with concrete examples: one Group/multiple Tags; an Account in two Workspaces; an Organization on a Tier variant; an installed component with a denied commercial entitlement. Ask only unresolved domain choices.

Record an ADR only for a durable, non-obvious trade-off with real alternatives. Use the existing root ADR numbering; keep accepted historical records and mark specific superseded decisions rather than rewriting history. Put evolving schemas, compatibility mappings and rollout details in RFCs. Update docs/decisions.md and affected examples together.

No default naming, inferred unlimited value or vendor-specific concept may silently enlarge access. Cross-check TypeScript/Python validation and public JSON shape where the authoring model changes.
