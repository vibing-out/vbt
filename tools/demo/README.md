# @vbt/demo (T-22)

The judges' demo kit: five ballots, A to E, that move from Cast to a final state on the tracker in 3 minutes.

```sh
node --env-file=../../.env.local bin/demo.ts seed [--base-url <url>] [--out out]
node --env-file=../../.env.local bin/demo.ts run --set demo-xxxxxx [--base-url <url>]
node bin/demo.ts run --stub        # in-memory dry run on an instant clock; touches nothing
```

`seed` creates a fresh set: its own precinct `<set>-p` ("Judges' demo <set> (precinct)"), county `<set>-c` and
machine `<set>-m1`. It casts 5 ballots through the simulator's export and the official file upload, then writes
`out/<set>/receipts/<code>.pdf` (each QR code opens `https://www.ballottrack.org/track/<code>`),
`out/<set>/paper-ballots/<random>.pdf` and the presenter's cover sheet `out/<set>/index.md`. Labels A to E go by
sorted tracking code and appear only on the cover sheet.

`run` (and **Start** on `/official/demo?set=<id>`, through `POST /api/official/demo/runs`) runs the same
`runTimeline`:

| Offset from Start | Step | Result |
| --- | --- | --- |
| 20 s | Spoil D (upload D's spoil export) | D Spoiled |
| 45 s | Precinct-close upload with a fault on E, then the precinct batch | E Under review; A, B, C Counted at precinct |
| 90 s | County election-night batch | A, B, C Included in election-night results |
| 120 s | Reject E's challenge: "machine record did not match the paper ballot" | E Not counted (reason shown) |
| 160 s | County certification batch | A, B, C Included in certified results |

The deadline is 190 s. A step is ok only after `GET /api/track/{code}` shows its change within 1 s. A failed step
stops the run and nothing is retried. A set runs once: a second start gets 409 (CLI exit 3). Sets are never
reset or deleted, so seed a fresh one for each rehearsal. If the upload refuses `SPOILED` as an unsupported
event type, D is challenged and accepted instead and certified with A to C.

## Stubs and what replaces them

| Stub (`src/stubs.ts`, tests and `--stub` only) | Replaced by |
| --- | --- |
| `uploadEventsFile` | `POST /api/events`, the official file upload (T-09) |
| `createBatch` | `POST /api/batches` (T-09) |
| `listMismatches` | `GET /api/reports/mismatches` (T-09) |
| `resolveChallenge` | `POST /api/challenges/{id}/resolve` (T-09) |
| `readTrack` | `GET /api/track/{code}` (T-08) |
| `readSet` | the public view `public.ballot_public` (exists) |
| `SimulatorPort` | `tools/simulator` (T-06, `origin/epic/4`), wired in `demoAdapters()` by a follow-up |
| `ReceiptsPort` | `tools/receipts` (T-07, `epic/5`), wired in `demoAdapters()` by a follow-up |

`src/http-ports.ts` already calls the real paths. Its request and response bodies are this ticket's guess at
T-09's, and are the one place to change when T-09 lands. Until the simulator and receipts adapters are wired,
`seed`, `run` and the route refuse up front (route: 503) and write nothing.
