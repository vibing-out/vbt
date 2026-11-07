# Project State

Changes rarely: architecture, ownership and who coordinates. Ticket status lives on the GitHub issue and the Projects board, and decisions live in the context log. Read this at the start of every session.

## What we're building

Verifiable Ballot Tracking (VBT): a public tracker that follows each ballot from cast to certified, with proof at every stage and no voter identity. Full brief and locked interfaces: the team playbook.

## Who coordinates

| Role | Who | Does |
|---|---|---|
| **Coordinator session** | `<Shawn's or Austin's>` Claude session, chosen at kickoff | Runs the 9:00 ticket creation once, and sends tasks to the factory by hand only if dispatch breaks. Anyone can create single tickets |
| Local workers | Any Claude or Codex session on either laptop | Work only `local` tickets assigned to their own human |
| Approvers | Shawn or Austin | Approve epic pull requests into `main` |

## Ownership

Agents read this to stay in their own area. Shared interfaces change only in their own small pull request, merged first, with the decision in its `context-log` block.

| Area | Lead | Paths |
|---|---|---|
| Factory, pipeline, CI, deploys | Shawn | `.github/`, `scripts/factory/`, `.claude/` |
| Data layer (schema, RLS, auth, both Supabase projects) | Austin | `supabase/`, `packages/events/` |
| Design system and UI | Austin | `packages/ui/`, `apps/web/` (styling) |
| Domain and crypto | Shared | `packages/domain/`, `packages/crypto/` |
| Tools (simulator, receipts, verifier), tests | Shared | `tools/`, `tests/` |

## Live URLs

- Production:
- Epic previews: on each epic pull request
- Factory dashboard: https://platform.warp.dev/5UtMcqD5xE2zDbegRaz6mi/dashboard

## Demo script (5 minutes)

Use the playbook's demo plan, drafted by T-14.
