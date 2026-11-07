# Load test (T-12)

Evidence that the public lookup holds up on election night. `lookup.ts` is a [k6](https://grafana.com/docs/k6/) script that sends **GET requests only** to:

| Endpoint | Default rate | Paths |
| --- | --- | --- |
| `GET /api/track/{code}` | 50 req/s | The 50 synthetic codes `SEED-0001`..`SEED-0050` from `supabase/seed.sql` |
| `GET /api/record/{scope}/{stage}` | 5 req/s | `TALLIED_PRECINCT` for the three seed precincts (override with `RECORD_SCOPES` and `RECORD_STAGE`) |

Both scenarios use k6's `constant-arrival-rate` executor for 5 minutes (`preAllocatedVUs` 50, `maxVUs` 75 each, so at most 150 VUs in total; override with `MAX_VUS`).

## Pass criteria (k6 exits non-zero if any fails)

- p95 of `200` responses under **500 ms**, for each endpoint
- `http_req_failed` under 1%. A `429` from the `/api/track` rate limiter is an expected status, not a failure.
- `rate_limited` (share of `429`s) under 5%, so a run the limiter mostly throttled can't pass on fast `429`s.
- A `404` for an `UNKNOWN_CODES` code is expected and counted in `track_not_found`, not as a failure. Any other status for an unknown code (a `200` included) fails, and so does a `404` for a `TRACK_CODES` code.

With `RECORD_RATE=0` the record scenario and its p95 threshold are left out, for targets with no `/api/record` route.

## Where it runs, and why not production

Never against `www.ballottrack.org`, a Vercel preview or hosted Supabase; `config.ts` refuses those hosts.

- Vercel allows load tests only on Enterprise plans with advance approval ([policy](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments)).
- `ballot_events` is insert-only, so test rows in a hosted database could never be removed.

Instead, run the production build of `apps/web` on your machine against a local Supabase stack. The local stack does not emulate Supabase free-tier (Nano) limits, and the results file says so (`nanoLimitsEmulated: false`).

The `{scope}` and `{stage}` values are environment variables (below), so when later tickets add county scopes or other stages to `docs/locked-interfaces.md`, the script follows without a code change.

k6 doesn't run in CI (ticket CI must finish in 5 minutes). CI runs only the Vitest tests here, which need no k6.

## Run it

Needs Docker, the Supabase CLI and k6 ≥ 1.0 (it runs TypeScript directly). From the repo root:

```sh
supabase start                       # applies supabase/migrations and supabase/seed.sql
# Put the local URL and keys that `supabase status` prints into apps/web/.env.local.
pnpm --filter web build && pnpm --filter web start   # production build on http://localhost:3000

mkdir -p tests/load/results          # k6 does not create the results folder
LOAD_K6_VERSION="$(k6 version)" k6 run tests/load/lookup.ts
```

`handleSummary` writes `tests/load/results/<YYYY-MM-DD>.json` and prints it. Commit that file; `results.test.ts` then checks it against the pass criteria.

### Overrides (k6 `-e` or environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Origin of the app under test |
| `TRACK_RATE` | `50` | Requests per second on `/api/track/{code}` |
| `RECORD_RATE` | `5` | Requests per second on `/api/record/{scope}/{stage}`; `0` turns the record scenario off |
| `DURATION` | `5m` | k6 duration, such as `30s` or `1m30s` |
| `MAX_VUS` | `75` | `maxVUs` for each scenario (two scenarios, so twice this in total). `preAllocatedVUs` is 50, or `MAX_VUS` if lower |
| `RECORD_SCOPES` | `18097-001,18097-002,18057-001` | Comma-separated `{scope}` values for `/api/record/{scope}/{stage}` |
| `RECORD_STAGE` | `TALLIED_PRECINCT` | `{stage}` value for `/api/record/{scope}/{stage}` |
| `TRACK_CODES` | `SEED-0001`..`SEED-0050` | Comma-separated codes the target holds (expected `200`) |
| `UNKNOWN_CODES` | (none) | Comma-separated codes the target must not hold (expected `404`); none may repeat a `TRACK_CODES` entry |
| `TARGET_DESCRIPTION` | Local production build against local Supabase | What was tested, written into the results file. No URL or host |
| `LOAD_K6_VERSION` | (unset) | Output of `k6 version`, recorded in the results |

These are k6 settings, not app environment variables, so they aren't in `.env.example`.

## What the results file holds

Only aggregates: per endpoint the request count, median, p95 and p99 latency of `200` responses, error rate, `429` rate and expected-`404` rate; plus the tested rates and duration, the k6 version, the run date (date only), a description of the target and whether every threshold passed. No tracking codes, URLs or times of day (CLAUDE.md: no voter identity, no ordering leaks). Requests carry an `endpoint` tag and a templated `name` tag so per-code URLs never form their own metrics.

## Tests

```sh
pnpm --filter @vbt/load-tests test
pnpm --filter @vbt/load-tests typecheck
```
