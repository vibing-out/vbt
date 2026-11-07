Claude review

CLAUDE_MODELS=claude-opus-5-5,claude-haiku-5-5 AUTH=subscription-oauth (API keys unset)
usage: input_tokens 20, cache_creation_input_tokens 90264, cache_read_input_tokens 618943, output_tokens 13652 (thinking 5784); total_cost_usd 1.1474808
REPORT_CHECK: passed on first check (no repair pass needed)

### What was checked
| Criterion | Result | Evidence |
|---|---|---|
| 1. An unauthenticated or single-factor session gets 403 on every official endpoint | pass | `apps/web/lib/require-role.ts:665-707` refuses with the same 403 when the env is missing, the token is missing or malformed, the signature is bad or the token expired (via `getClaims`), `aal !== "aal2"`, the role is not `authenticated` or the user is anonymous, the grant lookup fails or returns anything other than exactly one valid row, the role is not allowed, or the target is out of scope. Tests: `require-role.test.ts` "AC1: …" describe (around 20 cases, including "a single-factor session is refused by requireRole itself, even if RLS returned the grant"), `whoami/route.test.ts` "AC1: without signing in, with a garbage token or with a single-factor session: 403", e2e `official-auth.spec.ts` @smoke, and the static guard `official-routes.test.ts` "every exported handler calls requireRole". DB layer: `official-roles.test.ts` "a single-factor or incomplete session (%s) reads 0 rows" |
| 2. A poll worker can't act outside their precinct | pass | `packages/domain/src/official.ts:191-201` (`officialMayActOn`); a 21-cell role×target matrix in `official.test.ts`; the 16-row table in `require-role.test.ts` "AC2: …"; `whoami/route.test.ts` "AC2: the poll worker passes for their precinct and is refused elsewhere". The RLS test "an aal2 official cannot change grants" stops a poll worker from widening their own scope. Only the probe route exists, so no write endpoint enforces this yet |
| 3. The seeded demo accounts can sign in on a preview deploy | unverified | `apps/web/e2e/demo-officials.spec.ts` skips without `PLAYWRIGHT_BASE_URL` and `DEMO_*`. In CI e2e, 3 tests passed, which matches smoke ×2 plus official-auth ×1, so all 3 demo tests were skipped. The PR body says the seed hasn't been run. The preview is behind Vercel SSO (fetch got a 302 to `vercel.com/sso-api`), and the spec sends no protection-bypass header. Only the seed flow is unit-tested (`supabase/tests/seed-demo-officials.test.ts`, against a fake project) |
| 4. No table stores voter identity | pass | `supabase/migrations/20261107210000_official_roles.sql:20-32` holds only `user_id, role, scope, scope_id, created_at`. `schema.test.ts` "official_roles holds exactly user_id, role, scope, scope_id and created_at" pins the columns, and the existing identity deny-list test covers the public and private schemas. The role CHECK rejects `voter` (`official-roles.test.ts` "rejects a role outside OFFICIAL_ROLES") |
| context-log block | pass | One fenced `context-log` block in the PR body with version 1, 15 decisions and `"corrections": []`, and no other fields. The `context-check` job passed in 11s. One decision claims an approval the issue doesn't fully show (see judgment calls) |

### Tests
- CI `check` job passed in 1m29s. `pnpm lint` passed, `pnpm typecheck` passed, `db:apply` passed.
- `pnpm test`: ui 1 passed, scripts 30 passed, domain 156 passed, web 92 passed, supabase 225 passed, 0 failed. The DB tests ran in CI because the Postgres service and `db:apply` both succeeded.
- Playwright e2e: 3 passed (12.1s). The 3 `demo-officials.spec.ts` tests were skipped (no preview URL or `DEMO_*` in CI).
- New tests:
  - `packages/domain/src/official.test.ts`: frozen `OFFICIAL_ROLES`, `isOfficialRole`, `toOfficialGrant` accepting and rejecting row shapes, and the full `officialMayActOn` role×target matrix, including unknown precincts and counties. It runs under the 100% branch-coverage threshold (`vitest.config.ts`).
  - `apps/web/lib/require-role.test.ts`: every refusal path, bearer vs cookie sessions, the publishable key only (never a secret key), the AC2 scope table, and `parseTarget`. It uses `lib/testing/fake-supabase.ts`, which signs real ES256 JWTs and serves a JWKS, so `getClaims` checks signatures for real.
  - `apps/web/app/api/official/whoami/route.test.ts`: the route with real env, fetch and next/headers: AC1, the three roles at 200 with `no-store`, AC2, malformed targets.
  - `apps/web/app/api/official-routes.test.ts`: every non-public API route imports `requireRole` and calls it in each exported handler.
  - `apps/web/e2e/official-auth.spec.ts` (@smoke): 403 against the built app with no Supabase env.
  - `apps/web/e2e/demo-officials.spec.ts`: password → aal1 403 → TOTP → aal2 200 with the right role (skipped in CI).
  - `supabase/tests/official-roles.test.ts`: own row only, aal2 only, no `created_at`, anon denied, officials can't write, service_role can write, the restrictive policy, scope and role CHECKs, the CHECK matching `OFFICIAL_ROLES`, PK and FK cascade.
  - `supabase/tests/seed-demo-officials.test.ts`: seed flow, idempotent re-runs, secrets printed only once, no file writes, a CI guard, `.env.example` names, RFC 6238 test vectors.
  - Edits to `schema.test.ts`, `public-surface.test.ts` and `server-only.test.ts` (`require-role` added to the server-only and client-bundle checks; `smoke.spec.ts` bundle check now also rejects `official_roles`).

### QA performed
- Preview `https://vbt-2bu6pju4y-vvpat.vercel.app/api/official/whoami`: WebFetch got `302 Found` to `vercel.com/sso-api…` (Vercel Deployment Protection). Not run: the route itself couldn't be reached from here, so the 403 and the demo sign-in on the preview are both unexercised.
- RLS reasoning on `official_roles`:
  - A permissive `select to authenticated using (user_id = auth.uid())` combines with a restrictive `for all to authenticated` that requires `auth.jwt()->>'aal' = 'aal2'`, so an aal1 session sees 0 rows even for its own grant.
  - `revoke all`, then a column grant of `user_id, role, scope, scope_id` to authenticated. The PostgREST filter `user_id=eq.<sub>` needs select on `user_id`, and it is granted. anon has no grant.
  - service_role bypasses RLS in hosted Supabase, so `official_roles_service_write` changes nothing but does no harm.
- Traced in code:
  - A malformed `Authorization` header doesn't fall back to cookies (`require-role.ts:678`).
  - `getClaims(token)` falls back to `/auth/v1/user` for an unknown `kid`, and that path is tested.
  - postgrest retries are off.
  - The county rule for a county target relies on `targetCounty` returning `target.id` when a precinct exists in that county; that holds by construction.
  - `parseTarget` runs before `requireRole` but still returns the same 403.
- Session revocation: `getClaims` checks signature and expiry, not whether the session was revoked. Per Supabase's advanced server-side guide and sessions docs, a signed-out official's access token keeps working until it expires. See the findings.
- Checked that the `AUTH_SCHEMA_STUB` (`supabase/lib/db.ts:95-109`) only runs when `supabase_admin` is missing, so it never touches a real Supabase `auth` schema.
- Not exercised: a live Supabase project (no MCP auth here), the seed script against a real project, and a browser cookie session (no login screen until T-09).

### Security and locked interfaces
- **Secrets:**
  - `.env.example` adds only empty `DEMO_*` names. `SUPABASE_SECRET_KEY` was already listed.
  - The seed script prints secrets to the terminal only. The test "the script writes no files and refuses to run in CI" covers that, and `ci.yml` never runs it.
  - `apps/web` uses only the publishable key, asserted in "Never a secret key: every request carries only the publishable key".
  - Test keys are generated per run in `fake-supabase.ts`. No secret is committed.
- **Voter identity:** none stored. `official_roles` holds officials' auth ids, scopes and roles only. Official emails stay in Supabase's `auth.users`, which is not exposed. `whoami` returns `role, scope, scope_id`, not even `user_id`.
- **Cast time:** not touched. `official_roles.created_at` belongs to officials and authenticated can't read it.
- **Locked interfaces:** `docs/locked-interfaces.md` isn't changed, but the PR adds a table (`official_roles`) to the data model and an endpoint (`GET /api/official/whoami`) to the API boundaries. See the judgment calls.
- **Domain and crypto:** the scope rule is in `packages/domain`. TOTP (`otpauth`) and password `randomBytes` live in the seed script and e2e only. That's account auth, not ballot crypto.
- **Owned areas:** `supabase/` (migration, `config.toml`, seed script, tests) is the data layer in `docs/STATE.md` § Ownership, which is this ticket's area. `apps/web/lib` and the route are app code. `packages/domain` is shared. No `.github/`, `.claude/`, `.mcp.json`, `CLAUDE.md` or `AGENTS.md` changes.

### Findings
#### Unambiguous fixes
1. [medium, open] AC3 has no runnable evidence, and the e2e can't reach a protected preview. `apps/web/playwright.config.ts:20` and `apps/web/e2e/demo-officials.spec.ts:205,217`.
   - **Impact:** the preview returns a 302 to Vercel SSO, so `request.get("/api/official/whoami")` gets the SSO redirect, not the app. AC3 can't pass as written even after seeding.
   - **Fix:** when `VERCEL_AUTOMATION_BYPASS_SECRET` is set, send `x-vercel-protection-bypass` through `use.extraHTTPHeaders`, and add the name to `.env.example` (CLAUDE.md § Shared setup).
   - **Then:** a human applies the migration to the product project, runs `seed:demo-officials --yes`, stores the secrets, and runs `demo-officials.spec.ts` against the preview. Agents can't run DB pushes or set Vercel env.
   - **Source:** https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
2. [medium, open] A signed-out or revoked official session still passes `requireRole` until the token expires. `apps/web/lib/require-role.ts:683`.
   - **Impact:** an official who signs out, or whose session an admin revokes, keeps access to official endpoints for up to the JWT lifetime (1 hour by default). This weakens AC1 for future write endpoints (batches, challenges).
   - **Fix:** after `getClaims`, confirm the session is live. Either call `client.auth.getUser(token)`, or check the JWT's `session_id` claim against `auth.sessions`. Keep `aal` from the verified claims. Add a test that a revoked session gets 403.
   - **Source:** https://supabase.com/docs/guides/auth/server-side/advanced-guide and https://supabase.com/docs/guides/auth/sessions
3. [low, open] The static route guard only checks that the text `requireRole(` appears in each handler, not that its result is used. `apps/web/app/api/official-routes.test.ts:66`.
   - **Impact:** a future handler could call `await requireRole(...)`, ignore `auth.ok` and still pass this test, which leaves AC1's "every official endpoint" unguarded.
   - **Fix:** also require `if (!<name>.ok) return <name>.response` in each handler body, or have `requireRole` wrap the handler (`withRole(roles, handler)`) so a handler can't skip the check.
   - **Source:** self-evident.

#### Judgment calls for a human
1. [low, open] **Approving the new table and endpoint against the locked interfaces.** `supabase/migrations/20261107210000_official_roles.sql:20` and `apps/web/app/api/official/whoami/route.ts:7`.
   - **Question:**
     - Does Austin's or Shawn's approval cover adding `official_roles` to the locked data model and `GET /api/official/whoami` to the locked API boundaries?
     - Should `docs/locked-interfaces.md` be updated in this PR or in a separate one merged first?
   - **What issue #13 shows:** the only human comment says "Approved by Austin. T-20 is in scope … Nothing else owns the roles table or the `requireRole()` helper". That covers the table by implication. No human comment names the `whoami` endpoint.
   - **Category:** locked interface.
   - **Recommended default:** approve both, record the endpoint approval by name, and add both rows to `docs/locked-interfaces.md` in a small follow-up PR. This is reversible: the probe has no callers.
   - **Sources checked:** `docs/locked-interfaces.md`, `CLAUDE.md` § Shared setup, `docs/STATE.md` § Ownership, `/tmp/ticket-context.md`, https://github.com/vibing-out/vbt/issues/13.
   - **Why none settles it:** only Shawn or Austin can approve a locked-interface change, and the recorded approval doesn't name the endpoint.

### Decisions
{"text": "TOTP generation (otpauth) and password generation in the demo seed script and e2e are account authentication, not ballot crypto, so they don't need to live in packages/crypto (docs/locked-interfaces.md § Stack and repo layout: packages/crypto is ballot encryption, tracking codes, Merkle trees and proofs)."}
{"text": "official_roles holds officials' auth user ids, roles and scopes only; voters have no accounts, so it doesn't break 'no table holds a voter's name, ID, date of birth, or signature' (docs/locked-interfaces.md § Data model)."}
{"text": "T-20's supabase/ changes (migration, config.toml MFA, seed script) are inside the data-layer area, which includes auth (docs/STATE.md § Ownership)."}
{"text": "supabase.auth.getClaims checks signature and expiry but not session revocation; official endpoints should also confirm the session is live (getUser or the session_id vs auth.sessions check) (https://supabase.com/docs/guides/auth/server-side/advanced-guide)."}
{"text": "Playwright runs against a protected Vercel preview must send x-vercel-protection-bypass from VERCEL_AUTOMATION_BYPASS_SECRET (https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)."}

### Summary
- **What it delivers:** an `official_roles` table with own-row, aal2-only RLS; a `requireRole` gate that returns 403 on every failure path; the domain scope rule `officialMayActOn`; a `whoami` probe route; and a seed script for the three demo officials.
- **Confidence:** high for AC1, AC2 and AC4. Each one maps to code lines and named tests, and CI ran 504 unit and DB tests with 0 failures plus 3 Playwright tests, with lint and typecheck passing. The fake Supabase in the tests checks real ES256 signatures, and the RLS tests run on Postgres.
- **Not exercised:** AC3. The demo accounts haven't been seeded, the 3 demo e2e tests were skipped in CI, and the preview is behind Vercel SSO, so neither I nor the spec as written can reach it.
- **Left for the epic approver:** approve the `official_roles` and `whoami` additions to the locked interfaces; apply the migration and run the seed against the product project, then run `demo-officials.spec.ts` against a preview with a protection-bypass secret; decide when the session-revocation check must land, before any official write endpoint.
