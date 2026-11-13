---
name: implement-train
description: Run the work train for a spec: build its tickets one PR each, review with Codex, merge, and start the next until every ticket is done.
disable-model-invocation: true
---
# Implement train

Adapted from Matt Pocock's implement-spec workflow; see ../UPSTREAM.md.

You are the **conductor** of the train. You stay in the main thread and coordinate. Each ticket is built by an **implementer** in its own thread, worktree and pull request. The person who started the train has authorized you to merge its pull requests once the **gate** in step 4 holds.

The argument names the spec: a Linear project whose description is the spec, and whose issues are the tickets. Without one, ask which spec to run.

## Steps

1. **Load the graph.** Read the spec, every open ticket with its blocking links, and the decisions they cite (AGENTS.md, GLOSSARY.md, ADRs, RFCs). The tickets are a task graph. Done when you can name the **frontier**: every open ticket whose blockers are all Done.
2. **Pick the base.** Spec tickets merge into the integration branch the spec names; create it from `main` if it is missing. A ticket outside the spec targets `main`. Done when the base exists on `origin`.
3. **Dispatch the frontier.** For each frontier ticket, up to the parallel limit (two agents unless the person says otherwise), start an implementer with `delegate_task` (`isolation: "worktree"`, async) and the brief in [BRIEF.md](BRIEF.md). Move the ticket to In Progress. Done when every frontier ticket has an implementer or waits only on the limit.
4. **Gate.** When an implementer reports back, check GitHub yourself:
   - the pull request targets the base from step 2;
   - the latest Codex review comment says "OK to merge" for the current head SHA;
   - every required check passes on that head.

   When any of these fails, send the implementer back with the step it still owes (waiting for CI, fixing a check, fixing findings, a new re-check) and wait for it again. Done when all three hold for the same head SHA.
5. **Merge.** `gh pr merge <number> --squash --admin --match-head-commit <head SHA>`. Move the ticket to Done. If the base is the integration branch, the next implementers start from its new tip.
6. **Record.** Anything the work revealed but did not finish becomes a new Linear ticket with its blocking links, so the graph stays the single list of remaining work. Report each merge to the person in one or two lines. Done when every follow-up is a ticket and the merge is reported.
7. **Repeat** from step 3 with the new frontier.
8. **Close the spec.** When only the ticket that merges the integration branch into `main` is left:
   1. run the `code-review` skill on the whole integration branch against `main`, and fix its findings through one more ticket;
   2. run the final ticket through the same gate, which merges the integration branch into `main`;
   3. run Matt Pocock's `retro` skill on the train.

   Done when every spec ticket is Done and the integration branch is merged.

## Rules

- Stop and ask the person only for a product decision the spec and decision records leave open, or for a step only a person can take (a sign-in, a secret, a paid service). Everything else the train decides from the documents.
- Every ticket's documentation lands in its own pull request: the glossary, decision records, PRD.md statuses and run instructions. A merged ticket leaves the documents true.
- The conductor coordinates and the implementer does the ticket's work, including review fixes; when it stops early, send it back to its remaining step.
