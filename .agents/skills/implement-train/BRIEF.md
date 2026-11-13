# Implementer brief

The conductor fills in `<ticket>`, `<base>` and `<branch>` and sends this as the implementer's task. Give pointers to the ticket, spec and decisions, never copies: they are the source of truth.

---

Implement Linear ticket `<ticket>` for OpenEntitlement as one pull request into `<base>`, on branch `<branch>`.

Read first: the ticket, the spec (its Linear project's description), AGENTS.md, GLOSSARY.md and the decision records the ticket cites. The test seams the spec lists are already approved; build tests only at those seams.

**Question handoff (at any step):** If a question blocks the ticket and the ticket/spec/decision records do not answer it, report it to the conductor and finish this run instead of waiting for the person. Include the ticket reference, a concise question and recommendation, what work depends on the answer, completed work, branch/PR/head if any, and checks run or still owed. Do not invent a product decision or mark the ticket Done. The conductor records the question on the Linear issue, parks the ticket, dispatches other unblocked work within the two-agent limit, and asks the person one numbered batch at a checkpoint or when the unblocked frontier is empty. Answers are recorded and unpark the affected tickets; resume from preserved work and complete every remaining review/check gate.

This handoff applies in OpenAI and Anthropic runners using the active session's reporting tools. It is the exception to the completion requirement in step 7 and the PR-only final line below: if no PR exists, finish with `Parked <ticket>: <question>; recommendation <recommendation>; work <branch/head and remaining steps>`.

1. Base your worktree on `origin/<base>`, resetting onto it if needed.
2. Build it test-first with the `tdd` skill: one red test, then the code that turns it green, one vertical slice at a time. Typecheck and run single test files as you go, and the full suite at the end. Matt Pocock's `implement` skill describes this loop; follow its steps directly.
3. Review your own diff with the `code-review` skill (Spec and Standards) and fix what it finds.
4. Keep the documents true in the same pull request with the `domain-modeling` skill: glossary terms, implementation notes on decision records, PRD.md status and run instructions. A new product decision goes back to the conductor as a question.
5. Merge the latest `origin/<base>` into your branch and rerun the checks.
6. Push and open the pull request against `<base>`. Write its body with Matt Pocock's `pr` skill, reference the ticket, and end it with the attribution line the session gives you. Commit messages end with the session's co-author line.
7. Wait for CI in this same turn (`gh pr checks <number> --watch`) and fix every failure. Your turn ends only after step 8.
8. Get the Codex review. Call `orchestrator_capabilities` once, then `delegate_task` with target `{providerInstanceId: "codex", model: "gpt-6.1-sol", options: {reasoningEffort: "high"}}`, `role: "review"`, `isolation: "worktree"`, `mode: "wait"`. Ask the reviewer to:
   - review the pull request at its head SHA with `.agents/skills/code-review/SKILL.md`, running the checks;
   - post one comment itself with `gh pr comment`, titled "Codex review (gpt-6.1-sol) of <short SHA>", listing findings as must-fix, should-fix or nit (each with file:line, a failure scenario and a fix), the checks with exact results, and a verdict of "OK to merge" or "changes needed";
   - make no commits, pushes, merges or approvals.

   Fix every must-fix and should-fix, push, wait for CI again, and ask a new reviewer for a re-check that verifies each finding at the new head and posts its own comment. Repeat until the verdict is "OK to merge" at the current head with every check passing.
9. Leave the merge to the conductor.

Never read, print or commit credentials or `.env` files.

Finish with exactly one line: `PR <full URL>, head <SHA>, checks and reviews <state>.`
