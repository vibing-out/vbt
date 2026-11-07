# VVSG 2.0 alignment map

VBT is built to align with VVSG 2.0. It is a transparency layer, not a voting system: the voter-verified paper ballot stays authoritative and decides recounts (locked Principle 3).

This map links each VVSG 2.0 area we touch to the tests that cover it, and names the ticket that unlocks each area or part not yet tested. `tests/vvsg/src/vvsg-map.test.ts` keeps it honest: every path below must exist, and every VVSG test must be listed.

## Sources

- EAC, Voluntary Voting System Guidelines: https://www.eac.gov/voting-equipment/voluntary-voting-system-guidelines
- VVSG 2.0 Requirements Matrix v1.1 (May 2023)
- VVSG 2.0 Test Assertions v1.4 (January 2026)

The principle column uses the 15 published VVSG 2.0 principles. No row cites a requirement ID yet: each one will be copied from Requirements Matrix v1.1 when a row's tests are written against it.

## Map

Status is `tested`, `partly tested` or `not yet tested`.

| VVSG 2.0 area | VVSG 2.0 principle | Priority | Status | Tests (repo paths) | Not yet tested: unlocked by |
|---|---|---|---|---|---|
| Software independence | 9 Auditable | Must | not yet tested | — | The C2–C4 cross-checks and an injected counting bug: T-10 #20 builds the cross-checks; T-05 #15 builds the stage records and their totals; then the T-19 follow-up |
| Ballot secrecy | 10 Ballot secrecy; 6 Voter privacy | Must | partly tested | Database surface (no identity column, RLS and `security_invoker` everywhere, no public writes, no time next to a tracking code, dates only): `tests/vvsg/src/secrecy.db.test.ts`, `supabase/tests/public-surface.test.ts`, `supabase/tests/public-access.test.ts`. No identity key in the simulator files: `tests/vvsg/src/nist-schemas.test.ts` | `GET /api/track`: T-08 #18. `GET /api/record`: T-08 #18 and T-05 #15. Receipts carry no choices: T-07 #17 (PR #89). Ingest logs: T-05 #15 |
| Interoperability | 4 Interoperable | Must | partly tested | Simulator output from `origin/epic/4` against the official NIST JSON schemas: NIST SP 1500-103 cast vote records validate. `tests/vvsg/src/nist-schemas.test.ts`, provenance in `tests/vvsg/schemas/nist/SOURCES.md` and `tests/vvsg/fixtures/simulator/SOURCE.md` | NIST SP 1500-101: the simulator's machine log follows VotingWorks' CDF shape and does not yet validate against the 1500-101 schema (the test pins the three differences): T-06 #16 or the NIST mapping in T-10 #20. NIST SP 1500-100: no simulator format writes results; the export and NIST mapping come with T-10 #20 and T-09 #19. Imports through `POST /api/events`: T-05 #15. Live simulator output: T-06 #16, once epic/4 merges into `main` |
| Air gap / one-way flow | 14 System integrity; 13 Data protection | Must | partly tested | Only known calls to our own Supabase, no device or wireless API, public tracker and record routes are GET-only: `tests/vvsg/src/air-gap.test.ts`. Every other route checks role and MFA: `apps/web/app/api/official-routes.test.ts` | The authenticated upload route `POST /api/events`: T-05 #15 |
| Auditability and logging | 9 Auditable; 15 Detection and monitoring | Should | partly tested | Ballot events and stage records reject updates and deletes: `supabase/tests/insert-only.test.ts` | An official-action log and its signed export need a new table, a locked-interface change (§ Data model), so they aren't planned |
| MFA and access control | 11 Access control | Should | tested | `apps/web/app/api/official-routes.test.ts`, `apps/web/lib/require-role.test.ts`, `apps/web/app/api/official/whoami/route.test.ts` | — |
| Accessibility and language access | 5 Equivalent and consistent voter access; 8 Robust, safe, usable and accessible | Should | not yet tested | — | Automated accessibility scan and English and Spanish screens of the voter pages: T-08 #18 |
| Penetration testing | 14 System integrity | Cut first | not yet tested | — | Unguessable tracking codes and rate-limited lookups: T-08 #18 and T-05 #15. A security scan of each preview deploy needs a `.github/` change (Shawn's area) |

## How to run

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm --filter @vbt/vvsg-tests test
```

`DATABASE_URL` must point at a local Postgres, for example from `supabase start`. Without it the database tests are skipped locally. In CI they always run, because `CI` is set. No test uses the network.

## Provenance

- NIST schemas: `tests/vvsg/schemas/nist/SOURCES.md` (URL, upstream commit and SHA-256 of each file)
- Simulator fixtures: `tests/vvsg/fixtures/simulator/SOURCE.md` (the epic/4 commit and the command that made them)
