# NIST mapping and cross-checks

How the files officials upload map to the records the four cross-checks compare (T-10, #20). The contract is `docs/locked-interfaces.md` § Cross-checks; this page is the field-level mapping.

- Importers: `packages/events`. `importCdfLogJson` and `importCdfLogXml` read machine event logs (NIST SP 1500-101). `importElectionReportText` and `toCheckRecords` read official results (NIST SP 1500-100 V2, JSON). The code table is `NIST_CODES` in `packages/events/src/nist-codes.ts`.
- Checks: `packages/domain/src/cross-checks.ts`. It holds `checkMachineCounts`, `checkPrecinctTotals`, `checkElectionNightTotals`, `checkCertification`, `runCrossChecks`, `affectedBallotIds` and `planMismatchChallenges`. These are pure functions: no I/O, no crypto, and no time.
- Storage: `private.machine_log_imports`, `private.official_results` and `private.check_results` (migration `20261107220000_cross_check_records.sql`). They are insert-only, and only `service_role` can reach them, through a server route that checks role and MFA first.

Ingest is file-based and one-way: an authenticated official uploads an exported file, and nothing ever calls a voting system.

## The four checks

| Check | Gates | Scope | Left record | Right record | Passes when |
| --- | --- | --- | --- | --- | --- |
| C1 Machine count | `TALLIED_PRECINCT` | Machine | 1500-101 log: successful `vote-cast` events per `Device.Id` | ElectionGuard record: ballots on that machine that are not `SPOILED` | The counts are equal |
| C2 Precinct totals | `TALLIED_PRECINCT` | Precinct | ElectionGuard precinct tally (decrypted in aggregate) | 1500-100 precinct report, `unofficial-complete` | Every contest and selection total is equal |
| C3 Election-night totals | `REPORTED_UNOFFICIAL` | County, plus each precinct when the county report breaks down by precinct | Sum of the county's precinct reports (and each precinct report) | 1500-100 county report, `unofficial-complete` (its county total and its precinct figures) | Every total is equal |
| C4 Certification | `CERTIFIED` | County | 1500-100 election-night totals − removed totals + reinstated totals | 1500-100 county report, `certified` | Every total is equal and, when both reports carry `BallotCounts`, the ballot counts reconcile the same way |

Totals are compared over the union of contest and selection keys. A missing key counts as 0, and every differing cell is reported. A check also fails for a machine, precinct or county that only one record has (`MISSING_SOURCE`) or that one record has twice (`DUPLICATE_SOURCE`). The other failure reasons are:

- `COUNT_MISMATCH` (C1)
- `NO_BALLOT_COUNT_EVENTS`: C1 where the machine has ballots but its log has no successful `vote-cast` events
- `TOTALS_MISMATCH` (C2, C3)
- `INVALID_RESOLUTION`: C4 where a resolution names no ballot, names one twice, or names one outside its county or status
- `UNEXPLAINED_DIFFERENCE` (C4)

C4 reads recorded resolutions as aggregates only, because officials decrypt in aggregate. A `removed` resolution names ballots that are now `CHALLENGED` or `DISCARDED`. A `reinstated` resolution names challenged ballots that were resolved back to `CAST`, `TALLIED_PRECINCT` or `REPORTED_UNOFFICIAL`.

### Which ballots a failure affects

`affectedBallotIds(result, ballots)` returns every ballot on the failing machine (C1), in the failing precinct (C2, and C3 when the breakdown localizes it) or in the failing county (C3 without a breakdown, and C4). The ids come back sorted, never in cast order. `planMismatchChallenges(results, ballots)` turns them into `{ballotId, from, to: "CHALLENGED", event_type: "MISMATCH_DETECTED"}` moves, but only where `transition()` allows the move: from `CAST`, `TALLIED_PRECINCT` or `REPORTED_UNOFFICIAL`. Certified, discarded, spoiled and already-challenged ballots are left alone.

### What fails what

A fault in one source fails only the check that compares that source with an independent record. The fixture test `packages/events/src/cross-check.e2e.test.ts` injects each fault into the uploaded files. It asserts that the fault fails exactly the listed check, that the other three pass, and that exactly the listed ballots are affected:

| Injected fault | Fails | Affected ballots | Why the other checks still pass |
| --- | --- | --- | --- |
| One `vote-cast` removed from machine M's log | C1 for M | Ballots on M | Tallies and results do not come from the log |
| Precinct P reports altered totals, and the county report carries the same figure | C2 for P | Ballots in P | The county aggregates what it received, so C3 agrees; certified follows election night, so C4 agrees |
| One precinct figure in county C's election-night breakdown changes | C3 for that precinct | Ballots in that precinct | The county total still matches the precincts' sum |
| Only county C's election-night total changes (no breakdown) | C3 for C | Ballots in C | Certified follows the published figure, so C4 sees no unexplained difference |
| County C's certified total differs with no recorded resolution | C4 for C | Ballots in C | Earlier stages are untouched |
| Certified = election night − a recorded discard's totals (positive control) | Nothing | None | The discard explains the difference |

## Machine event logs: NIST SP 1500-101

Election Event Logging CDF V1, in JSON ([schema](https://raw.githubusercontent.com/usnistgov/ElectionEventLogging/master/NIST_V1_election_event_logging.json)) or XML ([XSD](https://raw.githubusercontent.com/usnistgov/ElectionEventLogging/master/NIST_V1_election_event_logging.xsd)). One upload may hold several devices. Both formats are validated by the same rules:

- `@type` must be `EventLogging.ElectionEventLog`, `EventLogging.Device` and `EventLogging.Event` respectively.
- `GeneratedTime` and `Device.Id` are required, and a `Device.Id` appears only once per file.
- Each `Event` requires `Id`, `Sequence`, `TimeStamp`, `Type` and `Disposition`. `Disposition` must be `success`, `failure`, `na` or `other`.

| 1500-101 element | VBT field | Notes |
| --- | --- | --- |
| `ElectionEventLog` | One upload | Its SHA-256 goes into `machine_log_imports.file_sha256`, and `format` records `cdf-json` or `cdf-xml` |
| `Device.Id` | `machines.id`, `machine_log_imports.machine_id` | The C1 join key. An unknown device fails the insert (foreign key) |
| `Event.Id` | `nist_event_code`, unchanged | Mapped through the code table below |
| `Event.Disposition` = `failure` (any `Id`) | `error_count` | Counted once per event, together with the error codes below |
| `Event.TimeStamp`, `Event.Sequence`, `Event.Hash` | Checked as required, then dropped | They never leave the importer and are never stored. No tracking code is ever linked to a timed machine event |

### Code table (`NIST_CODES`)

The codes are VotingWorks' documented `Event.Id`s ([VxSuite logging documentation](https://github.com/votingworks/vxsuite/blob/main/libs/logging/VotingWorksLoggingDocumentation.md)), which are the locked reference for machine logs.

| `Event.Id` | Use | `event_type` | Summary field |
| --- | --- | --- | --- |
| `vote-cast` | Ballot count (C1), only when `Disposition` is `success` | `CAST` | `ballots_counted` |
| `polls-opened` | Machine level, `success` only | None | `polls_opened` |
| `polls-closed` | Machine level, `success` only | None | `polls_closed` |
| `admin-adjudication-proxy-error` | Error | None | `error_count` |
| `audio-device-detection-error` | Error | None | `error_count` |
| `audio-device-selection-error` | Error | None | `error_count` |
| `audio-playback-error` | Error | None | `error_count` |
| `audio-volume-change-error` | Error | None | `error_count` |
| `convert-log-cdf-log-line-error` | Error | None | `error_count` |
| `diagnostic-error` | Error | None | `error_count` |
| `file-read-error` | Error | None | `error_count` |
| `lifetime-sheet-count-increment-error` | Error | None | `error_count` |
| `lifetime-sheet-count-read-error` | Error | None | `error_count` |
| `parse-error` | Error | None | `error_count` |
| `pat-device-error` | Error | None | `error_count` |
| `socket-client-error` | Error | None | `error_count` |
| `socket-server-error` | Error | None | `error_count` |
| `unknown-error` | Error | None | `error_count` |
| Any other id, including `ballot-invalidated` | Unmapped | None | `unmapped_codes` |

A log never produces `ballot_events` rows. `vote-cast` corresponds to `CAST`, but the log names no ballot, and linking a tracking code to a timed machine event is forbidden. The `CAST` event comes from the ElectionGuard record, and the log only counts.

### XML safety

The XML importer applies these rules, following the [OWASP XXE Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html) and the fast-xml-parser entity-expansion advisories fixed in 5.10.1:

- A file over 10 MB is refused, and so is any file that contains `<!DOCTYPE` or `<!ENTITY`. Both checks run before the parser sees the file.
- It uses `fast-xml-parser`, pinned exactly at 5.12.0, with `processEntities: false`.
- Only the five predefined entities and numeric character references are decoded.
- The root must be `ElectionEventLog` in namespace `http://itl.nist.gov/ns/voting/1500-101/v1`, either as the default namespace or through a prefix. Elements from other namespaces and attributes are ignored.

## Official results: NIST SP 1500-100

Election Results Reporting CDF V2, JSON ([schema](https://raw.githubusercontent.com/usnistgov/ElectionResultsReporting/version2/NIST_V2_election_results_reporting.json)). One report per upload: a precinct's report to the county, the county's election-night results, or its certified results. JSON files are capped at 10 MB, the same as logs.

### Status and reporting unit to stage (`RESULTS_STAGE_RULES`)

A report's level is the widest `ReportingUnit` `Type` (`county` over `precinct`) that has `VoteCounts`. Every row of the report carries the stage, so a county report's precinct breakdown has the county's stage.

| `ElectionReport.Status` | Level | Stage | Used by |
| --- | --- | --- | --- |
| `unofficial-complete` | `precinct` | `TALLIED_PRECINCT` (the precinct's report to the county) | C2, C3 |
| `unofficial-complete` | `county` | `REPORTED_UNOFFICIAL` (election night) | C3 (county total and precinct breakdown), C4 |
| `certified` | `county` | `CERTIFIED` | C4 |
| `certified` | `precinct` | Refused: a precinct does not certify | |
| `unofficial-partial`, `recount`, `correction`, `pre-election` | Any | Refused | |

### Fields

| 1500-100 element | VBT field | Notes |
| --- | --- | --- |
| `ElectionReport` (`@type` `ElectionResults.ElectionReport`) | One upload | SHA-256 into `official_results.file_sha256`; `Status` into `nist_status` |
| `GpUnit` (`ReportingUnit`) `Type` = `precinct` / `county` | `scope` | Other unit types (state, district) hold no VBT figures; counts for them are refused |
| `GpUnit.ExternalIdentifier[]` with `Type` `local-level` | `scope_id` (`precincts.id` or the county id) | Falls back to `GpUnit.@id` |
| County `GpUnit.ComposingGpUnitIds` | `county_id` of each precinct row | A precinct with counts must sit in exactly one county in the report |
| `Election` | | Exactly one per report |
| `Contest.@id`, `ContestSelection.@id` | `totals` keys (contest, selection) | Assumed equal to the ElectionGuard manifest ids |
| `VoteCounts` (`GpUnitId`, `Type`, `Count`) | `totals[contest][selection]` for that GpUnit | The one `total` count when present, otherwise the sum of every `Type` except `seats`. Two `total`s for a unit are refused |
| `VoteCounts.IsSuppressedForPrivacy` = `true` | | Refused: a suppressed count cannot be verified |
| `Election.BallotCounts` (`GpUnitId`, `Type`, `BallotsCast`) | `ballot_count` | Same total-first rule; used by C4 when both county reports have it |

## Cast vote records: NIST SP 1500-103

Cast vote records are what ElectionGuard encrypts. No check reads them directly: C1 and C2 compare the ElectionGuard record, which is built from them, with independent sources.

| 1500-103 element | VBT field |
| --- | --- |
| `CVR.CreatingDeviceId` | `ballots.machine_id` |
| `CVR.BallotStyleUnitId` | `ballots.precinct_id` |
| `CVR.BallotStyleId` | `ballots.ballot_style` |
| `CVRContest.ContestId`, `CVRContestSelection.ContestSelectionId` | Contest and selection ids in the manifest and in every `totals` |

## ElectionGuard record

| Element | VBT field | Used by |
| --- | --- | --- |
| Encrypted ballot, its device and precinct | `ballots` (`machine_id`, `precinct_id`, `current_status`) and `RecordedBallot` | C1 count; the ballots a failed check affects |
| Spoiled ballot | `current_status = 'SPOILED'` | Excluded from C1 and never challenged |
| Precinct tally, decrypted in aggregate | `PrecinctTally.totals`, and `stage_records.totals` once published | C2 left side |

## Stored records

| Table | Holds | Never holds |
| --- | --- | --- |
| `private.machine_log_imports` | One row per device per uploaded log: machine, precinct, county, election, format, file SHA-256, `ballots_counted`, `polls_opened`, `polls_closed`, `error_count`, `unmapped_codes`, `uploaded_by` (an auth user id) | Event times, sequence numbers, raw events |
| `private.official_results` | One row per precinct or county per uploaded report: `scope`, `scope_id`, `county_id`, `stage`, `nist_status`, `totals`, `ballot_count`, file SHA-256, `uploaded_by` | Per-ballot data |
| `private.check_results` | One row per check per scope: `check_id`, `scope`, `scope_id`, `stage`, `passed`, `failure`, `mismatches` (ids and counts), optional `batch_id` | Which ballots were challenged; the challenges themselves are `ballot_events` rows (`MISMATCH_DETECTED`) |

`check_results` stays official-only for now, even though the privacy rule lets the public see check results. Publishing them is a follow-up.

## Gaps

- **No per-sheet event for vx-scan.** The VxSuite documentation lists `vote-cast` only for `vx-mark-scan`. A machine whose log counts no ballots but that has ballots fails C1 with `NO_BALLOT_COUNT_EVENTS` rather than passing silently.
- **`ballot-invalidated` is unmapped.** It is reported in `unmapped_codes`, not guessed as `SPOILED`. Spoiled ballots come from the ElectionGuard record.
- **No ballot identity in logs.** CDF logs carry none, and the privacy rule forbids linking one, so logs never create `ballot_events`.
- **No VVSG 2.0 mapping.** The VxSuite logging documentation has no VVSG 2.0 required-event mapping, so this table maps documented VxSuite ids only.
- **1500-100 XML** is not read yet. JSON is an official V2 format, and XML only adds code.
- **Unsupported statuses.** `unofficial-partial`, `recount`, `correction` and `pre-election` reports are refused.
- **No contest-id translation.** 1500-100 contest and selection ids are assumed to equal the ElectionGuard manifest's.

## Not in T-10

- Running the checks on each batch transition (T-09), and writing `ballot_events` or `check_results` rows from a route.
- The simulator writing these files and injecting the faults (T-06). Until then, `packages/events/src/testing/election-fixture.ts` writes the same files.
- The upload route (`POST /api/events`) that hashes files and inserts the import rows.
- Publishing check results, decrypting the ElectionGuard tally, and 1500-103 import.
