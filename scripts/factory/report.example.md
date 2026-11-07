### What was checked
| Criterion | Result | Evidence |
|---|---|---|
| 1. Public tables and views don't reveal cast order | pass | `ballots` and `ballot_events` moved to `private` (`supabase/migrations/20261107200000_private_base_tables.sql`); tests "ballot_public comes back ordered by ciphertext hash, not in cast order" and "ballots and ballot_events live in private, and no exposed schema has a relation by those names" (`supabase/tests/public-surface.test.ts`) |
| 2. Public views use the caller's grants and RLS | pass | views recreated with `security_invoker` and `security_barrier` (`20261107190000_public_surface_fixes.sql`); tests "ballot_event_public uses the caller's column grants" and "ballot_event_public applies the caller's RLS" |
| 3. Event hashes are publicly readable | pass | `prev_hash` and `hash` granted; tests "recomputes every seeded CAST event hash from public data" and "follows a ballot's chain" |
| 8. Publishing a stage record is an insert | pass | `published_at not null default now()`; tests "an unpublished (null published_at) stage record is rejected" and "the insert sets published_at to the transaction time" |
| context-log block lists every resolution | pass | 12 decisions and 4 corrections in the body; `node scripts/context.ts check` passes in the `context-check` job |

### Tests
- CI `check` job on the head commit: lint pass, typecheck pass, `pnpm test`: ui 1 passed, domain 111 passed, scripts 30 passed, web 22 passed, supabase 176 passed, 0 failed; Playwright e2e 2 passed.
- New or changed tests: 21 in `supabase/tests/public-surface.test.ts` (cast-order, private schema, grants, hash chain, `published_at`), 1 in `public-access.test.ts` (stage records readable only once published), 1 in `schema.test.ts` (no identity-like column in `public` or `private`).

### QA performed
- Read both migrations top to bottom against the 8 resolutions in the ticket's follow-up comment.
- Row-level security and grant probes, as `anon` and `authenticated`: base tables unreachable through the Data API, views readable, no column grant on `occurred_at`.
- Edge cases: a stage record inserted without `published_at`, an explicit null `published_at`, writing `occurred_on` directly.
- Vercel preview: Not run: this pull request changes only the database, and the preview has no page that reads these views yet.

### Security and locked interfaces
- No voter identity, cast time or secret is readable by `anon` or `authenticated` (identity deny-list test).
- Locked table names and columns are unchanged; moving them to `private` is not a locked-interface change (decision recorded).
- No change outside Austin's data-layer area; the CI workflow ownership is an approver note.

### Findings
#### Unambiguous fixes
1. [high, fixed] Base tables were still readable in cast order through the `public` schema. Fixed in round 1 by moving them to `private`.
2. [low, fixed] The context-log block was missing resolutions. Fixed in round 1.

#### Judgment calls for a human
none

### Decisions
{"text": "Moving ballots and ballot_events to private keeps the locked table names and columns, so it is not a locked-interface change (docs/locked-interfaces.md)."}

### Summary
- Closes T-04's public-surface gaps: no cast order, time or identity is readable by the public, and anyone can recompute the hash chain.
- High confidence: each resolution maps to a migration line and a named test, and 340 unit and database tests plus 2 Playwright tests passed in CI with 0 failures.
- Not exercised in a browser: no page reads these views yet, so the epic's verification should include one.
- For the epic approver: Shawn confirms the CI workflow change (resolution 5), and the Indiana time zone stays for the demo (resolution 7).
