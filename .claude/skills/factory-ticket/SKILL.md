---
name: factory-ticket
description: Work a vbt ticket labeled `local` from a local Claude Code session, so the Warp factory reviews, verifies, and merges it into its epic. Use when asked to "take ticket #N" or "work the next local ticket".
---

# Work a local factory ticket

The Warp factory handles review, browser verification, auto-merge into the
epic branch, and starting the next ticket. You only implement.

1. **Pick and claim:** `gh issue list --label factory-ready --label local --search no:assignee --state open`.
   Take the one you were given, or the oldest. Claim it first with `gh issue edit <n> --add-assignee @me`. Never take one assigned to someone else.
2. **Check readiness:**
   ```
   gh api graphql -f query='{repository(owner:"vibing-out",name:"vbt"){issue(number:<n>){
     state parent{number state labels(first:10){nodes{name}} blockedBy(first:50){nodes{number state}}}
     blockedBy(first:50){nodes{number state parent{number state}}}}}}'
   ```
   Ready only if all of these hold:
   - The ticket has a parent with the `epic` label.
   - Every blocker in the same epic is closed.
   - Every blocker in another epic is closed and its epic is closed (shipped to `main`).
   - The epic's own blockers are all closed.

   If not, say which issue it waits on and stop. This mirrors the
   factory's `ticket-readiness` skill; change both together.
3. **Branch** from the epic. The dispatcher already synced it with `main` when it marked the ticket ready, and pushing to `epic/*` is blocked:
   ```
   git fetch origin && git switch -c task/T-NN-<slug> origin/epic/<k>
   ```
4. **Implement** to the ticket's acceptance criteria only. Write tests for
   each criterion; run lint, type check, and tests.
5. **Open the pull request:**
   ```
   gh pr create --base epic/<k> --label factory:vbt \
     --title "T-NN <ticket title>" --body "Ticket: #<n> ..."
   ```
   Use "Ticket: #<n>", not "Closes", and list each criterion with how it is
   met, plus the test results. End the body with the `context-log` block
   described in `CLAUDE.md`; check it with `node scripts/context.ts check < body.md`.
6. **Answer review.** The factory posts one review comment per round. Fix
   the findings and push; each push re-triggers review. After a clean
   review and a passing verification, the factory queues the merge. Do not
   merge it yourself.
