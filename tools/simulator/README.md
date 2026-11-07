# simulator (T-06)

A voting machine simulator that writes official-style **file exports**, for demos and for T-11 ingest. It makes no network, API or database calls.

```sh
pnpm --filter simulator exec simulate --ballots 100 --mismatch-rate 0.02 --seed 1 --out ./sim-out
```

```text
simulate [options]

  --ballots <n>          Number of cast ballots (integer ≥ 1). Required.
  --mismatch-rate <r>    Fraction in [0, 1]. Default 0. Fault count = round(n * r).
  --seed <s>             String or integer seed. Default "0".
  --out <dir>            Output directory (created if missing). Required.
  --machines <n>         Optional. Default 4. Must be ≥ 1.
  --precincts <n>        Optional. Default 2. Must be ≥ 1.
  --help                 Print usage.
```

Exit codes: `0` success, `2` bad arguments, `1` a write failure.

## Output

```text
<out>/
  manifest.json                       run inputs, topology, ballot ids, injected faults
  machines/<machineId>/vx-logs.cdf.json   one VotingWorks-shaped CDF event log per machine
  cvrs/<ballotId>.cvr.json            one NIST SP 1500-103 CastVoteRecordReport per ballot
  totals/precinct-<precinctId>.json   precinct totals reported to the county
  totals/county-<countyId>.json       county election-night (unofficial) totals
  totals/certified-<countyId>.json    county certified totals
```

Existing files with these names are overwritten; nothing else is deleted. Use a fresh directory for each run, or old CVRs from a larger run stay behind. `manifest.files` lists every file the run wrote except `manifest.json` itself.

### Machine logs

Root `ElectionEventLog` → `Device[]` (one device, `Type: "scan-single"`, `Version: "vbt-sim-1.0.0"`) → `Event[]`. Each event has `Id`, `Disposition`, `Sequence` (0-based, contiguous) and `TimeStamp`. Event order per machine: `polls-opened`, one `vote-cast` per ballot (its `Details` is the JSON string `{"ballotId": "..."}`), `export-cast-vote-record-complete`, `polls-closed`.

### Cast vote records

`CastVoteRecordReport` with `Version: "1.0.0"`, `ReportType: ["originating-device-export"]`, the fixture's `Election` and contests, `GPUnit` (precinct and county), and one `CVR` whose `CurrentSnapshotId` names an `original` snapshot with one indicated selection per contest. `CreatingDeviceId` is the machine id and `BallotStyleUnitId` the precinct id.

### Totals (simulator-private)

Not an official format. They exist so the C2–C4 faults are real file disagreements.

```ts
interface TotalsFile {
  scope: "precinct" | "county-unofficial" | "county-certified";
  scopeId: string;
  electionId: string;
  ballotCount: number;
  contests: Array<{ contestId: string; selections: Array<{ selectionId: string; votes: number }> }>;
}
```

Clean run: each precinct file equals the tally of its CVRs, the county file equals the sum of the precinct files, and the certified file equals the county file.

## Faults

`round(ballots × mismatch-rate)` distinct ballots get exactly one fault each. Types are drawn with weights 0.50 / 0.20 / 0.15 / 0.15.

| Type | File effect | Fails |
| --- | --- | --- |
| `missing_log_entry` | No `vote-cast` event for the ballot; its CVR is still written | C1 |
| `alter_precinct_totals` | +1 vote for a selection the ballot didn't choose, in its precinct file | C2 |
| `alter_county_enr_totals` | +1 vote on one selection in the county election-night file | C3 |
| `alter_certified_totals` | +1 vote on one selection in the certified file | C4 |

Totals are built stage by stage: the county file is the sum of the precinct files *as written* (C2 changes included), and the certified file copies the county file *as written* (C3 changes included). So each fault fails only the check it names. Every change adds a vote, so two faults of the same type never cancel out. Each fault's `detail` in the manifest names the file, contest and selection it changed.

## Determinism

The same flags always give byte-identical output. A Mulberry32 PRNG is seeded from an FNV-1a hash of `--seed`, with two derived streams: `<seed>:ballots` (ballot ids and choices) and `<seed>:faults` (fault targets, types and the totals changes). Timestamps count whole seconds from `2026-11-03T06:00:00.000Z`. Files are written as `JSON.stringify(value, null, 2) + "\n"` with fixed key order. Generation never uses `Math.random` or `crypto.randomUUID`.

Fixture: election `marion-general-2026-11-03`, county `marion`, ballot style `style-general`; contests `contest-president` (`cand-a`, `cand-b`, `cand-c`) and `contest-measure-1` (`yes`, `no`). Machine `i` sits in precinct `i mod precincts`, and ballots go to machines round-robin in cast order (`manifest.ballotIds` order).

## Development

```sh
pnpm --filter simulator test
pnpm --filter simulator typecheck
```

The `simulate` bin (`bin/simulate.mjs`) loads the TypeScript sources through `tsx`. The package lists itself as a `link:.` dev dependency so pnpm links that bin into its own `node_modules/.bin`, which `pnpm --filter simulator exec simulate` needs.
