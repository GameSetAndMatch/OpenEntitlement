# Changelog

Notable changes to OpenEntitlement. Dates are UTC. The project is a draft (`v0.1.0`); nothing below has been released to a package registry yet.

## 2026-11-11 — Design rework and analytics review

### Why

We asked for a design pass in the spirit of Jony Ive: reduce until only what matters remains, let type and space carry hierarchy, and show the real product rather than decoration, without borrowing Apple's identity. The same pass applied an earlier product rule everywhere: **one way to do each thing, one simple step at a time.** PostHog data from openentitlement.dev then shaped the final landing page.

Every PR was reviewed by an independent OpenAI Codex reviewer (GPT-6.1 Sol, high reasoning). All findings were fixed, with regression tests, before merging.

### Contract: negative integer values ([#46](https://github.com/open-entitlement/OpenEntitlement/pull/46))

- An integer Privilege's default, minimum, maximum and Tier values may be any safe integer, −(2^53−1) to 2^53−1. An absent minimum still means 0. Usage (`current`) and the requested amount (`need`) stay non-negative.
- The change covers the Pydantic and Zod models, the generated JSON Schema, the OEREP v1 `Value` schema, spec Requirement 1.5.6, both SDKs, the service and the conformance fixtures.
- **From review:**
  - Remote decoding accepts negative bases with grants.
  - Personal grants can never allow more than the resolved value.
  - Python enforces the full safe-integer range, like TypeScript.
  - The standalone adapter rejects explicit bounds instead of dropping them.

### Console: one way to do each thing ([#47](https://github.com/open-entitlement/OpenEntitlement/pull/47))

- **Privilege form:**
  - The sections read Basics, then Value, then Organize (optional). Group and Tags come last because they never change evaluation.
  - Keys and IDs are filled from titles (`Maximum Exports` becomes `maximum_exports`).
  - Enum choices are a numbered list: Enter adds a row, Backspace removes an empty one, and pasting several lines adds one row each.
  - Integer bounds are free, including negative values.
  - The environment variable field has no suggested name.
- **Group picker:** Groups are a Finder-like folder tree, and "+" creates a nested Group in place. The same picker chooses a Group's parent.
- **Removed duplicate paths:**
  - "Create group" and "Create variant"
  - the sidebar "Create workspace"
  - the breadcrumb bar and the setup stepper
  - the refresh buttons (pages reload when the window regains focus)
  - "Copy YAML"
  - example placeholders
- **One thing at a time:** each empty state holds the single next action, and an open form replaces the list.
- **Guardrails:**
  - `FormField` and `Check` primitives, with hints announced through `aria-describedby`.
  - [`console/web/UI-GUIDELINES.md`](console/web/UI-GUIDELINES.md).
  - An automated form-layout check at 1280px, 390px and 360px.
- **From review:**
  - The Catalog shows one form at a time.
  - The choice list validates the cleaned list, lengths and capacity.
  - Group IDs stay within 80 characters.
  - Workspace pages reload on focus without losing drafts.
  - Settings ignores out-of-order responses.

### Visual language ([#48](https://github.com/open-entitlement/OpenEntitlement/pull/48))

- [`docs/design/visual-language.md`](docs/design/visual-language.md) sets the principles:
  - one teal accent, used for intent
  - type-led hierarchy
  - hairlines instead of boxes
  - space as a material
  - honest content
  - light and dark as equals
  - one shadow
  - 160ms motion
- `console/web/src/design.css` adds the tokens and the visual layer:
  - capsule buttons
  - calm fields with a focus halo
  - 16px hairline panels
  - fill-less tables
  - a quiet sidebar
  - inverse toasts, one at a time
- Every hard-coded console color is now a token, so dark mode works everywhere through `prefers-color-scheme`.
- **From review:**
  - Text tokens reach 4.5:1 and field borders 3:1 in both themes, enforced by `console/test/design-tokens.test.ts`.
  - Three corrupted `white-space` rules are restored.
  - The active navigation item uses the accent.

### Landing page ([#49](https://github.com/open-entitlement/OpenEntitlement/pull/49))

- **Hero:** centered, "Entitlements you can explain.", with one sentence, one primary action and one text link.
- **Three scenes:** "Define what you offer.", "Package it into Tiers." and "Explain every exception." Each shows the real console Catalog, Tier values and resolver on a floating surface, rendered without JavaScript.
- **Code:** a three-line example, "One question from your application.", then one closing call to action.
- **Removed:** the gray frames, per-scene links, the collapsed "How it works" box and the link cards.
- **Docs site:** Starlight uses the same tokens, with a quiet current page in the sidebar.

### README ([#50](https://github.com/open-entitlement/OpenEntitlement/pull/50))

- The README leads with the promise, install and code, then explains the model in four points.
- The repository table and conformance status are compact. The detailed model rules now live only in the specification.
- Conformance counts are corrected to what the suites run: 112/112 on in-memory and on Postgres 17, and 6/6 on the fixed provider, in both SDKs.

### PostHog analysis

**Data.** Project 724077, 30 days to 2026-11-11: 6 visitors, 33 pageviews, all on openentitlement.dev. The sample is small, so treat these as signals, not conclusions.

| Finding | Evidence | Action |
|---|---|---|
| The homepage call to action was invisible to analytics | `cta_clicked` had **0** events. No element carried `data-ph-cta`, so the acquisition funnel could not see "Get started". | Every homepage action now carries a stable name set in markup: `hero_get_started`, `hero_specification`, `scene_*`, `close_get_started` and `close_github`. Hero names come from Starlight frontmatter `attrs`, never labels, so copy changes keep their history. |
| Visitors expected the product screens to be clickable | **17** dead clicks, nearly all on the homepage scenes (the Catalog, its tag filter, the Tier screen). | Each product screen is now the one link to its docs page, tracked as `scene_catalog`, `scene_tiers` and `scene_exception`. |
| People looked for an explanation | "How it works" was the most-clicked labeled element on the homepage (**4** clicks). | The scenes now explain the model in place, with a heading and one sentence each, and lead to the docs. |
| Spec pages shifted while loading | CLS **0.24** on `/specification/03-resolution/` and **0.09** on `01-data-model`. Everything else was about 0. | Diagram images get width and height from their SVG viewBox, so the browser reserves their space. |
| The homepage loads quickly | Homepage LCP averaged about **0.57 s**, docs about 0.2 s. INP is negligible. | None. |
| Nobody copied code or left for GitHub, Docker, PyPI or npm yet | `docs_code_copied` and `outbound_link_clicked` had **0** events. The selectors match the real markup. | None. The volume is too low to judge. |
| The console sends no activation data | No server or console events. No hosted console runs with `OE_POSTHOG_KEY`. | Set `OE_POSTHOG_KEY` on the hosted console to feed the activation funnel. |

**Dashboards.** The [website acquisition dashboard](https://us.posthog.com/project/724077/dashboard/2328692) gains three panels:
- homepage conversion: homepage, then a call to action, then the quickstart, within one day
- calls to action by name
- dead clicks by page

**Tooling.** The PostHog MCP server is installed (`npx @posthog/wizard mcp add`) for Claude Code, Claude Desktop/Web, ChatGPT, Codex and VS Code, so later sessions can query this data directly.
