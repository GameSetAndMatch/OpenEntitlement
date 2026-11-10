---
name: code-review
description: Review an OpenEntitlement PR or diff separately for Spec alignment and engineering Standards, including compatibility and validation evidence.
---
# Two-axis code review

Adapted from Matt Pocock's code-review workflow; see ../UPSTREAM.md.

Pin the PR head SHA and actual base/merge base. Read its final intent, relevant VISION/ADR/RFC requirements, CONTRIBUTING.md and any scoped instructions. For a stack, review each layer against its own base and record merge prerequisites; do not count inherited changes as that layer's implementation.

Perform two distinct passes. Use separate agents only when requested or explicitly appropriate under the session's delegation rules; otherwise keep two independent notes yourself.

**Spec:** missing behavior, incorrect behavior, unrequested scope, outdated terminology, and contradictions with accepted decisions. Distinguish released protocol requirements from preview authoring direction. Verify boolean-only restrictive environment semantics, Group/Tag cardinality, visibility, Workspace isolation and application-owned usage when touched.

**Standards:** correctness, typed validation, authenticated audit actors, data isolation, compatibility, understandable UI and meaningful tests. Consider duplication, unclear names, misplaced responsibilities and speculative abstractions as judgement calls—not automatic defects. Do not repeat lint findings as architectural conclusions.

For each actionable finding give severity, file/line, concrete trigger, effect and a focused fix/test. Keep Spec and Standards conclusions separate; one pass cannot cancel a finding in the other. Verify existing PR comments and answer with evidence. Fix authorized defects, rerun appropriate checks and review the resulting head.

Post “OK to merge” only when the final head's checks pass and material findings are resolved. Include both pass outcomes, limitations, and required stack order. Do not claim independent approval when reviewing the author's own PR; a recommendation does not merge or deploy it. If checks or a decision are still pending, say what remains instead.
