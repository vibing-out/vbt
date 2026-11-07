# The factory: how a ticket moves

Two scripts move a ticket from `queued` to closed:

- `scripts/factory/dispatch.ts` does the routing, with no model. GitHub Actions runs one subcommand per event.
- `scripts/factory/build.ts` works one ticket, with Claude Code doing the thinking. `.github/workflows/build.yml` runs it.

## The flow

1. A person finishes writing the ticket (parent, blockers) and adds `queued`.
2. `dispatch.ts check` posts the "Context from earlier tickets" comment and adds `factory-ready`.
   If a blocker is still open, it adds `blocked` instead.
3. `build.ts` runs the stages in order, each as its own `claude -p` call:
   1. triage: is the ticket clear enough to build?
   2. spec: the plan and the acceptance criteria.
   3. implement: the code and its tests.
   4. review: findings go back to implement, for up to `MAX_REVIEW_ROUNDS` rounds.
4. `build.ts` runs the required checks and squash-merges the pull request into `epic/<k>`.
5. `dispatch.ts landed` runs in the same process. It logs the context, closes the ticket, unblocks the
   tickets that waited on it, and marks the epic pull request ready once its last ticket closes.

Any stage can stop with `needs-human`. A person answers on the issue and removes the label; `resume`
puts the ticket back through `check`.

## `dispatch.ts` subcommands

| Subcommand | Runs on | Does |
|---|---|---|
| `check <issue>` | `queued` added | Posts the context comment, labels `factory-ready` or `blocked` |
| `landed <pr>` | A merge into `epic/*` or `main` | Logs context; into `epic/*` also closes, unblocks and marks the epic ready |
| `unblock <issue>` | An issue closing | Re-checks the tickets it blocked |
| `context-check <pr>` | `epic/*` and `main` pull requests | Validates the `context-log` block in the body |
| `notify <issue>` | `needs-human` added | Posts the issue to the team Slack channel |
| `resume <issue>` | `needs-human` removed by a person | Re-queues the ticket with `check` |

## `build.ts`

    node scripts/factory/build.ts <issue> [--shadow]

`--shadow` works a ticket without `factory-ready`: a trial run on a ticket Warp isn't working, to compare
the runner with the Warp factory. Every other addressing rule still applies.

The stage prompts are `scripts/factory/prompts/<stage>.md`. GitHub starts no workflow for what
`GITHUB_TOKEN` does, so `build.ts` dispatches the checks, merges, and runs `landed` and `notify` itself.
