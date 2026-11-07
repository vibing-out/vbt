# Load test (T-12)

Evidence that the public lookup holds up on election night. `lookup.ts` is a [k6](https://grafana.com/docs/k6/) script that sends **GET requests only** to:

| Endpoint | Default rate | Paths |
| --- | --- | --- |
| `GET /api/track/{code}` | 50 req/s | The 50 synthetic codes `SEED-0001`..`SEED-0050` from `supabase/seed.sql` |
| `GET /api/record/{scope}/{stage}` | 5 req/s | `TALLIED_PRECINCT` for the three seed precincts |

Both scenarios use k6's `constant-arrival-rate` executor for 5 minutes (`preAllocatedVUs` 50, `maxVUs` 150).

## Pass criteria (k6 exits non-zero if any fails)

- p95 of `200` responses under **500 ms**, for each endpoint
- `http_req_failed` under 1%. A `429` from the `/api/track` rate limiter is an expected status, not a failure.
- `rate_limited` (share of `429`s) under 5%, so a run the limiter mostly throttled can't pass on fast `429`s.

## Where it runs, and why not production

Never against `www.ballottrack.org`, a Vercel preview or hosted Supabase; `config.ts` refuses those hosts.

- Vercel allows load tests only on Enterprise plans with advance approval ([policy](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments)).
- `ballot_events` is insert-only, so test rows in a hosted database could never be removed.

Instead, run the production build of `apps/web` on your machine against a local Supabase stack. The local stack does not emulate Supabase free-tier (Nano) limits, and the results file says so (`nastyLimitsEmulated: false`).

k6 doesn't run in CI (ticket CI must finish in 5 minutes). CI runs only the Vitest tests here, which need no k6.

## Run it

Needs Docker, the Supabase CLI and k6 ≥ 1.0 (it runs TypeScript directly). From the repo root:

```sh
supabase start                       # applies supabase/migrations and supabase/seed.sql
# Put the local URL and keys that `supabase status` prints into apps/web/.env.local.
pnpm --filter web build && pnpm --filter web start   # production build on http://localhost:3000

LOAD_K6_VERSION="$(k6 version)" k6 run tests/load/lookup.ts
```

`handleSummary` writes `tests/load/results/<YYYY-MM-DD>.json` and prints it. Commit that file; `results.test.ts` then checks it against the pass criteria.

### Overrides (k6 `-e` or environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Origin of the app under test |
| `TRACK_RATE` | `50` | Requests per second on `/api/track/{code}` |
| `RECORD_RATE` | `5` | Requests per second on `/api/record/{scope}/{stage}` |
| `DURATION` | `5m` | k6 duration, such as `30s` or `1m30s` |
| `LOAD_K6_VERSION` | (unset) | Output of `k6 version`, recorded in the results |

These are k6 settings, not app environment variables, so they aren't in `.env.example`.

## What the results file holds

Only aggregates: per endpoint the request count, median, p95 and p99 latency of `200` responses, error rate and `429` rate; plus the tested rates and duration, the k6 version, the run date (date only), a description of the target and whether every threshold passed. No tracking codes, URLs or times of day (CLAUDE.md: no voter identity, no ordering leaks). Requests carry an `endpoint` tag and a templated `name` tag so per-code URLs never form their own metrics.

## Tests

```sh
pnpm --filter @vbt/load-tests test
pnpm --filter @vbt/load-tests typecheck
```
