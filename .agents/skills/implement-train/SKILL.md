---
name: implement-train
description: "Run the work train for a spec: build its tickets one PR each, review with Codex, merge, and start the next until every ticket is done."
disable-model-invocation: true
---
# Implement train

Adapted from Matt Pocock's implement-spec workflow; see ../UPSTREAM.md.

You are the **conductor** of the train. You stay in the main thread and coordinate. Each ticket is built by an **implementer** in its own thread, worktree and pull request. The person who started the train has authorized you to merge its pull requests once the **gate** in step 4 holds.

The argument names the spec: a Linear project whose description is the spec, and whose issues are the tickets. Without one, ask which spec to run.

## Steps

1. **Load the graph.** Read the spec, every open ticket with its blocking links, and the decisions they cite (AGENTS.md, GLOSSARY.md, ADRs, RFCs). The tickets are a task graph. Done when you can name the **frontier**: every open ticket whose blockers are all Done and which has no unanswered question preventing implementation.
2. **Pick the base.** Spec tickets merge into the integration branch the spec names; create it from `main` if it is missing. The **closing ticket** (the one that merges the integration branch into `main`) and any ticket outside the spec target `main`. Done when the base exists on `origin`.
3. **Dispatch the frontier.** For each frontier ticket except the closing ticket, up to the parallel limit (two agents unless the person says otherwise; a running review counts as an agent), start an implementer with `delegate_task` (`isolation: "worktree"`, async) and the brief in [BRIEF.md](BRIEF.md). Move the ticket to In Progress. Done when every frontier ticket has an implementer or waits only on the limit.
4. **Gate.** When an implementer reports a completed PR, check GitHub yourself:
   - the pull request targets the base from step 2;
   - the latest Codex review comment says "OK to merge" for the current head SHA;
   - every required check passes on that head.

   **Questions take a separate path.** If an implementer reports a question that the spec and decision records cannot answer, park that ticket: record the question, the work it blocks and the implementer's recommendation as a comment on its Linear issue. Retain its branch/PR and completed work; parking is not Done and does not satisfy the merge gate. Release its agent slot and dispatch another unblocked frontier ticket within the same two-agent limit. Tickets depending on the parked ticket remain blocked; unrelated work continues.

   Collect open questions across tickets. When the unblocked frontier is empty or at a natural checkpoint (for example, an implementer handoff), ask the person in one numbered batch, with each ticket reference, question and recommendation. Do not wait for the batch's answers while independent work remains. **Done for a batch when** every currently open question is recorded on its issue and included in the numbered message. On each answer, record the decision on the issue and in any relevant decision document, unpark only the tickets whose blocking questions are answered, recompute the frontier and resume them from their preserved work. A resumed PR still goes through the same review and check gate at its current head. Halt the whole train for questions only when all remaining work needs an answer; running independent implementers continue.

   When any of the three gate conditions fails for a PR ready for review, send the implementer back with the step it still owes (waiting for CI, fixing a check, fixing findings, a new re-check) and wait for it again. Done when all three hold for the same head SHA.
5. **Merge.** `gh pr merge <number> --squash --admin --match-head-commit <head SHA>`. Move the ticket to Done. If the base is the integration branch, the next implementers start from its new tip.
6. **Record.** Anything the work revealed but did not finish becomes a new Linear ticket with its blocking links, so the graph stays the single list of remaining work. Report each merge to the person in one or two lines. Done when every follow-up is a ticket and the merge is reported.
7. **Repeat** from step 3 with the new frontier.
8. **Close the spec.** When only the ticket that merges the integration branch into `main` is left:
   1. run the `code-review` skill on the whole integration branch against `main`, and fix its findings through one more ticket;
   2. open the closing ticket's pull request from the integration branch into `main`, with the same Codex review loop as the brief (steps 7 and 8), and run it through the gate with `main` as its base; its merge moves it to Done;
   3. run Matt Pocock's `retro` skill on the train.

   Done when every spec ticket is Done and the integration branch is merged.

## Rules

- Ask the person only for a product decision the spec and decision records leave open, or for a step only a person can take (a sign-in, a secret, a paid service). Park only the affected ticket and batch its questions as in step 4; stop the whole train only when no independent work remains. Everything else the train decides from the documents. Handle secrets through the runner's secure input mechanism, never a public issue comment or question batch.
- Every ticket's documentation lands in its own pull request: the glossary, decision records, PRD.md statuses and run instructions. A merged ticket leaves the documents true.
- These question handoffs are ordinary Markdown instructions for both OpenAI and Anthropic runners; use the active session's supported reporting and question tools. They do not change the agent limit, review requirements or merge authorization.
- **Rotation.** Opus implements and Codex reviews. When Opus is out of quota, Codex implements and Antigravity (`gemini-3.8-flash`) reviews. When a reviewer is out of quota, the implementer waits and retries; the conductor may instead name another provider's model as reviewer, always one other than the implementer's model. The review comment title names the reviewer model, as in "Codex review (gpt-6.1-sol) of <short SHA>".
- The conductor coordinates and the implementer does the ticket's work, including review fixes; when it stops early without a blocking question, send it back to its remaining step. Parked tickets follow the question handoff in step 4.
